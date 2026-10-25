#!/usr/bin/env node
/**
 * Sample: convert the checked-in lab/sample.pdf → lab/out/sample.epub
 *
 *   npm run sample
 *   # or: node lab/import-sample.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "../pdf2epub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(__dirname, "sample.pdf");
const outDir = path.join(__dirname, "out");
const epubPath = path.join(outDir, "sample.epub");

await fs.access(pdfPath);
await fs.mkdir(outDir, { recursive: true });

const result = await convert(pdfPath, {
  output: epubPath,
  title: "pdf2epub sample",
  author: "pdf2epub",
  lang: "en",
});

console.log(`[sample] input  ${pdfPath}`);
console.log(`[sample] output ${result.output} (${result.bytes} bytes)`);
console.log(`[sample] pages=${result.pages} chapters=${result.chapters}`);
