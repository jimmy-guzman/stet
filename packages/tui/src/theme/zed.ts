import type { Theme, ThemeStyle } from "@pierre/highlights";
import { Predicate } from "effect";

import { lerpHex } from "@/utils/color";

/** A Zed-format theme, the only theme shape the highlighter reads and the one stet derives from. */
export type ZedTheme = Theme;

// Display P3 primaries to linear sRGB (CSS Color 4). The terminal and OpenTUI only take sRGB hex,
// And two bundled themes (`pierre-*-vibrant`) write every color as `color(display-p3 r g b)`.
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
] as const;

const P3_PATTERN =
  /^color\(display-p3\s+(?<r>[\d.]+)\s+(?<g>[\d.]+)\s+(?<b>[\d.]+)\s*(?:\/\s*(?<a>[\d.]+)(?<percent>%?)\s*)?\)$/u;

const HEX = /^#[0-9a-f]{6}$/u;

const decode = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const encode = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

const byte = (c: number) =>
  Math.round(Math.max(0, Math.min(1, c)) * 255)
    .toString(16)
    .padStart(2, "0");

const p3ToHex = (r: number, g: number, b: number) => {
  const [lr, lg, lb] = [r, g, b].map(decode);

  const channels = P3_TO_SRGB.map(([wr, wg, wb]) =>
    encode(wr * (lr ?? 0) + wg * (lg ?? 0) + wb * (lb ?? 0))
  );

  return `#${channels.map(byte).join("")}`;
};

/** Any CSS color Bun parses (`#hex`, `rgb()`, a named color), alpha composited over `under`. */
const cssHex = (value: string, under: string) => {
  const rgba = Bun.color(value, "[rgba]");
  const hex = Bun.color(value, "hex");

  return rgba === null || hex === null || !HEX.test(hex)
    ? undefined
    : lerpHex(under, hex, (rgba[3] ?? 255) / 255);
};

const p3Alpha = (alpha: string | undefined, percent: string | undefined) => {
  const value = Number(alpha ?? 1);

  return percent === "%" ? value / 100 : value;
};

/**
 * A theme color as opaque lowercase `#rrggbb`, compositing any alpha over `under`, or `undefined`
 * when the value is not a color.
 */
export const opaqueHex = (value: string, under: string) => {
  const p3 = P3_PATTERN.exec(value.trim())?.groups;

  return p3 === undefined
    ? cssHex(value, under)
    : lerpHex(
        under,
        p3ToHex(Number(p3.r), Number(p3.g), Number(p3.b)),
        p3Alpha(p3.a, p3.percent)
      );
};

const FALLBACK_BACKGROUND = "#000000";

/**
 * Each scope's color as opaque hex, dropping font settings and any scope without a parseable color:
 * a terminal cell has a color and nothing else, so that is all the viewer reads.
 */
const normalizeSyntax = (
  syntax: NonNullable<ThemeStyle["syntax"]>,
  under: string
) =>
  Object.fromEntries(
    Object.entries(syntax).flatMap(([scope, setting]) => {
      const color = Predicate.isString(setting) ? setting : setting.color;
      const hex = color === undefined ? undefined : opaqueHex(color, under);

      return hex === undefined ? [] : [[scope, hex]];
    })
  );

/**
 * The theme with every color opaque sRGB hex, the only form the terminal renders, and nothing else. Run once when a
 * theme is registered, so derivation and the highlighter both read plain hex.
 */
export const normalizeTheme = (theme: ZedTheme): ZedTheme => {
  const { style } = theme;
  const rawBackground = style["editor.background"] ?? style.background;

  const background =
    (Predicate.isString(rawBackground)
      ? opaqueHex(rawBackground, FALLBACK_BACKGROUND)
      : undefined) ?? FALLBACK_BACKGROUND;

  const colors = Object.fromEntries(
    Object.entries(style).flatMap(([key, value]) => {
      if (!Predicate.isString(value)) {
        return [];
      }

      const hex = opaqueHex(value, background);

      return hex === undefined ? [] : [[key, hex]];
    })
  );

  // Only the parsed colors survive: a value that is not a color (or one in a form nothing here
  // Parses) must never reach `deriveTheme`, which would blend it into `#NaNNaNNaN`.
  return {
    ...theme,
    style: {
      ...colors,
      "editor.background": background,
      syntax: normalizeSyntax(style.syntax ?? {}, background),
    },
  };
};
