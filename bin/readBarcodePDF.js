import { PDFBarcodeJs } from "pdf-barcode";
import { logger } from './loggers.js';
import { addDac } from "./addDAC.js";
import { sendSMS } from "./sendSMS.js";
import path from "path";

// path to save the DAS tab
const downloadPath = path.join(process.cwd(), "bin");

const configs = {
  scale: {
    once: true,
    value: 3,
    start: 3,
    step: 0.6,
    stop: 4.8,
  },
  resultOpts: {
    singleCodeInPage: true,
    multiCodesInPage: false,
    maxCodesInPage: 1,
  },
  patches: ["x-small", "small", "medium"],
  improve: true,
  noisify: true,
  quagga: {
    inputStream: {},
    locator: {
      halfSample: false,
    },
    decoder: {
      readers: ["i2of5_reader"],
      multiple: false,
    },
    locate: true,
  },
};

//Reads the barcode from a PDF file
function readBarcodePDF(header) {
  if (typeof header["content-disposition"] === "string") {
    if (header["content-disposition"].includes("filename")) {
      const filename = header["content-disposition"].replace(
        "attachment; filename=",
        ""
      ).replace(/"/g, '');
      const filePath = path.join(downloadPath, filename);
      PDFBarcodeJs.decodeDocument(filePath, configs, (response) => {
        if (!response.success || response.codes.length === 0) {
          logger.warn(`Nenhum código de barras encontrado em ${filename}.`);
          return;
        }

        response.codesDetailed.forEach(({ code, page }) => {
          const barcodeWithDAC = addDac(code);
          sendSMS(barcodeWithDAC);
          logger.info(`Barcode (página ${page}): ${barcodeWithDAC}`);
        });
      });
    }
  }
}

export { readBarcodePDF };
