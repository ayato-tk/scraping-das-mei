// ─── IMPORTANTE ──────────────────────────────────────────────────────────────
// Execute usando:
// REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding node ./bin/index.js
// ─────────────────────────────────────────────────────────────────────────────

import { addExtra } from 'puppeteer-extra';
import rebrowserPuppeteer from 'rebrowser-puppeteer-core';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import UserPreferencesPlugin from 'puppeteer-extra-plugin-user-preferences';
import { readBarcodePDF } from './readBarcodePDF.js';
import { logger } from './loggers.js';
import fs from 'fs';
import path from 'path';

const puppeteer = addExtra(rebrowserPuppeteer);

// ─── Configurações ────────────────────────────────────────────────────────────

const DOWNLOAD_PATH = path.join(process.cwd(), 'bin');
const PGMEI_URL = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao';
const TIMEOUT_NAV = 40_000;
const TIMEOUT_SEL = 20_000;

function getSystemChromePath() {
  switch (process.platform) {
    case 'darwin':
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'win32':
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    default:
      for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
        if (fs.existsSync(p)) return p;
      }
      throw new Error('Chrome não encontrado no sistema.');
  }
}

// ─── Plugins ─────────────────────────────────────────────────────────────────

puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
puppeteer.use(
  UserPreferencesPlugin({
    userPrefs: {
      download: {
        prompt_for_download: false,
        default_directory: DOWNLOAD_PATH,
      },
      plugins: {
        always_open_pdf_externally: true,
      },
    },
  })
);

// ─── Helpers de comportamento humano ─────────────────────────────────────────

const randomDelay = (min = 300, max = 900) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

async function humanMouseMove(page, fromX, fromY, toX, toY, steps = 30) {
  const ctrlX = (fromX + toX) / 2 + (Math.random() - 0.5) * 150;
  const ctrlY = (fromY + toY) / 2 + (Math.random() - 0.5) * 150;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    await page.mouse.move(
      mt * mt * fromX + 2 * mt * t * ctrlX + t * t * toX,
      mt * mt * fromY + 2 * mt * t * ctrlY + t * t * toY
    );
    await new Promise(r => setTimeout(r, 6 + Math.random() * 14));
  }
}

async function humanClick(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: TIMEOUT_SEL, visible: true });
  const box = await el.boundingBox();
  if (!box) throw new Error(`Elemento invisível: ${selector}`);

  const targetX = box.x + box.width * (0.25 + Math.random() * 0.5);
  const targetY = box.y + box.height * (0.25 + Math.random() * 0.5);

  const pos = await page.evaluate(() => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
  })).catch(() => ({ x: 100, y: 100 }));

  await humanMouseMove(page, pos.x, pos.y, targetX, targetY);
  await randomDelay(80, 200);
  await page.mouse.click(targetX, targetY);
}

async function humanType(page, selector, text) {
  await humanClick(page, selector);
  await page.focus(selector);
  await randomDelay(150, 300);

  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');

  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
  }
  await randomDelay(200, 400);

  for (const char of text) {
    await page.keyboard.type(char);
    await new Promise(r => setTimeout(r, 90 + Math.random() * 90));
    if (Math.random() < 0.12) await randomDelay(150, 350);
  }
  await randomDelay(400, 700);
}

async function waitForUrlContaining(page, urlPart, timeout = TIMEOUT_NAV) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (page.url().includes(urlPart)) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timeout aguardando URL com "${urlPart}".`);
}

async function debugScreenshot(page, label) {
  try {
    const file = path.join(DOWNLOAD_PATH, `debug-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    logger.warn(`📸 Screenshot salvo: ${file}`);
  } catch { }
}

// ✅ Função para salvar PDF via buffer do Puppeteer
async function savePdfFromResponse(response, outputPath) {
  try {
    const buffer = await response.buffer();
    
    if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
      const contentType = response.headers()['content-type']?.toLowerCase() || '';
      if (!contentType.includes('pdf') && !contentType.includes('application/octet-stream')) {
        throw new Error(`Conteúdo não é PDF. Content-Type: ${contentType}`);
      }
    }
    
    fs.writeFileSync(outputPath, buffer);
    const stats = fs.statSync(outputPath);
    
    if (stats.size < 1024) {
      throw new Error(`Arquivo muito pequeno: ${stats.size} bytes`);
    }
    
    logger.info(`✅ PDF salvo: ${outputPath} (${Math.round(stats.size/1024)} KB)`);
    return true;
  } catch (err) {
    logger.debug(`⚠️ savePdfFromResponse falhou: ${err.message}`);
    return false;
  }
}

// ✅ Função simplificada: espera qualquer PDF novo na pasta
async function waitForAnyNewPdf(downloadPath, maxWait = 40_000, poll = 500) {
  const before = new Set(fs.readdirSync(downloadPath).filter(f => f.endsWith('.pdf')));
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    const after = fs.readdirSync(downloadPath).filter(f => f.endsWith('.pdf') && !f.endsWith('.crdownload'));
    const newFiles = after.filter(f => !before.has(f));
    
    if (newFiles.length > 0) {
      logger.info(`📄 Novo PDF detectado: ${newFiles[0]}`);
      return newFiles[0];
    }
    
    // Debug: mostra arquivos existentes a cada 5 segundos
    if (after.length > 0 && Math.random() < 0.2) {
      logger.debug(`🔍 Aguardando PDF... Arquivos atuais: [${after.join(', ')}]`);
    }
    
    await new Promise(r => setTimeout(r, poll));
  }
  
  // Timeout: lista todos os PDFs para debug
  const allPdfs = fs.readdirSync(downloadPath).filter(f => f.endsWith('.pdf'));
  logger.warn(`⏰ Timeout. PDFs na pasta: [${allPdfs.join(', ')}]`);
  return null;
}

// ─── Função principal ─────────────────────────────────────────────────────────

async function scraping(answers) {
  const { cnpj, month, year, headless = false } = answers;

  if (!fs.existsSync(DOWNLOAD_PATH)) fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });

  let chromePath;
  try {
    chromePath = getSystemChromePath();
  } catch (e) {
    logger.error(e.message);
    return [false, e.message];
  }

  const selectedHeadlessMode = headless ? 'new' : false;

  const browser = await puppeteer.launch({
    headless: selectedHeadlessMode,
    executablePath: chromePath,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--lang=pt-BR,pt',
      '--disable-pdf-viewer',
      '--disable-plugins-discovery',
      '--window-size=1366,768',
      `--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
    ],
    defaultViewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });

  const [page] = await browser.pages();
  
  let onResponseHandler = null;

  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    });

    const cdp = await page.target().createCDPSession();
    await cdp.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_PATH
    });

    let pdfResponse = null;

    // Handler para capturar a resposta do PDF
    onResponseHandler = (resp) => {
      const url = resp.url();
      if (url.includes('/emissao/imprimir') && resp.status() === 200) {
        const contentType = resp.headers()['content-type']?.toLowerCase() || '';
        if (contentType.includes('pdf') || contentType.includes('application/octet-stream')) {
          logger.info(`📡 Resposta PDF capturada: ${url}`);
          pdfResponse = resp;
        }
      }
    };
    page.on('response', onResponseHandler);

    // Stage 1 — Acessar o PGMEI
    logger.info('Stage 1: Acessando o PGMEI...');
    await page.goto(PGMEI_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT_NAV });
    await page.evaluate(() => window.scrollBy(0, 80 + Math.random() * 120));
    await randomDelay(1500, 2500);

    // Stage 2 — Preencher o CNPJ
    logger.info('Stage 2: Preenchendo o CNPJ...');
    await page.waitForSelector('input[id=cnpj]', { timeout: TIMEOUT_SEL, visible: true });
    await humanType(page, 'input[id=cnpj]', cnpj.replace(/\D/g, ''));

    logger.info('Stage 2: Submetendo CNPJ...');
    await humanClick(page, 'button[type=submit]');
    
    // Aguarda transição de página ou erro de forma reativa
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }),
      page.waitForSelector('#toast-container .toast-message, .alert', { timeout: 15_000, visible: true })
    ]).catch(() => {});

    if (page.url().includes('Identificacao')) {
      const erroNaPagina = await page.$eval(
        '#toast-container .toast-message, .alert',
        el => el?.textContent?.trim()
      ).catch(() => null);

      if (erroNaPagina && (erroNaPagina.includes('Captcha') || erroNaPagina.includes('caracteres antirobô'))) {
        throw new Error('Bloqueado por validação de segurança na tela inicial.');
      } else if (erroNaPagina) {
        throw new Error(`Erro no formulário: ${erroNaPagina}`);
      }
    }

    // Stage 3 — Navegar para emissão do DAS
    logger.info('Stage 3: Navegando para emissão do DAS...');
    // Pequeno ajuste para garantir que o menu esteja pronto para clique nativo
    await randomDelay(500, 1000); 
    await page.waitForSelector('a[href="/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao"]', { timeout: 10_000 });
    await page.click('a[href="/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao"]');
    await waitForUrlContaining(page, '/emissao');

    // Stage 4 — Selecionar ano-calendário
    logger.info(`Stage 4: Selecionando o ano ${year}...`);
    await page.waitForSelector('#anoCalendarioSelect', { timeout: TIMEOUT_SEL, visible: true });
    await page.select('#anoCalendarioSelect', year);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10_000 }).catch(() => { }),
      page.click('button[type=submit]'),
    ]);

    const bannerAno = await page.$eval('.alert', el => el.textContent?.trim()).catch(() => null);
    if (bannerAno?.includes('É necessário selecionar o ano-calendário.')) {
      logger.info('DAS não disponível para o ano-calendário informado.');
      return [false, bannerAno];
    }

    // Stage 5 — Selecionar mês e emitir
    logger.info(`Stage 5: Selecionando o mês ${month}...`);
    const periodoSeletor = `[value="${year}${month}"]`;
    await page.waitForSelector(periodoSeletor, { timeout: TIMEOUT_SEL, visible: true });
    await page.click(periodoSeletor);

    logger.info('Stage 5: Emitindo o DAS...');
    await page.evaluate(() => {
      const btn = document.querySelector('#btnEmitirDas');
      if (btn) btn.click();
    });

    // Stage 6 — Aguardar botão de impressão
    logger.info('Stage 6: Aguardando botão de impressão...');
    
    let printButton = null;
    let usedSelector = 'text:Imprimir';
    
    try {
      const startTime = Date.now();
      while (Date.now() - startTime < 15_000) {
        try {
          const handle = await page.evaluateHandle(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.find(l => l.textContent?.includes('Imprimir') && l.href?.includes('imprimir')) ||
                   document.querySelector('a[href*="/emissao/imprimir"]') ||
                   document.querySelector('.panel-footer a.btn-success') || null;
          });
          
          if (await handle.asElement()) {
            printButton = handle;
            logger.info(`✅ Botão de impressão encontrado no DOM em ${Date.now() - startTime}ms`);
            break;
          }
        } catch (err) {
          // Ignora erros de "Execution context was destroyed" na transição da página
        }
        await new Promise(r => setTimeout(r, 400));
      }
      
      if (!printButton) throw new Error('Timeout');
    } catch (e) {
      await debugScreenshot(page, 'sem-botao-imprimir');
      throw new Error('Botão de impressão não encontrado na página.');
    }

    // Definição do caminho final do arquivo (NOME PADRONIZADO)
    const finalFileName = `DAS-${cnpj.replace(/\D/g,'')}-${month}-${year}.pdf`;
    const finalFilePath = path.join(DOWNLOAD_PATH, finalFileName);

    // Captura o estado antes de qualquer clique (nome e mtime)
    const filesBeforeClick = new Map(
      fs.readdirSync(DOWNLOAD_PATH)
        .filter(f => f.endsWith('.pdf'))
        .map(f => [f, fs.statSync(path.join(DOWNLOAD_PATH, f)).mtimeMs])
    );

    // ✅ ESTRATÉGIA 1: Salvar via buffer da resposta
    logger.info('🔄 Iniciando download e tentando interceptar buffer...');
    
    const clickPromise = usedSelector?.includes('text:') 
      ? printButton.evaluate(b => b.click())
      : page.click(usedSelector);

    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/emissao/imprimir') && resp.status() === 200,
      { timeout: 25_000 }
    ).catch(() => null);

    await Promise.all([clickPromise, responsePromise]);
    const response = await responsePromise;

    let savedViaBuffer = false;
    if (response) {
      logger.info(`📦 Content-Type: ${response.headers()['content-type']}`);
      const saved = await savePdfFromResponse(response, finalFilePath);
      if (saved) {
        logger.info(`✅ PDF salvo via buffer: ${finalFilePath}`);
        const fakeHeader = { "content-disposition": `attachment; filename=${finalFileName}` };
        readBarcodePDF(fakeHeader);
        return [true, finalFileName];
      }
    }

    // ✅ ESTRATÉGIA 2: Fallback via filesystem
    logger.info('⚠️ Fallback via filesystem aguardando download...');
    
    // Aguarda qualquer PDF novo ou modificado
    const deadline = Date.now() + 40_000;
    let detectedFile = null;
    while (Date.now() < deadline) {
      const currentFiles = fs.readdirSync(DOWNLOAD_PATH).filter(f => f.endsWith('.pdf') && !f.endsWith('.crdownload'));
      
      const newFiles = currentFiles.filter(f => {
        try {
          const mtime = fs.statSync(path.join(DOWNLOAD_PATH, f)).mtimeMs;
          return !filesBeforeClick.has(f) || mtime > filesBeforeClick.get(f) + 100; // tolerância
        } catch { return false; }
      });
      
      if (newFiles.length > 0) {
        detectedFile = newFiles.find(f => f.includes('DAS')) || newFiles[0];
        logger.info(`📄 Novo/Atualizado PDF detectado no filesystem: ${detectedFile}`);
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (detectedFile) {
      const sourcePath = path.join(DOWNLOAD_PATH, detectedFile);
      
      // Renomeia para o nome padrão se necessário
      if (detectedFile !== finalFileName && fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, finalFilePath);
        logger.info(`📝 Renomeado: ${detectedFile} → ${finalFileName}`);
      }
      
      logger.info(`✅ PDF salvo via fallback: ${finalFilePath}`);
      
      // ✅ Chama readBarcodePDF com header contendo o NOVO nome do arquivo
      const fakeHeader = { "content-disposition": `attachment; filename="${finalFileName}"` };
      readBarcodePDF(fakeHeader);
      
      return [true, finalFileName];
    }

    // Se chegou aqui, falhou
    const allFiles = fs.readdirSync(DOWNLOAD_PATH)
      .filter(f => f.endsWith('.pdf') || f.endsWith('.crdownload') || f.includes('DAS'))
      .map(f => {
        try {
          return `${f} (${Math.round(fs.statSync(path.join(DOWNLOAD_PATH, f)).size/1024)}KB)`;
        } catch { return f; }
      });

    logger.warn(`🔍 Arquivos na pasta: [${allFiles.join(', ')}]`);
    throw new Error('Não foi possível detectar o PDF após todas as tentativas.');

  } catch (err) {
    await debugScreenshot(page, 'erro-inesperado');
    logger.error(`❌ Erro: ${err.message}`);
    logger.error(`🔍 Stack: ${err.stack}`);
    return [false, err.message];

  } finally {
    if (typeof onResponseHandler === 'function') {
      page.off('response', onResponseHandler);
    }
    await browser.close();
    logger.info('🔒 Browser fechado.');
  }
}

export { scraping };