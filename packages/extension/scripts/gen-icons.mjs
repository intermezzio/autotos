#!/usr/bin/env node
// Generate the toolbar icons: one rounded-square badge per grade (A–E) plus a
// grayed "?" for the unknown/no-data state, at every size the manifest needs.
//
// Self-contained: no image libraries. We rasterize a tiny 5x7 bitmap font onto an
// RGBA buffer and encode a PNG using Node's built-in zlib. Run via `npm run icons`.
//
//   node scripts/gen-icons.mjs   ->   public/icon/<grade>-<size>.png

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icon");
const SIZES = [16, 32, 48, 128];

// Grade -> background color. A green, ramping to E red; "unknown" is a muted gray
// so a site with no data reads as inactive rather than as any particular grade.
const COLORS = {
  a: [0x16, 0xa3, 0x4a],
  b: [0x4d, 0x9a, 0x1f],
  c: [0xca, 0x8a, 0x04],
  d: [0xea, 0x58, 0x0c],
  e: [0xdc, 0x26, 0x26],
  unknown: [0x9c, 0xa3, 0xaf],
};

const FG = [0xff, 0xff, 0xff]; // glyph color (white)

// 5x7 bitmap glyphs, rows top->bottom.
const GLYPHS = {
  a: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  b: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  c: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  d: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  e: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  unknown: ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

/** Render one badge to an RGBA Uint8Array of length size*size*4. */
function renderBadge(size, bg, glyph) {
  const px = new Uint8Array(size * size * 4); // transparent by default
  const radius = Math.round(size * 0.22);

  // Glyph geometry: fit it to ~62% of the icon, integer scale, centered.
  const scale = Math.max(1, Math.floor((size * 0.62) / GLYPH_H));
  const gw = GLYPH_W * scale;
  const gh = GLYPH_H * scale;
  const gx = Math.round((size - gw) / 2);
  const gy = Math.round((size - gh) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedRect(x, y, size, radius)) continue;
      let color = bg;
      // Is this pixel inside a lit glyph cell?
      const cx = Math.floor((x - gx) / scale);
      const cy = Math.floor((y - gy) / scale);
      if (cx >= 0 && cx < GLYPH_W && cy >= 0 && cy < GLYPH_H && glyph[cy][cx] === "1") {
        color = FG;
      }
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 0xff;
    }
  }
  return px;
}

/** True if (x,y) is inside a rounded rectangle filling the size x size canvas. */
function insideRoundedRect(x, y, size, r) {
  const max = size - 1;
  // Clamp the point to the inner rect defined by the corner-arc centers. The
  // distance from the point to that clamped center is the rounded-rect distance.
  const cx = Math.min(Math.max(x, r), max - r);
  const cy = Math.min(Math.max(y, r), max - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// --- minimal PNG encoder ----------------------------------------------------

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

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10,11,12 = compression, filter, interlace = 0

  // Raw scanlines, each prefixed with filter byte 0.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- main -------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const [grade, glyph] of Object.entries(GLYPHS)) {
  for (const size of SIZES) {
    const rgba = renderBadge(size, COLORS[grade], glyph);
    writeFileSync(join(OUT_DIR, `${grade}-${size}.png`), encodePng(size, rgba));
    count++;
  }
}
console.log(`wrote ${count} icons to ${OUT_DIR}`);
