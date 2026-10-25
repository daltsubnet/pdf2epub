// Smoke test for the stdlib ZIP writer (no framework, no fixtures).
// Run: npm test
import assert from 'node:assert';
import { inflateRawSync } from 'node:zlib';
import { buildZip } from './pdf2epub.js';

const payload = 'Hello EPUB. '.repeat(200);
const zip = buildZip([
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  { name: 'OEBPS/content.opf', data: payload },
]);

// End of central directory present with 2 entries.
assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'EOCD signature');
assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2, 'entry count');

// First local entry is "mimetype", stored uncompressed (method 0), first byte.
assert.equal(zip.readUInt32LE(0), 0x04034b50, 'local header signature');
assert.equal(zip.readUInt16LE(8), 0, 'mimetype stored (method 0)');
const nameLen = zip.readUInt16LE(26);
assert.equal(zip.slice(30, 30 + nameLen).toString(), 'mimetype', 'mimetype is first');

// Second entry round-trips through inflate back to the original payload.
const comp = zip.readUInt32LE(18);            // mimetype compressed size
const mimeData = 'application/epub+zip'.length;
const off2 = 30 + nameLen + comp;             // start of 2nd local header
assert.equal(zip.readUInt16LE(off2 + 8), 8, 'opf deflated (method 8)');
const n2 = zip.readUInt16LE(off2 + 26);
const body2Len = zip.readUInt32LE(off2 + 18);
const body2 = zip.slice(off2 + 30 + n2, off2 + 30 + n2 + body2Len);
assert.equal(inflateRawSync(body2).toString(), payload, 'deflate round-trips');
assert.equal(mimeData, comp, 'stored size == raw size');

console.log('ok - zip writer produces a valid, round-trippable archive');
