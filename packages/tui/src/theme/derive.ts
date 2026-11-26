import { Predicate } from "effect";

import { isLightHex, lerpHex } from "@/utils/color";

import type { Theme } from "./tokens";
import type { ZedTheme } from "./zed";

type Hue = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";

/**
 * Each colored file icon names the terminal hue it takes, so icons follow the theme's palette; an
 * icon not listed here renders in `text.muted`.
 */
const ICON_HUES = {
  archive: "yellow",
  astro: "magenta",
  bun: "yellow",
  c: "blue",
  codeowners: "yellow",
  cpp: "blue",
  css: "magenta",
  csv: "green",
  database: "yellow",
  docker: "blue",
  git: "red",
  go: "cyan",
  gradle: "cyan",
  graphql: "magenta",
  groovy: "cyan",
  heroku: "magenta",
  html: "red",
  http: "blue",
  image: "cyan",
  java: "red",
  javascript: "yellow",
  json: "yellow",
  kotlin: "magenta",
  license: "yellow",
  make: "yellow",
  markdown: "cyan",
  maven: "red",
  node: "green",
  pdf: "red",
  profile: "yellow",
  python: "blue",
  react: "cyan",
  readme: "cyan",
  ruby: "red",
  rust: "red",
  sass: "magenta",
  scala: "red",
  shell: "green",
  spreadsheet: "green",
  storybook: "magenta",
  svelte: "red",
  swift: "red",
  test: "green",
  toml: "red",
  tsconfig: "blue",
  typescript: "blue",
  video: "cyan",
  vue: "green",
  wasm: "magenta",
  yaml: "red",
  zig: "yellow",
} satisfies Record<string, Hue>;

/** VS Code's terminal colors, the same fallback the highlighter uses for a theme without them. */
const ANSI_FALLBACK = {
  blue: "#2472c8",
  cyan: "#11a8cd",
  green: "#0dbc79",
  magenta: "#bc3fbc",
  red: "#cd3131",
  yellow: "#e5e510",
};

/**
 * How far each derived color sits from the background toward its source (cmux's `color-mix`),
 * measured off stet's own palettes so `stet-dark`/`stet-light` keep their look. Light surfaces need
 * larger steps because sRGB compresses contrast near white.
 * `selection` is measured the same way: at 0.2 it was within 1.1:1 of a find match in `stet-dark`,
 * and at 0.3 it is 1.4:1, there and in `stet-light`. `hover` is half of `cursor`, so a hovered row
 * never reads as the cursor row.
 */
const STEPS = {
  dark: {
    border: 0.09,
    cursor: 0.09,
    faint: 0.32,
    find: 0.3,
    hover: 0.045,
    lineNumber: 0.27,
    muted: 0.51,
    panel: 0.36,
    scrollbar: 0.27,
    secondary: 0.75,
    selection: 0.3,
    strong: 0.91,
    tint: 0.1,
  },
  light: {
    border: 0.29,
    cursor: 0.17,
    faint: 0.52,
    find: 0.2,
    hover: 0.085,
    lineNumber: 0.52,
    muted: 0.66,
    panel: 0.07,
    scrollbar: 0.41,
    secondary: 0.84,
    selection: 0.3,
    strong: 0.92,
    tint: 0.08,
  },
};

const derived = new WeakMap<ZedTheme, Theme>();

const derive = (zed: ZedTheme): Theme => {
  const { style } = zed;

  const read = (...keys: string[]) =>
    keys.map((key) => style[key]).find(Predicate.isString);

  const bg = read("editor.background", "background") ?? "#000000";
  const light = isLightHex(bg);

  const fg =
    read("editor.foreground", "text", "foreground") ??
    (light ? "#000000" : "#ffffff");

  const ansi = (name: keyof typeof ANSI_FALLBACK) =>
    read(`terminal.ansi.${name}`) ?? ANSI_FALLBACK[name];

  const hues: Record<Hue, string> = {
    blue: ansi("blue"),
    cyan: ansi("cyan"),
    green: ansi("green"),
    magenta: ansi("magenta"),
    red: ansi("red"),
    yellow: ansi("yellow"),
  };

  const accent = read("text.accent") ?? hues.magenta;
  const step = light ? STEPS.light : STEPS.dark;
  const toward = (color: string, t: number) => lerpHex(bg, color, t);
  const faint = toward(fg, step.faint);
  const muted = toward(fg, step.muted);

  return {
    accent: { primary: accent },
    border: { focused: accent, unfocused: toward(fg, step.border) },
    diff: {
      addedBg: toward(hues.green, step.tint),
      addedSign: hues.green,
      lineNumberFg: toward(fg, step.lineNumber),
      removedBg: toward(hues.red, step.tint),
      removedSign: hues.red,
    },
    find: { matchBg: toward(hues.blue, step.find) },
    icon: Object.fromEntries(
      Object.entries(ICON_HUES).map(([icon, hue]) => [icon, hues[hue]])
    ),
    kind: {
      added: hues.green,
      deleted: hues.red,
      modified: hues.yellow,
      renamed: hues.magenta,
      untracked: hues.green,
    },
    recency: { aged: faint, fresh: accent },
    scrollbar: { thumb: toward(fg, step.scrollbar) },
    selection: { bg: toward(fg, step.selection) },
    severity: { error: hues.red, warning: hues.yellow },
    stage: {
      mixed: lerpHex(hues.red, hues.yellow, 0.5),
      staged: hues.green,
      unstaged: hues.yellow,
      untracked: muted,
    },
    success: hues.green,
    surface: {
      base: bg,
      cursor: toward(fg, step.cursor),
      hover: toward(fg, step.hover),
      panel: toward("#000000", step.panel),
      scrim: "#000000",
    },
    text: {
      faint,
      muted,
      primary: fg,
      secondary: toward(fg, step.secondary),
      selected: fg,
      strong: toward(fg, step.strong),
    },
  };
};

/**
 * stet's UI colors for a theme, derived the cmux way: everything comes from the background, the
 * foreground, the six terminal hues, and an optional `text.accent`, by fixed blend steps. A theme
 * therefore never names a stet role, and any Zed theme is a complete stet theme. Expects a theme
 * already through `normalizeTheme`, so every color is opaque hex. Cached per theme object.
 */
export const deriveTheme = (zed: ZedTheme) => {
  const cached = derived.get(zed);

  if (cached !== undefined) {
    return cached;
  }

  const theme = derive(zed);
  derived.set(zed, theme);

  return theme;
};
