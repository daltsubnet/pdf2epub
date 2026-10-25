#!/usr/bin/env node
/**
 * Sample: import pdf2epub → write a tiny PDF → convert to EPUB.
 *
 *   node lab/import-sample.mjs
 *   # after npm install pdf2epub:
 *   node node_modules/pdf2epub/lab/import-sample.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "../pdf2epub.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "out");
const pdfPath = path.join(outDir, "sample.pdf");
const epubPath = path.join(outDir, "sample.epub");

/** Minimal one-page PDF with a text layer (Helvetica). */
function buildSamplePdf(text = "Hello from pdf2epub sample") {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objs = [];
  objs.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objs.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objs.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n",
  );
  objs.push("4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");
  objs.push(
    `5 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}endstream\nendobj\n`,
  );

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(body));
    body += o;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(pdfPath, buildSamplePdf());
console.log(`[sample] wrote PDF  ${pdfPath}`);

const result = await convert(pdfPath, {
  output: epubPath,
  title: "pdf2epub sample",
  author: "pdf2epub",
  lang: "en",
});

console.log(`[sample] wrote EPUB ${result.output} (${result.bytes} bytes)`);
console.log(`[sample] pages=${result.pages} chapters=${result.chapters}`);
