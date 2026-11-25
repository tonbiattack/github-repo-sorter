/**
 * Builds the Chrome Web Store upload ZIP from `dist/`.
 *
 * The archive contains only the files the extension needs at runtime, with
 * `manifest.json` at the archive root (the layout the store expects). The
 * output name carries the version so uploads are traceable.
 *
 * Usage: node scripts/package.mjs
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'release');

/** Runtime files only; anything else in dist/ is excluded from the upload. */
const REQUIRED = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'options.html',
  'options.js',
  'options.css',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** Minimal ZIP writer (deflate, no zip64) so packaging needs no dependencies. */
async function writeZip(entries, target) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await readFile(entry.absolute);
    const compressed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const { time, day } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const stream = createWriteStream(target);
  for (const chunk of [...chunks, centralBuffer, end]) stream.write(chunk);
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });
}

async function main() {
  const manifestPath = path.join(dist, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const missing = [];
  for (const relative of REQUIRED) {
    try {
      await stat(path.join(dist, relative));
    } catch {
      missing.push(relative);
    }
  }
  if (missing.length > 0) {
    throw new Error(`dist/ is incomplete (run npm run build): missing ${missing.join(', ')}`);
  }

  // Fail loudly if dist/ contains files that would ship unintentionally.
  const unexpected = [];
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (!REQUIRED.includes(relative)) unexpected.push(relative);
    }
  }
  await walk(dist);
  if (unexpected.length > 0) {
    throw new Error(`dist/ has files that are not part of the release: ${unexpected.join(', ')}`);
  }

  const entries = [];
  for (const relative of REQUIRED) {
    const absolute = path.join(dist, relative);
    entries.push({ name: relative, absolute, mtime: (await stat(absolute)).mtime });
  }

  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, `github-repo-sorter-${manifest.version}.zip`);
  await rm(target, { force: true });
  await writeZip(entries, target);
  const { size } = await stat(target);
  console.log(`packaged ${path.relative(root, target)} (${entries.length} files, ${size} bytes)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
