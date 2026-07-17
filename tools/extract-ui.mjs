#!/usr/bin/env node
// Converts the original res/*.bmp UI resources (emotion-wheel faces, toolbar
// strips) to PNG for the web UI.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = 'sources/comic-chat/v2.5-beta-1/res';
const OUT = 'public/ui';

function decodeBmp(buf) {
  if (buf.readUInt16LE(0) !== 0x4d42) throw new Error('not BM');
  const bfOffBits = buf.readUInt32LE(10);
  const biSize = buf.readUInt32LE(14);
  const w = buf.readInt32LE(18);
  const hRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  const clrUsed = buf.readUInt32LE(46);
  if (compression !== 0) throw new Error(`compression ${compression} unsupported`);
  const h = Math.abs(hRaw);
  const nColors = bpp <= 8 ? clrUsed || 1 << bpp : 0;
  const palette = [];
  let p = 14 + biSize;
  for (let i = 0; i < nColors; i++) {
    palette.push([buf[p + 2], buf[p + 1], buf[p]]); // BGRX → RGB
    p += 4;
  }
  const stride = ((w * bpp + 31) >> 5) << 2;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = hRaw < 0 ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      let c;
      if (bpp === 8) c = palette[buf[bfOffBits + row * stride + x]];
      else if (bpp === 4) {
        const b = buf[bfOffBits + row * stride + (x >> 1)];
        c = palette[x & 1 ? b & 0x0f : (b >> 4) & 0x0f];
      } else if (bpp === 1) {
        const b = buf[bfOffBits + row * stride + (x >> 3)];
        c = palette[(b >> (7 - (x & 7))) & 1];
      } else if (bpp === 24) {
        const i = bfOffBits + row * stride + x * 3;
        c = [buf[i + 2], buf[i + 1], buf[i]];
      } else throw new Error(`bpp ${bpp}`);
      const i = (y * w + x) * 4;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return { rgba, w, h };
}

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
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(SRC, 'chat.ico'), path.join('public', 'favicon.ico'));
let n = 0;
for (const f of fs.readdirSync(SRC).sort()) {
  if (!/\.bmp$/i.test(f)) continue;
  try {
    const img = decodeBmp(fs.readFileSync(path.join(SRC, f)));
    fs.writeFileSync(
      path.join(OUT, f.replace(/\.bmp$/i, '.png')),
      encodePng(img.rgba, img.w, img.h),
    );
    n++;
  } catch (e) {
    console.error(`FAIL ${f}: ${e.message}`);
  }
}
console.log(`${n} UI bitmaps converted → ${OUT}`);
