#!/usr/bin/env node
// Extracts Microsoft Comic Chat art assets (.avb characters, .bgb backgrounds)
// into web-friendly PNG + JSON, faithfully following the original reader in
// sources/comic-chat/v2.5-beta-1/avbfile.cpp (all structs #pragma pack(1), LE).
//
// Usage: node tools/extract-avb.mjs [--src <dir>]... [--out public/art]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Constants from avbfile.h

const AF_MAGICNUM = 0x81;
const AF_MAGICNUM_NEW = 0x8181;

const AT_COMPLEX = 2;
const AT_BACKDROP = 3;

const AK = {
  NAME: 1,
  FLAGS: 2,
  ICON: 3,
  NFACES: 4,
  NTORSOS: 5,
  STARTDATA: 6,
  ENDDATA: 7,
  STYLE: 8,
  NBODIES: 9,
  NFACES2: 10,
  NTORSOS2: 11,
  NBODIES2: 12,
  ICON_NEW: 256,
  COLORPALETTE: 257,
  BACKDROP: 258,
  COPYRIGHT: 259,
  ORIGINAL_URL: 260,
  OVERRIDE_URL: 261,
  USAGE_FLAGS: 262,
  OFFSET_ADJUSTMENT: 263,
};

const AIF_DIB = 0;
const AIF_LZDEFLATE = 1;

const AIP_NOPALETTE = 0;
const AIP_GLOBALPALETTE = 1;
const AIP_LOCALPALETTE = 2;
const AIP_MONOCHROME = 3;
const AIP_MASKEDMONO = 4;
const AIP_DUALMASK = 5;

// avatario.cpp emFloats[] index table. Angles are i*2*PI/8 for wheel emotions.
const EMOTION_NAMES = [
  'none',
  'happy',
  'coy',
  'bored',
  'scared',
  'sad',
  'angry',
  'shout',
  'laugh',
  'neutral',
  'wave',
  'pointother',
  'pointself',
  'doublepoint',
  'shrug',
  'walk3qr',
  'walkside',
  'walk3qf',
];

// The Art Pack 1 Denise AVB maps its sad head to scared as well. The newer
// core AVB keeps the updated drawing but drops that record, so retain the
// official alias while preferring the newer art and copyright metadata.
const OFFICIAL_FACE_ALIASES = {
  denise: [
    { fromEmotion: 'sad', fromIntensity: 1, emotion: 'scared', emotionIndex: 4, intensity: 1 },
  ],
};

// ---------------------------------------------------------------------------
// Little-endian buffer reader

class Reader {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  u8() {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n) {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  skip(n) {
    this.pos += n;
  }
  cstr(max) {
    // CAvatarStream::ReadString semantics: read until NUL, bounded.
    let out = '';
    for (let i = 0; i < max; i++) {
      const c = this.u8();
      if (c === 0) return out;
      out += String.fromCharCode(c);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// AVB container parsing

function parseRecords(r, { count, faceFields, oldTag }) {
  // Mirrors LoadBodyRecs/LoadFaceRecs/LoadTorsoRecs incl. the ditto rule.
  const recs = [];
  let prevImageOff = 0;
  let prev = null;
  for (let i = 0; i < count; i++) {
    const rec = {};
    rec.imageOff = r.u32();
    rec.maskOff = r.u32();
    rec.auraOff = r.u32();
    rec.emotionIndex = r.u16();
    rec.intensity = r.u8() / 255;
    if (faceFields === 'face') {
      rec.cx = r.i16();
      rec.cy = r.i16();
      rec.cxDelta = r.i16();
      rec.cyDelta = r.i16();
      rec.x = r.i16();
      rec.y = r.i16();
    } else if (faceFields === 'torso') {
      rec.cx = r.i16();
      rec.cy = r.i16();
    } else {
      // rbody (simple avatar)
      rec.x = r.i16();
      rec.y = r.i16();
    }
    // New-format tail: 3 format bytes + 3 palette-type bytes. For old tags the
    // C code reads these from the padding area of the record (union overlay),
    // so we do exactly the same, then skip the remaining padding.
    rec.formats = [r.u8(), r.u8(), r.u8()];
    rec.palettes = [r.u8(), r.u8(), r.u8()];
    if (oldTag) r.skip(10); // byPadding[16] minus the 6 bytes just consumed
    if (rec.imageOff !== 0 && rec.imageOff === prevImageOff) {
      rec.ditto = true; // shares pose with previous record
      rec.poseKey = prev.poseKey;
    } else {
      rec.poseKey = `${rec.imageOff}_${rec.maskOff}_${rec.auraOff}`;
    }
    prevImageOff = rec.imageOff;
    prev = rec;
    recs.push(rec);
  }
  return recs;
}

function parseAvb(buf) {
  const r = new Reader(buf);
  const magic = r.u16();
  if (magic !== AF_MAGICNUM && magic !== AF_MAGICNUM_NEW) {
    throw new Error(`bad magic 0x${magic.toString(16)}`);
  }
  const type = r.u16();
  const version = r.u16();

  const av = {
    type,
    version,
    name: null,
    style: 0,
    flags: 0,
    copyright: null,
    originalUrl: null,
    overrideUrl: null,
    icon: null,
    faces: [],
    torsos: [],
    bodies: [],
    backdrop: null,
    globalPalette: null,
  };
  let adjust = 0;

  loop: while (r.pos < buf.length) {
    const tag = r.u16();
    let size = 0;
    if (tag >= AK.ICON_NEW) size = r.u16();
    switch (tag) {
      case AK.STARTDATA:
        break loop;
      case AK.NAME:
        av.name = r.cstr(60);
        break;
      case AK.ORIGINAL_URL:
        av.originalUrl = r.cstr(512);
        break;
      case AK.OVERRIDE_URL:
        av.overrideUrl = r.cstr(512);
        break;
      case AK.COPYRIGHT:
        av.copyright = r.cstr(256);
        break;
      case AK.USAGE_FLAGS:
        r.u8();
        break;
      case AK.STYLE:
        av.style = r.u16();
        break;
      case AK.FLAGS:
        av.flags = r.u16();
        break;
      case AK.ICON: {
        const off = r.u32();
        av.icon = {
          imageOff: off + (off ? adjust : 0),
          maskOff: 0,
          auraOff: 0,
          formats: [AIF_DIB, 0, 0],
          palettes: [AIP_NOPALETTE, 0, 0],
        };
        break;
      }
      case AK.ICON_NEW: {
        const off = r.u32();
        const fmt = r.u8();
        const pal = r.u8();
        av.icon = {
          imageOff: off + (off ? adjust : 0),
          maskOff: 0,
          auraOff: 0,
          formats: [fmt, 0, 0],
          palettes: [pal, 0, 0],
        };
        break;
      }
      case AK.COLORPALETTE: {
        const n = r.u16();
        const pal = [];
        for (let i = 0; i < n; i++) pal.push([r.u8(), r.u8(), r.u8()]); // file order R,G,B
        av.globalPalette = pal;
        break;
      }
      case AK.OFFSET_ADJUSTMENT:
        adjust += r.i32();
        break;
      case AK.NFACES:
      case AK.NFACES2:
        av.faces = parseRecords(r, {
          count: r.u16(),
          faceFields: 'face',
          oldTag: tag === AK.NFACES,
        });
        break;
      case AK.NTORSOS:
      case AK.NTORSOS2:
        av.torsos = parseRecords(r, {
          count: r.u16(),
          faceFields: 'torso',
          oldTag: tag === AK.NTORSOS,
        });
        break;
      case AK.NBODIES:
      case AK.NBODIES2:
        av.bodies = parseRecords(r, {
          count: r.u16(),
          faceFields: 'rbody',
          oldTag: tag === AK.NBODIES,
        });
        break;
      case AK.BACKDROP: {
        const off = r.u32();
        const fmt = r.u8();
        const pal = r.u8();
        av.backdrop = {
          imageOff: off + (off ? adjust : 0),
          maskOff: 0,
          auraOff: 0,
          formats: [fmt, 0, 0],
          palettes: [pal, 0, 0],
        };
        break;
      }
      default:
        if (tag >= AK.ICON_NEW) {
          r.skip(size);
        } else throw new Error(`unknown old tag ${tag} @${r.pos - 2}`);
    }
  }

  // Apply offset adjustment to records (normally 0; mirrors ADJUST_OFFSET).
  if (adjust !== 0) {
    for (const list of [av.faces, av.torsos, av.bodies]) {
      for (const rec of list) {
        if (rec.imageOff) rec.imageOff += adjust;
        if (rec.maskOff) rec.maskOff += adjust;
        if (rec.auraOff) rec.auraOff += adjust;
      }
    }
  }
  return av;
}

// ---------------------------------------------------------------------------
// Image decoding: embedded BMP (AIF_DIB) and zlib DIB (AIF_LZDEFLATE)

function decodeBmpAt(buf, off) {
  const r = new Reader(buf, off);
  const bfType = r.u16();
  if (bfType !== 0x4d42) throw new Error('not BM');
  const bfSize = r.u32();
  r.skip(4); // reserved
  const bfOffBits = r.u32();
  const biSize = r.u32();
  let w, h, bpp, compression, clrUsed;
  if (biSize === 12) {
    // BITMAPCOREHEADER
    w = r.u16();
    h = r.u16();
    r.u16();
    bpp = r.u16();
    compression = 0;
    clrUsed = 0;
  } else {
    w = r.i32();
    h = r.i32();
    r.u16();
    bpp = r.u16();
    compression = r.u32();
    r.skip(12); // sizeImage, xppm, yppm
    clrUsed = r.u32();
    r.skip(4); // clrImportant
    r.pos = off + 14 + biSize; // any header extension
  }
  const nColors = bpp <= 8 ? clrUsed || 1 << bpp : 0;
  const palette = [];
  for (let i = 0; i < nColors; i++) {
    if (biSize === 12) {
      const b = r.u8(),
        g = r.u8(),
        rr = r.u8();
      palette.push([rr, g, b]);
    } else {
      const b = r.u8(),
        g = r.u8(),
        rr = r.u8();
      r.u8();
      palette.push([rr, g, b]);
    }
  }
  const dataSize = bfSize - bfOffBits;
  let rows = buf.subarray(off + bfOffBits, off + bfOffBits + dataSize);
  const stride = ((w * bpp + 31) >> 5) << 2;
  if (compression === 1 || compression === 2) {
    rows = decodeRle(rows, w, Math.abs(h), bpp, compression, stride);
  } else {
    rows = Buffer.from(rows.subarray(0, stride * Math.abs(h)));
  }
  return { w, h: Math.abs(h), bpp, palette, rows, stride, topDown: h < 0 };
}

function decodeRle(data, w, h, bpp, compression, stride) {
  // RLE8 (compression=1) / RLE4 (compression=2) → packed rows
  const out = Buffer.alloc(stride * h);
  let x = 0,
    y = 0,
    i = 0;
  const put = (val) => {
    if (x >= w || y >= h) {
      x++;
      return;
    }
    if (bpp === 8) out[y * stride + x] = val;
    else {
      const idx = y * stride + (x >> 1);
      if (x & 1) out[idx] |= val & 0x0f;
      else out[idx] |= (val & 0x0f) << 4;
    }
    x++;
  };
  while (i + 1 < data.length) {
    const count = data[i++],
      code = data[i++];
    if (count > 0) {
      for (let k = 0; k < count; k++) {
        if (bpp === 8) put(code);
        else put(k & 1 ? code & 0x0f : (code >> 4) & 0x0f);
      }
    } else if (code === 0) {
      x = 0;
      y++;
    } else if (code === 1) break;
    else if (code === 2) {
      x += data[i++];
      y += data[i++];
    } else {
      // absolute run
      if (bpp === 8) {
        for (let k = 0; k < code; k++) put(data[i++]);
        if (code & 1) i++;
      } else {
        for (let k = 0; k < code; k++) {
          const b = data[i + (k >> 1)];
          put(k & 1 ? b & 0x0f : (b >> 4) & 0x0f);
        }
        i += Math.ceil(code / 2);
        if (Math.ceil(code / 2) & 1) i++;
      }
    }
  }
  return out;
}

const MONO_PALETTE = [
  [255, 255, 255],
  [0, 0, 0],
];
const MASKED_MONO_PALETTE = [
  [255, 255, 255],
  [0, 0, 0],
  [128, 0, 0],
  [0, 0, 128],
];

function decodeImage(buf, off, format, paletteType, globalPalette) {
  if (off === 0) return null;
  if (format === AIF_DIB) {
    const img = decodeBmpAt(buf, off);
    img.paletteType = paletteType;
    return img;
  }
  if (format !== AIF_LZDEFLATE) throw new Error(`unknown image format ${format}`);

  const r = new Reader(buf, off);
  // GetProperPalette runs first (CAvatarFileZlibImage::Read)
  let palette = null;
  if (paletteType === AIP_LOCALPALETTE) {
    const tag = r.u16();
    if (tag !== AK.COLORPALETTE) throw new Error('expected local palette record');
    r.u16(); // record size (tag >= 256 carries one)
    const n = r.u16();
    palette = [];
    for (let i = 0; i < n; i++) palette.push([r.u8(), r.u8(), r.u8()]);
  } else if (paletteType === AIP_GLOBALPALETTE) {
    palette = globalPalette;
  } else if (paletteType === AIP_MONOCHROME) {
    palette = MONO_PALETTE;
  } else if (paletteType === AIP_MASKEDMONO || paletteType === AIP_DUALMASK) {
    palette = MASKED_MONO_PALETTE;
  }

  const biSize = r.u32();
  if (biSize < 40 || biSize > 240) throw new Error(`bad biSize ${biSize}`);
  const w = r.i32();
  const h = r.i32();
  r.u16(); // planes
  const bpp = r.u16();
  r.skip(biSize - 4 - 4 - 4 - 2 - 2); // rest of header (compression..clrImportant)

  const uncompressedSize = r.u32();
  const compressedSize = r.u32();
  const comp = r.bytes(compressedSize);
  let rows;
  if (uncompressedSize === 0) rows = Buffer.alloc(0);
  else rows = zlib.inflateSync(comp);
  if (rows.length !== uncompressedSize) throw new Error('inflate size mismatch');
  const stride = ((w * bpp + 31) >> 5) << 2;
  if (rows.length !== stride * Math.abs(h))
    throw new Error(`size mismatch: ${rows.length} != ${stride * Math.abs(h)}`);
  return { w, h: Math.abs(h), bpp, palette, rows, stride, topDown: h < 0, paletteType };
}

// ---------------------------------------------------------------------------
// Pixel access + RGBA composition

function pixelAt(img, x, y) {
  const row = img.topDown ? y : img.h - 1 - y;
  const base = row * img.stride;
  switch (img.bpp) {
    case 1:
      return (img.rows[base + (x >> 3)] >> (7 - (x & 7))) & 1;
    case 2:
      return (img.rows[base + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
    case 4:
      return (img.rows[base + (x >> 1)] >> (x & 1 ? 0 : 4)) & 0x0f;
    case 8:
      return img.rows[base + x];
    case 24: {
      const i = base + x * 3;
      return [img.rows[i + 2], img.rows[i + 1], img.rows[i]]; // BGR → RGB
    }
    default:
      throw new Error(`bpp ${img.bpp}`);
  }
}

// Composite a pose (image + optional mask + optional aura) into RGBA.
// Mask convention (ConvertMasksCommon): bit 1 = opaque (index 1 = black),
// bit 0 = background. MASKEDMONO pairs: 00 blank, 01 aura, 10 black, 11 white.
function poseToRgba(image, mask, aura) {
  const { w, h } = image;
  const rgba = new Uint8Array(w * h * 4);
  const auraA = new Uint8Array(w * h); // aura coverage
  const put = (x, y, rr, g, b, a) => {
    const i = (y * w + x) * 4;
    rgba[i] = rr;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };

  if (image.paletteType === AIP_MASKEDMONO && image.bpp === 2) {
    // Pair bits (a=bit1, b=bit0) split by ConvertMasksCommon: image bit = b,
    // mask bit = a, aura = a|b. The image DIB palette is index0=WHITE,
    // index1=BLACK (MonochromePalette), so: 00 blank, 01 aura, 10 white
    // pixel, 11 black pixel. (The avbfile.h comment names these backwards.)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pair = pixelAt(image, x, y);
        if (pair === 0) put(x, y, 0, 0, 0, 0);
        else if (pair === 1) {
          put(x, y, 0, 0, 0, 0);
          auraA[y * w + x] = 255;
        } else if (pair === 2) {
          put(x, y, 255, 255, 255, 255);
          auraA[y * w + x] = 255;
        } else {
          put(x, y, 0, 0, 0, 255);
          auraA[y * w + x] = 255;
        }
      }
    }
    return { rgba, aura: auraA, w, h };
  }

  // Color/indexed image with separate mask.
  let maskBit = null,
    auraBit = null;
  if (mask && mask.paletteType === AIP_DUALMASK && mask.bpp === 2) {
    maskBit = (x, y) => pixelAt(mask, x, y) & 1;
    auraBit = (x, y) => (pixelAt(mask, x, y) >> 1) & 1;
  } else {
    if (mask) maskBit = (x, y) => pixelAt(mask, x, y) & 1;
    if (aura) auraBit = (x, y) => pixelAt(aura, x, y) & 1;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const opaque = maskBit ? maskBit(x, y) === 1 : true;
      if (auraBit && auraBit(x, y)) auraA[y * w + x] = 255;
      if (!opaque) {
        put(x, y, 0, 0, 0, 0);
        continue;
      }
      const p = pixelAt(image, x, y);
      if (Array.isArray(p)) put(x, y, p[0], p[1], p[2], 255);
      else {
        const c = image.palette && image.palette[p] ? image.palette[p] : [p, p, p];
        put(x, y, c[0], c[1], c[2], 255);
      }
    }
  }
  return { rgba, aura: auraBit || image.paletteType === AIP_MASKEDMONO ? auraA : null, w, h };
}

function imageToRgbaOpaque(image) {
  const { w, h } = image;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = pixelAt(image, x, y);
      const i = (y * w + x) * 4;
      let c;
      if (Array.isArray(p)) c = p;
      else c = image.palette && image.palette[p] ? image.palette[p] : [p, p, p];
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return { rgba, w, h };
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA8, filter 0)

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

function pngChunk(type, data) {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function grayPng(alpha, w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = alpha[i];
  }
  return encodePng(rgba, w, h);
}

// ---------------------------------------------------------------------------
// Main extraction

function extractPoses(buf, av, outDir) {
  // Gather every unique pose referenced by records/icon/backdrop.
  const poses = new Map(); // key → {imageOff, maskOff, auraOff, formats, palettes}
  const add = (rec) => {
    if (!rec || rec.imageOff === 0) return null;
    const key = `${rec.imageOff}_${rec.maskOff}_${rec.auraOff}`;
    if (!poses.has(key)) {
      poses.set(key, {
        imageOff: rec.imageOff,
        maskOff: rec.maskOff,
        auraOff: rec.auraOff,
        formats: rec.formats,
        palettes: rec.palettes,
      });
    }
    return key;
  };
  for (const list of [av.faces, av.torsos, av.bodies])
    list.forEach((rec) => {
      rec.pose = add(rec);
    });
  const iconKey = add(av.icon);
  const backdropKey = add(av.backdrop);

  const poseMeta = {};
  let poseIndex = 0;
  for (const [key, p] of poses) {
    const id = `p${poseIndex++}`;
    const image = decodeImage(buf, p.imageOff, p.formats[0], p.palettes[0], av.globalPalette);
    let composed;
    if (p.palettes[0] === AIP_MASKEDMONO || p.maskOff !== 0 || p.auraOff !== 0) {
      const mask = p.maskOff
        ? decodeImage(buf, p.maskOff, p.formats[1], p.palettes[1], av.globalPalette)
        : null;
      const aura = p.auraOff
        ? decodeImage(buf, p.auraOff, p.formats[2], p.palettes[2], av.globalPalette)
        : null;
      composed = poseToRgba(image, mask, aura);
    } else {
      composed = imageToRgbaOpaque(image);
    }
    const file = `${id}.png`;
    fs.writeFileSync(path.join(outDir, file), encodePng(composed.rgba, composed.w, composed.h));
    let auraFile = null;
    if (composed.aura && composed.aura.some((v) => v !== 0)) {
      auraFile = `${id}-aura.png`;
      fs.writeFileSync(path.join(outDir, auraFile), grayPng(composed.aura, composed.w, composed.h));
    }
    poseMeta[key] = { id, file, aura: auraFile, w: composed.w, h: composed.h };
  }
  return { poseMeta, iconKey, backdropKey };
}

function recToJson(rec, poseMeta) {
  const out = {
    pose: rec.pose ? poseMeta[rec.pose].id : null,
    emotion: EMOTION_NAMES[rec.emotionIndex] ?? 'neutral',
    emotionIndex: rec.emotionIndex,
    intensity: +rec.intensity.toFixed(4),
  };
  if ('cx' in rec) {
    out.cx = rec.cx;
    out.cy = rec.cy;
  }
  if ('cxDelta' in rec) {
    out.cxDelta = rec.cxDelta;
    out.cyDelta = rec.cyDelta;
  }
  if ('x' in rec) {
    out.x = rec.x;
    out.y = rec.y;
  }
  return out;
}

function addOfficialFaceAliases(base, faces) {
  for (const alias of OFFICIAL_FACE_ALIASES[base] ?? []) {
    if (faces.some((face) => face.emotion === alias.emotion)) continue;
    const source = faces.find(
      (face) => face.emotion === alias.fromEmotion && face.intensity === alias.fromIntensity,
    );
    if (!source) continue;
    faces.push({
      ...source,
      emotion: alias.emotion,
      emotionIndex: alias.emotionIndex,
      intensity: alias.intensity,
    });
  }
}

function processFile(file, outRoot, index) {
  const buf = fs.readFileSync(file);
  const base = path
    .basename(file)
    .replace(/\.(avb|bgb)$/i, '')
    .toLowerCase();
  const isBgb = /\.bgb$/i.test(file);

  // .bgb may be a raw BMP (LoadBackdrop supports both).
  if (isBgb && buf.readUInt16LE(0) === 0x4d42) {
    const outDir = path.join(outRoot, 'backgrounds');
    fs.mkdirSync(outDir, { recursive: true });
    const img = imageToRgbaOpaque(decodeBmpAt(buf, 0));
    fs.writeFileSync(path.join(outDir, `${base}.png`), encodePng(img.rgba, img.w, img.h));
    index.backgrounds.push({
      id: base,
      name: base,
      file: `backgrounds/${base}.png`,
      w: img.w,
      h: img.h,
    });
    return;
  }

  const av = parseAvb(buf);

  if (av.type === AT_BACKDROP) {
    const outDir = path.join(outRoot, 'backgrounds');
    fs.mkdirSync(outDir, { recursive: true });
    if (!av.backdrop) throw new Error(`${base}: no AK_BACKDROP record`);
    const img = imageToRgbaOpaque(
      decodeImage(
        buf,
        av.backdrop.imageOff,
        av.backdrop.formats[0],
        av.backdrop.palettes[0],
        av.globalPalette,
      ),
    );
    fs.writeFileSync(path.join(outDir, `${base}.png`), encodePng(img.rgba, img.w, img.h));
    index.backgrounds.push({
      id: base,
      name: av.name || base,
      file: `backgrounds/${base}.png`,
      w: img.w,
      h: img.h,
      copyright: av.copyright || undefined,
    });
    return;
  }

  const outDir = path.join(outRoot, 'characters', base);
  fs.mkdirSync(outDir, { recursive: true });
  const { poseMeta, iconKey } = extractPoses(buf, av, outDir);

  const meta = {
    id: base,
    name: av.name || base,
    type: av.type === AT_COMPLEX ? 'complex' : 'simple',
    style: av.style,
    flags: av.flags,
    copyright: av.copyright || undefined,
    originalUrl: av.originalUrl || undefined,
    icon: iconKey ? poseMeta[iconKey].id : null,
    poses: Object.fromEntries(
      Object.values(poseMeta).map((p) => [
        p.id,
        {
          file: p.file,
          aura: p.aura || undefined,
          w: p.w,
          h: p.h,
        },
      ]),
    ),
    faces: av.faces.map((rec) => recToJson(rec, poseMeta)),
    torsos: av.torsos.map((rec) => recToJson(rec, poseMeta)),
    bodies: av.bodies.map((rec) => recToJson(rec, poseMeta)),
  };
  addOfficialFaceAliases(base, meta.faces);
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
  index.characters.push({
    id: base,
    name: meta.name,
    type: meta.type,
    dir: `characters/${base}`,
    icon: meta.icon,
    poseCount: Object.keys(meta.poses).length,
    faces: meta.faces.length,
    torsos: meta.torsos.length,
    bodies: meta.bodies.length,
  });
}

// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const srcs = [];
  let out = 'public/art';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src') srcs.push(args[++i]);
    else if (args[i] === '--out') out = args[++i];
  }
  if (srcs.length === 0) {
    srcs.push('sources/comic-chat/v2.5-beta-1/comicart', 'sources/comic-chat/v2.5-beta-1/artpack1');
  }
  fs.mkdirSync(out, { recursive: true });
  const index = { characters: [], backgrounds: [] };
  let ok = 0,
    fail = 0;
  for (const src of srcs) {
    for (const f of fs.readdirSync(src).sort()) {
      if (!/\.(avb|bgb)$/i.test(f)) continue;
      const full = path.join(src, f);
      // artpack1 duplicates some comicart characters; keep first occurrence.
      const base = f.replace(/\.(avb|bgb)$/i, '').toLowerCase();
      if (
        index.characters.some((c) => c.id === base) ||
        index.backgrounds.some((b) => b.id === base)
      ) {
        continue;
      }
      try {
        processFile(full, out, index);
        ok++;
        console.log(`ok   ${f}`);
      } catch (e) {
        fail++;
        console.error(`FAIL ${f}: ${e.message}`);
      }
    }
  }
  index.characters.sort((a, b) => a.id.localeCompare(b.id));
  index.backgrounds.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`\n${ok} files extracted, ${fail} failures → ${out}`);
}

main();
