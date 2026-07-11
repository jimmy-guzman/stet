import { describe, expect, test } from "bun:test";

import { imageMeta } from "@/file/image-meta";

const concat = (...parts: number[][]) => Uint8Array.from(parts.flat());
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32be = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const zeros = (n: number) => Array.from({ length: n }, () => 0);

describe("imageMeta", () => {
  test("reads PNG dimensions from IHDR", () => {
    const png = concat(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      u32be(13),
      ascii("IHDR"),
      u32be(128),
      u32be(64),
    );
    expect(imageMeta(png)).toEqual({ format: "PNG", height: 64, width: 128 });
  });

  test("reads GIF logical-screen dimensions", () => {
    const gif = concat(ascii("GIF89a"), u16le(200), u16le(100));
    expect(imageMeta(gif)).toEqual({ format: "GIF", height: 100, width: 200 });
  });

  test("reads BMP dimensions", () => {
    const bmp = concat(ascii("BM"), zeros(16), u32le(300), u32le(150));
    expect(imageMeta(bmp)).toEqual({ format: "BMP", height: 150, width: 300 });
  });

  test("reads JPEG dimensions from the first SOF segment", () => {
    const jpeg = concat(
      [0xff, 0xd8],
      [0xff, 0xe0], // An APP0 segment first, to prove the walker skips it
      u16be(16),
      zeros(14),
      [0xff, 0xc0], // SOF0
      u16be(17),
      [8],
      u16be(48),
      u16be(96),
      zeros(10),
    );
    expect(imageMeta(jpeg)).toEqual({ format: "JPEG", height: 48, width: 96 });
  });

  test("reads lossless WebP (VP8L) dimensions", () => {
    const bits = (100 - 1) | ((50 - 1) << 14);
    const webp = concat(
      ascii("RIFF"),
      u32le(0),
      ascii("WEBP"),
      ascii("VP8L"),
      u32le(0),
      [0x2f],
      u32le(bits),
      zeros(5),
    );
    expect(imageMeta(webp)).toEqual({ format: "WebP", height: 50, width: 100 });
  });

  test("reads lossy WebP (VP8) dimensions", () => {
    const webp = concat(
      ascii("RIFF"),
      u32le(0),
      ascii("WEBP"),
      ascii("VP8 "),
      u32le(0),
      [0, 0, 0], // Frame tag
      [0x9d, 0x01, 0x2a], // Start code
      u16le(120),
      u16le(90),
    );
    expect(imageMeta(webp)).toEqual({ format: "WebP", height: 90, width: 120 });
  });

  test("reads extended WebP (VP8X) canvas dimensions", () => {
    const webp = concat(
      ascii("RIFF"),
      u32le(0),
      ascii("WEBP"),
      ascii("VP8X"),
      u32le(0),
      [0], // Flags
      [0, 0, 0], // Reserved
      u24le(1920 - 1),
      u24le(1080 - 1),
    );
    expect(imageMeta(webp)).toEqual({ format: "WebP", height: 1080, width: 1920 });
  });

  test("returns undefined for a WebP with an unrecognized inner chunk", () => {
    const webp = concat(ascii("RIFF"), u32le(0), ascii("WEBP"), ascii("ANIM"), zeros(14));
    expect(imageMeta(webp)).toBeUndefined();
  });

  test("returns undefined for an unrecognized blob", () => {
    expect(imageMeta(Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeUndefined();
    expect(imageMeta(Uint8Array.from(ascii("not an image at all")))).toBeUndefined();
  });
});
