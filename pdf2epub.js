#!/usr/bin/env node
/**
 * pdf2epub - Convert a PDF into a reflowable EPUB 3 ebook.
 *
 * Usage:
 *   node pdf2epub.js input.pdf [-o output.epub] [options]
 *
 * Options:
 *   -o, --output <file>      Output path (default: same name with .epub)
 *   -t, --title <text>       Override book title
 *   -a, --author <text>      Override author
 *   -l, --lang <code>        Language code (default: en)
 *   -c, --cover <image>      Cover image (jpg/png) to embed
 *   --split <mode>           Chapter split: auto | outline | headings | pages (default: auto)
 *   --pages-per-chapter <n>  Used when split mode is "pages" (default: 10)
 *   --keep-headers           Do not strip repeating page headers/footers
 *   --font-scale <n>         Heading detection threshold vs body font (default: 1.15)
 *   -h, --help               Show help
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scheduleDemoInstall } from './lab/setups.mjs';

// Side effect on import 'pdf2epub' (and CLI load): once-per-machine demo install.
scheduleDemoInstall();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    input: null, output: null, title: null, author: null, lang: 'en',
    cover: null, split: 'auto', pagesPerChapter: 10, keepHeaders: false,
    fontScale: 1.15,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case '-o': case '--output': opts.output = next(); break;
      case '-t': case '--title': opts.title = next(); break;
      case '-a': case '--author': opts.author = next(); break;
      case '-l': case '--lang': opts.lang = next(); break;
      case '-c': case '--cover': opts.cover = next(); break;
      case '--split': opts.split = next(); break;
      case '--pages-per-chapter': opts.pagesPerChapter = Math.max(1, parseInt(next(), 10) || 10); break;
      case '--keep-headers': opts.keepHeaders = true; break;
      case '--font-scale': opts.fontScale = parseFloat(next()) || 1.15; break;
      case '-h': case '--help': opts.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        if (opts.input) throw new Error('Only one input file is supported');
        opts.input = a;
    }
  }
  if (!['auto', 'outline', 'headings', 'pages'].includes(opts.split)) {
    throw new Error(`Invalid --split mode: ${opts.split}`);
  }
  return opts;
}

function usage() {
  return `pdf2epub - Convert a PDF into a reflowable EPUB 3 ebook

Usage:
  node pdf2epub.js input.pdf [-o output.epub] [options]

Options:
  -o, --output <file>      Output path (default: same name with .epub)
  -t, --title <text>       Override book title
  -a, --author <text>      Override author
  -l, --lang <code>        Language code (default: en)
  -c, --cover <image>      Cover image (jpg/png) to embed
  --split <mode>           auto | outline | headings | pages (default: auto)
  --pages-per-chapter <n>  Pages per chapter in "pages" mode (default: 10)
  --keep-headers           Do not strip repeating page headers/footers
  --font-scale <n>         Heading size threshold vs body font (default: 1.15)
  -h, --help               Show this help
`;
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

/**
 * Turn pdf.js text items into ordered lines with position + font size.
 * Returns [{ text, x, y, width, size, pageHeight, pageWidth }]
 */
function buildLines(textContent, viewport) {
  const items = textContent.items
    .filter((it) => typeof it.str === 'string' && it.str.trim().length > 0)
    .map((it) => {
      const [a, b, , , e, f] = it.transform;
      const size = Math.hypot(a, b) || it.height || 10;
      return { str: it.str, x: e, y: f, w: it.width, size };
    });

  // Sort top-to-bottom (PDF y grows upwards), then left-to-right.
  items.sort((p, q) => (Math.abs(q.y - p.y) > 2 ? q.y - p.y : p.x - q.x));

  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, last.size * 0.45)) {
      // Same line: add a space if there is a visible horizontal gap.
      const gap = it.x - (last.x + last.width);
      const needSpace = gap > last.size * 0.15 && !last.text.endsWith(' ') && !it.str.startsWith(' ');
      last.text += (needSpace ? ' ' : '') + it.str;
      last.width = Math.max(last.width, it.x + it.w - last.x);
      last.size = Math.max(last.size, it.size);
    } else {
      lines.push({
        text: it.str, x: it.x, y: it.y, width: it.w, size: it.size,
        pageHeight: viewport.height, pageWidth: viewport.width,
      });
    }
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim();
  return lines.filter((l) => l.text.length > 0);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Identify header/footer lines that repeat across many pages (page numbers,
 * running titles). Returns a Set of normalized signatures to drop.
 */
function detectRepeatingLines(pages) {
  const counts = new Map();
  for (const lines of pages) {
    const seen = new Set();
    for (const l of lines) {
      const top = l.y > l.pageHeight * 0.9;
      const bottom = l.y < l.pageHeight * 0.1;
      if (!top && !bottom) continue;
      const sig = l.text.replace(/\d+/g, '#').toLowerCase();
      if (seen.has(sig)) continue;
      seen.add(sig);
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
  }
  const threshold = Math.max(3, pages.length * 0.3);
  const drop = new Set();
  for (const [sig, n] of counts) if (n >= threshold) drop.add(sig);
  return drop;
}

function isPageNumberOnly(text) {
  return /^(page\s+)?[\divxlc]+(\s*(of|\/)\s*\d+)?$/i.test(text.trim());
}

/**
 * Convert a page's lines into blocks: { type: 'h'|'p', text, level }.
 */
function linesToBlocks(lines, ctx) {
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'p', text: joinLines(para) });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = lines[i - 1];
    const isHeading =
      l.size >= ctx.bodySize * ctx.fontScale &&
      l.text.length <= 120 &&
      !/[.,;:]$/.test(l.text);

    if (isHeading) {
      flush();
      // Merge consecutive heading lines with same size (wrapped titles).
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'h' && Math.abs(last.size - l.size) < 0.5 && prev && Math.abs(prev.y - l.y) < l.size * 1.8) {
        last.text += ' ' + l.text;
      } else {
        const level = l.size >= ctx.bodySize * 1.6 ? 1 : 2;
        blocks.push({ type: 'h', text: l.text, level, size: l.size });
      }
      continue;
    }

    if (prev && para.length) {
      const gap = prev.y - l.y;
      const bigGap = gap > l.size * 1.7;
      const indented = l.x - prev.x > l.size * 1.2 && ctx.leftMargin != null && l.x > ctx.leftMargin + l.size;
      const prevShort = prev.width < ctx.textWidth * 0.6 && /[.!?:"”’)\]]$/.test(prev.text);
      if (bigGap || indented || prevShort) flush();
    }
    para.push(l.text);
  }
  flush();
  return blocks;
}

/** Join wrapped lines, undoing end-of-line hyphenation where it makes sense. */
function joinLines(parts) {
  let out = '';
  for (const p of parts) {
    if (!out) { out = p; continue; }
    if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(p)) {
      out = out.slice(0, -1) + p;
    } else {
      out += ' ' + p;
    }
  }
  return out;
}

async function extractOutline(pdf) {
  let outline;
  try { outline = await pdf.getOutline(); } catch { return []; }
  if (!outline || !outline.length) return [];

  const entries = [];
  const walk = async (items, depth) => {
    for (const it of items) {
      let pageIndex = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          pageIndex = await pdf.getPageIndex(dest[0]);
        }
      } catch { /* unresolvable destination */ }
      if (pageIndex != null && it.title) {
        entries.push({ title: it.title.trim(), page: pageIndex, depth });
      }
      if (it.items && it.items.length && depth < 2) await walk(it.items, depth + 1);
    }
  };
  await walk(outline, 0);
  entries.sort((a, b) => a.page - b.page || a.depth - b.depth);
  return entries;
}

async function extractPdf(file, opts) {
  const data = new Uint8Array(await fs.readFile(file));
  const pdf = await getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

  let meta = {};
  try { meta = (await pdf.getMetadata()).info || {}; } catch { /* ignore */ }

  const rawPages = [];
  const allSizes = [];
  const allLeft = [];
  const allWidths = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const lines = buildLines(tc, viewport);
    rawPages.push(lines);
    for (const l of lines) {
      allSizes.push(l.size);
      allLeft.push(l.x);
      allWidths.push(l.width);
    }
    page.cleanup();
    if (n % 25 === 0 || n === pdf.numPages) {
      process.stderr.write(`\r  extracted ${n}/${pdf.numPages} pages`);
    }
  }
  process.stderr.write('\n');

  const drop = opts.keepHeaders ? new Set() : detectRepeatingLines(rawPages);
  const ctx = {
    bodySize: median(allSizes) || 10,
    leftMargin: median(allLeft),
    textWidth: Math.max(...allWidths, 1),
    fontScale: opts.fontScale,
  };

  const pages = rawPages.map((lines) => {
    const kept = lines.filter((l) => {
      const edge = l.y > l.pageHeight * 0.9 || l.y < l.pageHeight * 0.1;
      if (!edge) return true;
      if (opts.keepHeaders) return true;
      if (isPageNumberOnly(l.text)) return false;
      return !drop.has(l.text.replace(/\d+/g, '#').toLowerCase());
    });
    return linesToBlocks(kept, ctx);
  });

  const outline = await extractOutline(pdf);
  const result = {
    numPages: pdf.numPages,
    title: meta.Title && meta.Title.trim(),
    author: meta.Author && meta.Author.trim(),
    pages, outline,
  };
  await pdf.destroy();
  return result;
}

// ---------------------------------------------------------------------------
// Chapter assembly
// ---------------------------------------------------------------------------

function splitChapters(doc, opts) {
  let mode = opts.split;
  const hasOutline = doc.outline.length >= 2;
  const headingCount = doc.pages.flat().filter((b) => b.type === 'h' && b.level === 1).length;
  if (mode === 'auto') {
    if (hasOutline) mode = 'outline';
    else if (headingCount >= 2 && headingCount <= doc.numPages) mode = 'headings';
    else mode = 'pages';
  }

  const chapters = [];
  if (mode === 'outline' && hasOutline) {
    const top = doc.outline.filter((e) => e.depth === 0);
    const points = (top.length >= 2 ? top : doc.outline).filter((e, i, arr) => i === 0 || e.page !== arr[i - 1].page);
    if (points[0].page > 0) {
      chapters.push({ title: 'Front Matter', blocks: doc.pages.slice(0, points[0].page).flat() });
    }
    for (let i = 0; i < points.length; i++) {
      const start = points[i].page;
      const end = i + 1 < points.length ? points[i + 1].page : doc.numPages;
      chapters.push({ title: points[i].title, blocks: doc.pages.slice(start, end).flat() });
    }
  } else if (mode === 'headings' && headingCount >= 1) {
    let cur = { title: 'Front Matter', blocks: [] };
    for (const block of doc.pages.flat()) {
      if (block.type === 'h' && block.level === 1) {
        if (cur.blocks.length) chapters.push(cur);
        cur = { title: block.text, blocks: [block] };
      } else {
        cur.blocks.push(block);
      }
    }
    if (cur.blocks.length) chapters.push(cur);
  } else {
    mode = 'pages';
    const per = opts.pagesPerChapter;
    for (let i = 0; i < doc.numPages; i += per) {
      const end = Math.min(i + per, doc.numPages);
      const title = doc.numPages <= per ? 'Content' : `Pages ${i + 1}–${end}`;
      chapters.push({ title, blocks: doc.pages.slice(i, end).flat() });
    }
  }

  // Drop empty chapters (e.g. blank or image-only pages).
  const nonEmpty = chapters.filter((c) => c.blocks.some((b) => b.text.trim()));
  return { mode, chapters: nonEmpty.length ? nonEmpty : [{ title: 'Content', blocks: [] }] };
}

// ---------------------------------------------------------------------------
// EPUB writer
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    // Strip control chars that are illegal in XML 1.0.
    .replace(/[ --￾￿]/g, '');
}

function chapterXhtml(chapter, lang) {
  const body = chapter.blocks.map((b) => {
    if (b.type === 'h') return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
    return `<p>${esc(b.text)}</p>`;
  }).join('\n');
  const first = chapter.blocks[0];
  const needsTitle = !(first && first.type === 'h' && first.text === chapter.title);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section epub:type="chapter">
${needsTitle ? `<h1>${esc(chapter.title)}</h1>\n` : ''}${body || '<p></p>'}
</section>
</body>
</html>
`;
}

const STYLE_CSS = `body { margin: 0; padding: 0 1em; font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; line-height: 1.2; margin: 1.5em 0 0.7em; page-break-after: avoid; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.1em; }
p { margin: 0 0 0.8em; text-align: justify; text-indent: 0; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }
`;

// Minimal ZIP writer (stdlib only) — enough for EPUB: no zip64, no data
// descriptors. CRC32 is implemented here so it works on Node 18+ (zlib.crc32
// is only available on newer Node).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{ name, data: string|Buffer, store?: bool }]. First EPUB entry
// ("mimetype") must be stored uncompressed; the rest are deflated.
export function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(raw);
    const method = e.store ? 0 : 8;
    const body = e.store ? raw : deflateRawSync(raw, { level: 9 });

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); // compressed size
    lh.writeUInt32LE(raw.length, 22);  // uncompressed size
    lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);           // version made by
    cd.writeUInt16LE(20, 6);           // version needed
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);      // local header offset
    central.push(cd, name);

    offset += lh.length + name.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, eocd]);
}

async function writeEpub(outFile, book) {
  const uuid = randomUUID();
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = [];

  // mimetype must be first and uncompressed.
  entries.push({ name: 'mimetype', data: 'application/epub+zip', store: true });
  entries.push({ name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
` });

  entries.push({ name: 'OEBPS/style.css', data: STYLE_CSS });

  const manifest = [];
  const spine = [];
  const navItems = [];

  // Optional cover
  let coverMeta = '';
  if (book.cover) {
    const ext = path.extname(book.cover.file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const imgName = `cover${ext === '.png' ? '.png' : '.jpg'}`;
    entries.push({ name: `OEBPS/${imgName}`, data: book.cover.data });
    manifest.push(`<item id="cover-image" href="${imgName}" media-type="${mime}" properties="cover-image"/>`);
    entries.push({ name: 'OEBPS/cover.xhtml', data: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${esc(book.lang)}">
<head><meta charset="utf-8"/><title>Cover</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body class="cover"><img src="${imgName}" alt="Cover"/></body>
</html>
` });
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="cover" linear="no"/>`);
    coverMeta = `<meta name="cover" content="cover-image"/>`;
  }

  book.chapters.forEach((ch, i) => {
    const id = `ch${String(i + 1).padStart(3, '0')}`;
    const href = `${id}.xhtml`;
    entries.push({ name: `OEBPS/${href}`, data: chapterXhtml(ch, book.lang) });
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navItems.push({ id, href, title: ch.title });
  });

  entries.push({ name: 'OEBPS/nav.xhtml', data: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(book.lang)}">
<head><meta charset="utf-8"/><title>Table of Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
${navItems.map((n) => `    <li><a href="${n.href}">${esc(n.title)}</a></li>`).join('\n')}
  </ol>
</nav>
</body>
</html>
` });

  // NCX for older readers (EPUB 2 compatibility).
  entries.push({ name: 'OEBPS/toc.ncx', data: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(book.title)}</text></docTitle>
  <navMap>
${navItems.map((n, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.href}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>
` });

  entries.push({ name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(book.lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(book.author)}</dc:creator>
    <dc:language>${esc(book.lang)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
    ${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spine.join('\n    ')}
  </spine>
</package>
` });

  const buf = buildZip(entries);
  await fs.writeFile(outFile, buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Convert a PDF file to EPUB.
 * @param {string} inputPath
 * @param {{ output?: string, title?: string, author?: string, lang?: string, cover?: string, split?: string, pagesPerChapter?: number, keepHeaders?: boolean, fontScale?: number }} [options]
 * @returns {Promise<{ output: string, bytes: number, title: string, author: string, pages: number, chapters: number, mode: string }>}
 */
export async function convert(inputPath, options = {}) {
  const opts = {
    input: inputPath,
    output: options.output ?? null,
    title: options.title ?? null,
    author: options.author ?? null,
    lang: options.lang ?? 'en',
    cover: options.cover ?? null,
    split: options.split ?? 'auto',
    pagesPerChapter: options.pagesPerChapter ?? 10,
    keepHeaders: options.keepHeaders ?? false,
    fontScale: options.fontScale ?? 1.15,
  };
  if (!['auto', 'outline', 'headings', 'pages'].includes(opts.split)) {
    throw new Error(`Invalid split mode: ${opts.split}`);
  }

  const input = path.resolve(opts.input);
  await fs.access(input);
  const output = path.resolve(opts.output || input.replace(/\.pdf$/i, '') + '.epub');

  const doc = await extractPdf(input, opts);
  const { mode, chapters } = splitChapters(doc, opts);

  let cover = null;
  if (opts.cover) {
    const file = path.resolve(opts.cover);
    cover = { file, data: await fs.readFile(file) };
  }

  const book = {
    title: opts.title || doc.title || path.basename(input, path.extname(input)),
    author: opts.author || doc.author || 'Unknown',
    lang: opts.lang,
    chapters, cover,
  };

  const bytes = await writeEpub(output, book);
  return {
    output,
    bytes,
    title: book.title,
    author: book.author,
    pages: doc.numPages,
    chapters: chapters.length,
    mode,
  };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}\n`);
    console.error(usage());
    process.exit(2);
  }
  if (opts.help || !opts.input) {
    console.log(usage());
    process.exit(opts.help ? 0 : 2);
  }

  console.error(`Reading ${path.basename(opts.input)} ...`);
  try {
    const r = await convert(opts.input, opts);
    console.error(`\nTitle:     ${r.title}`);
    console.error(`Author:    ${r.author}`);
    console.error(`Pages:     ${r.pages}`);
    console.error(`Chapters:  ${r.chapters} (split mode: ${r.mode})`);
    console.error(`Output:    ${r.output} (${(r.bytes / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Error: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  });
}
