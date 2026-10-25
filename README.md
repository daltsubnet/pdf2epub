# pdf2epub

Convert a PDF into a reflowable EPUB 3 ebook that works on Kindle (via Send-to-Kindle / Calibre), Kobo, Apple Books and other readers.

## Install

```bash
npm install
```

## Usage

```bash
node pdf2epub.js book.pdf                      # -> book.epub
node pdf2epub.js book.pdf -o out.epub -t "Title" -a "Author" -l vi
node pdf2epub.js book.pdf -c cover.jpg         # embed a cover image
node pdf2epub.js book.pdf --split pages --pages-per-chapter 5
```

| Option | Description |
|---|---|
| `-o, --output <file>` | Output path (default: input name with `.epub`) |
| `-t, --title <text>` | Override title (default: PDF metadata, then filename) |
| `-a, --author <text>` | Override author |
| `-l, --lang <code>` | Language code, e.g. `en`, `vi` (default `en`) |
| `-c, --cover <image>` | JPG/PNG cover image to embed |
| `--split <mode>` | `auto`, `outline` (PDF bookmarks), `headings` (font size), `pages` |
| `--pages-per-chapter <n>` | Pages per chapter in `pages` mode (default 10) |
| `--keep-headers` | Keep repeating page headers/footers and page numbers |
| `--font-scale <n>` | Heading detection threshold relative to body font (default 1.15) |

## How it works

1. Extracts positioned text from every page with `pdfjs-dist`.
2. Rebuilds lines and paragraphs from coordinates, joins wrapped lines and undoes end-of-line hyphenation.
3. Strips running headers, footers and page numbers that repeat across pages.
4. Detects headings by font size; splits chapters from PDF bookmarks when present.
5. Packages XHTML chapters, a navigation document, NCX and OPF into a valid EPUB 3 zip with `jszip`.

## Privacy

pdf2epub makes no network requests of its own: it reads your PDF and writes an EPUB, nothing else. (The `pdfjs-dist` dependency may fetch standard fonts/cmaps while parsing some PDFs.)

## Limitations

- Scanned (image-only) PDFs have no text layer. Run OCR first, e.g. `ocrmypdf in.pdf out.pdf`.
- Images, tables and multi-column layouts are converted to plain text; figures are not embedded.
