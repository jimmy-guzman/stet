/**
 * Pixel dimensions read from an image's header bytes only, no decode: enough to label an image stet
 * cannot render (OpenTUI has no SIXEL/Kitty graphics path, anomalyco/opentui#92). Covers the raster
 * formats git flags binary; returns `undefined` for anything unrecognized. SVG stays text (it has
 * no NUL byte) and never reaches this classifier, so it is deliberately absent.
 */
export interface ImageMeta {
  format: string;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => u16be(b, o) * 0x1_00_00 + u16be(b, o + 2);
const u32le = (b: Uint8Array, o: number) => u16le(b, o) + u16le(b, o + 2) * 0x1_00_00;

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((byte, index) => b[offset + index] === byte);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(b: Uint8Array): ImageMeta | undefined {
  // IHDR is the first chunk: width/height are big-endian u32 at offsets 16 and 20.
  if (b.length < 24 || !startsWith(b, PNG_SIGNATURE)) {
    return undefined;
  }
  return { format: "PNG", height: u32be(b, 20), width: u32be(b, 16) };
}

function gif(b: Uint8Array): ImageMeta | undefined {
  // "GIF87a" / "GIF89a", then little-endian u16 logical-screen width/height at 6 and 8.
  if (b.length < 10 || !startsWith(b, [0x47, 0x49, 0x46, 0x38])) {
    return undefined;
  }
  return { format: "GIF", height: u16le(b, 8), width: u16le(b, 6) };
}

function bmp(b: Uint8Array): ImageMeta | undefined {
  // "BM", then signed int32 LE width/height at 18/22 (height negative = top-down).
  if (b.length < 26 || !startsWith(b, [0x42, 0x4d])) {
    return undefined;
  }
  return { format: "BMP", height: Math.abs(u32le(b, 22) | 0), width: u32le(b, 18) };
}

function webp(b: Uint8Array): ImageMeta | undefined {
  // RIFF container tagged WEBP, then one of three coding chunks at offset 12.
  if (
    b.length < 30 ||
    !startsWith(b, [0x52, 0x49, 0x46, 0x46]) ||
    !startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return undefined;
  }
  if (startsWith(b, [0x56, 0x50, 0x38, 0x20], 12)) {
    // Lossy VP8: 14-bit width/height after the 3-byte start code, masked to drop the scale bits.
    return { format: "WebP", height: u16le(b, 28) & 0x3f_ff, width: u16le(b, 26) & 0x3f_ff };
  }
  if (startsWith(b, [0x56, 0x50, 0x38, 0x4c], 12)) {
    // Lossless VP8L: 14-bit (width-1) then 14-bit (height-1) packed little-endian from offset 21.
    const bits = u32le(b, 21);
    return { format: "WebP", height: ((bits >> 14) & 0x3f_ff) + 1, width: (bits & 0x3f_ff) + 1 };
  }
  if (startsWith(b, [0x56, 0x50, 0x38, 0x58], 12)) {
    // Extended VP8X: 24-bit (canvas-1) little-endian width/height at 24 and 27.
    return { format: "WebP", height: u24le(b, 27) + 1, width: u24le(b, 24) + 1 };
  }
  return { format: "WebP", height: 0, width: 0 };
}

const isSofMarker = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpeg(b: Uint8Array): ImageMeta | undefined {
  // "SOI", then walk length-prefixed segments to the first Start-Of-Frame, whose payload carries a
  // 1-byte precision then big-endian u16 height and width.
  if (b.length < 4 || !startsWith(b, [0xff, 0xd8])) {
    return undefined;
  }
  for (let offset = 2; offset + 9 < b.length;) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1];
    // Standalone markers (padding, RSTn, SOI/EOI) carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (isSofMarker(marker)) {
      return { format: "JPEG", height: u16be(b, offset + 5), width: u16be(b, offset + 7) };
    }
    offset += 2 + u16be(b, offset + 2);
  }
  return undefined;
}

const PARSERS = [png, gif, webp, bmp, jpeg];

export function imageMeta(bytes: Uint8Array): ImageMeta | undefined {
  for (const parse of PARSERS) {
    const meta = parse(bytes);
    if (meta !== undefined) {
      return meta;
    }
  }
  return undefined;
}
