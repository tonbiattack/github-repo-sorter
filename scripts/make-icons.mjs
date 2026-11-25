/**
 * Generates the extension icons as PNG files without external dependencies.
 *
 * The mark is a downward sort arrow over three bars of decreasing length,
 * drawn in GitHub's accent blue on a transparent background. It is generated
 * deterministically so the icons can be rebuilt from source at any time.
 *
 * Usage: node scripts/make-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'icons');
const SIZES = [16, 32, 48, 128];

/** GitHub accent blue (#0969da). */
const ACCENT = [9, 105, 218];

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draws the mark with 4x supersampling so small sizes stay legible. */
function render(size) {
  const scale = 4;
  const big = size * scale;
  const pixels = Buffer.alloc(size * size * 4);

  const inRect = (x, y, left, top, right, bottom) =>
    x >= left * big && x < right * big && y >= top * big && y < bottom * big;

  // Three bars, left-aligned, decreasing in length (a sort indicator).
  // Artwork spans 12.5%–87.5% so the 128px icon keeps the 16px transparent
  // padding the Chrome Web Store asks for (96x96 of actual artwork).
  const bars = [
    { top: 0.125, bottom: 0.25, left: 0.125, right: 0.875 },
    { top: 0.323, bottom: 0.448, left: 0.125, right: 0.625 },
    { top: 0.521, bottom: 0.646, left: 0.125, right: 0.375 },
  ];
  // Downward chevron below the bars, kept clear of them.
  const chevron = (x, y) => {
    const nx = x / big;
    const ny = y / big;
    if (ny < 0.72 || ny > 0.875) return false;
    const t = (ny - 0.72) / 0.155;
    const halfWidth = 0.375 * (1 - t);
    return Math.abs(nx - 0.5) <= halfWidth;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = x * scale + sx;
          const py = y * scale + sy;
          const onBar = bars.some((bar) => inRect(px, py, bar.left, bar.top, bar.right, bar.bottom));
          if (onBar || chevron(px, py)) hits += 1;
        }
      }
      const alpha = Math.round((hits / (scale * scale)) * 255);
      const offset = (y * size + x) * 4;
      pixels[offset] = ACCENT[0];
      pixels[offset + 1] = ACCENT[1];
      pixels[offset + 2] = ACCENT[2];
      pixels[offset + 3] = alpha;
    }
  }
  return encodePng(size, pixels);
}

await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon-${size}.png`);
  await writeFile(file, render(size));
  console.log(`wrote ${path.relative(root, file)}`);
}
