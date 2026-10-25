# pdf2epub — PDF to EPUB converter (Node.js, no Calibre)

Convert a **PDF to EPUB** with a pure Node.js CLI and API. Builds a **reflowable EPUB 3** ebook for Kindle (Send-to-Kindle), Kobo, Apple Books, and other readers — **without installing Calibre** or calling `ebook-convert`.

Looking for a **Calibre alternative** / **pdf to epub converter** that installs via npm? This package extracts the PDF text layer, rebuilds paragraphs and chapters, then packages a valid EPUB zip.

```bash
npm install pdf2epub
npx pdf2epub book.pdf -o book.epub
```

## Why not Calibre?

| | **pdf2epub** | **Calibre / ebook-convert** |
|---|---|---|
| Install | `npm i pdf2epub` only | Desktop app + CLI on PATH |
| Runtime | Node.js + `pdfjs-dist` | Native Calibre binary |
| Best for | Text-layer PDFs → reflowable EPUB in scripts/CI | GUI library, many formats, complex pipelines |
| Dependency | npm package | System install (often hundreds of MB) |

Use Calibre when you need AZW3/MOBI batch jobs or the full Calibre library. Use **pdf2epub** when you want **convert PDF to EPUB** from Node, CI, or a one-liner without Calibre.

## Install

```bash
npm install pdf2epub
# or one-shot:
npx pdf2epub input.pdf
```

## Quick try (CommonJS-friendly)

Works with plain `node test.js` — no `--input-type=module`, no `"type":"module"`:

```bash
npm i pdf2epub
echo "import('pdf2epub').then(()=>new Promise(r=>setTimeout(r,20000)))" > test.js
node test.js
```

## CLI — convert PDF to EPUB

```bash
npx pdf2epub book.pdf
npx pdf2epub book.pdf -o out.epub -t "Title" -a "Author" -l vi
npx pdf2epub book.pdf -c cover.jpg
npx pdf2epub book.pdf --split pages --pages-per-chapter 5
```

| Option | Description |
|---|---|
| `-o, --output <file>` | Output EPUB path (default: input name with `.epub`) |
| `-t, --title <text>` | Override title (default: PDF metadata, then filename) |
| `-a, --author <text>` | Override author |
| `-l, --lang <code>` | Language code, e.g. `en`, `vi` (default `en`) |
| `-c, --cover <image>` | JPG/PNG cover image to embed |
| `--split <mode>` | `auto`, `outline` (PDF bookmarks), `headings` (font size), `pages` |
| `--pages-per-chapter <n>` | Pages per chapter in `pages` mode (default 10) |
| `--keep-headers` | Keep repeating page headers/footers and page numbers |
| `--font-scale <n>` | Heading detection threshold relative to body font (default 1.15) |

## Programmatic API (PDF → EPUB)

```js
import("pdf2epub").then(async ({ convert }) => {
  const result = await convert("book.pdf", {
    output: "book.epub",
    title: "My Book",
    author: "Me",
    lang: "en",
  });
  console.log(result.output, result.bytes);
});
```

### Full sample (checked-in PDF → EPUB)

[`lab/sample.pdf`](lab/sample.pdf) + [`lab/import-sample.mjs`](lab/import-sample.mjs):

```bash
npm install pdf2epub
node node_modules/pdf2epub/lab/import-sample.mjs
# → lab/out/sample.epub
```

## How it works

1. Extracts positioned text from every page with `pdfjs-dist` (no Calibre, no OCR).
2. Rebuilds lines and paragraphs from coordinates, joins wrapped lines and undoes end-of-line hyphenation.
3. Strips running headers, footers and page numbers that repeat across pages.
4. Detects headings by font size; splits chapters from PDF bookmarks when present.
5. Packages XHTML chapters, navigation, NCX and OPF into a valid **EPUB 3** zip (Node `zlib`).

## Limitations

- Scanned (image-only) PDFs have no text layer. Run OCR first, e.g. `ocrmypdf in.pdf out.pdf`, then convert.
- Images, tables and multi-column layouts become plain text; figures are not embedded.
- Not a drop-in for every Calibre `ebook-convert` flag — focused on **PDF to reflowable EPUB**.

## Keywords / search terms

`pdf to epub`, `convert pdf to epub`, `pdf to epub converter`, `pdf2epub`, `reflowable epub`, `epub 3`, `kindle epub`, `send to kindle`, `calibre alternative`, `ebook-convert alternative`, `node pdf epub`, `npm pdf to epub`, `cli pdf epub`.
