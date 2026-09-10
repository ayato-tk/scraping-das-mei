#!/usr/bin/env node
import inquirer from 'inquirer';
import dotenv from 'dotenv';
import { validateCNPJ } from './validateCNPJ.js';
import { validateYear, validateMonth, createMonthRange } from './validateDate.js';
import { scraping } from './scraping.js';
import { logger } from './loggers.js';

// Load environment variables from .env file
dotenv.config();

console.log = function() {};

async function main() {
  console.log('\x1b[36m', '**************************', '\x1b[0m');
  console.log('\x1b[36m', '** Emissão Guia DAS MEI **', '\x1b[0m');
  console.log('\x1b[36m', '**************************', '\x1b[0m');
  console.log('');
  const d = new Date();
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "headless",
      message: "Usar modo interativo (headless off)?",
      choices: ["Não", "Sim"],
      filter(answers) {
        return answers === 'Sim' ? false : true;
      }
    },
    {
      type: 'input',
      name: 'cnpj',
      message: 'Informe o CNPJ:',
      default: process.env.DEFAULT_CNPJ_INPUT,
      async validate(value) {
        const valid = await validateCNPJ(value);
        return valid[0] || valid[1];
      },
      filter(answers) {
        return answers.toString();
      }
    },
    {
      type: 'input',
      name: 'year',
      message: 'Informe o ano:',
      default: d.getFullYear(),
      validate(value) {
        const valid = validateYear(value);
        return valid[0] || valid[1];
      },
      filter(answers) {
        return answers.toString();
      }
    },
    {
      type: 'input',
      name: 'startMonth',
      message: 'Informe o mês inicial:',
      default: '01',
      validate(value) {
        const valid = validateMonth(value);
        return valid[0] || valid[1];
      },
      filter(answers) {
        return answers.toString().padStart(2, '0');
      }
    },
    {
      type: 'input',
      name: 'endMonth',
      message: 'Informe o mês final:',
      default: String(Math.max(1, d.getMonth())).padStart(2, '0'),
      validate(value, currentAnswers) {
        const valid = validateMonth(value);
        if (!valid[0]) return valid[1];
        if (parseInt(value, 10) < parseInt(currentAnswers.startMonth, 10)) {
          return 'O mês final precisa ser igual ou posterior ao mês inicial.';
        }
        return true;
      },
      filter(answers) {
        return answers.toString().padStart(2, '0');
      }
    },
  ]);

  const months = createMonthRange(answers.startMonth, answers.endMonth);
  logger.info(`Período selecionado: ${months.join(', ')}/${answers.year}`);

  const result = await scraping({ ...answers, months });
  if (!result[0]) process.exitCode = 1;

}

main().catch((error) => {
  logger.error(`Erro inesperado: ${error.message}`);
  process.exitCode = 1;
});

