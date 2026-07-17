import { Schema } from "effect";

const ThemeSelection = Schema.Union([
  Schema.String,
  Schema.Struct({ dark: Schema.String, light: Schema.String }),
]);

// Registries stay raw; each resolver validates entries only after merging them
// Over their built-in (a `{ base, ...overrides }` partial is only a valid theme
// Once merged over its base, and the same holds for servers, languages, files,
// And glyphs).
const RawRegistry = Schema.Record(Schema.String, Schema.Unknown);

const Toggle = Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean) });

// Config is shaped by feature: each section owns its settings, including its
// Off switch, so a feature's whole surface lives under one key.
export const UserConfigSchema = Schema.Struct({
  diagnostics: Schema.optionalKey(
    Schema.Struct({
      download: Schema.optionalKey(Schema.Boolean),
      enabled: Schema.optionalKey(Schema.Boolean),
      servers: Schema.optionalKey(RawRegistry),
    }),
  ),
  editor: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
  files: Schema.optionalKey(RawRegistry),
  icons: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.optionalKey(Schema.Boolean),
      glyphs: Schema.optionalKey(RawRegistry),
    }),
  ),
  ide: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
  intel: Schema.optionalKey(Toggle),
  // Values are a combo, a list of combos, or false; `resolveKeybindings`
  // Validates them against the action registry.
  keybindings: Schema.optionalKey(RawRegistry),
  languages: Schema.optionalKey(RawRegistry),
  provenance: Schema.optionalKey(Toggle),
  search: Schema.optionalKey(
    Schema.Struct({
      caseSensitive: Schema.optionalKey(Schema.Boolean),
      regex: Schema.optionalKey(Schema.Boolean),
      scope: Schema.optionalKey(Schema.Literals(["changed", "repo"])),
    }),
  ),
  sidebar: Schema.optionalKey(
    Schema.Struct({
      changesOnly: Schema.optionalKey(Schema.Boolean),
      open: Schema.optionalKey(Schema.Boolean),
      width: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
    }),
  ),
  theme: Schema.optionalKey(ThemeSelection),
  themes: Schema.optionalKey(RawRegistry),
  update: Schema.optionalKey(Schema.Struct({ check: Schema.optionalKey(Schema.Boolean) })),
  viewer: Schema.optionalKey(Schema.Struct({ wrap: Schema.optionalKey(Schema.Boolean) })),
});

export type UserConfig = Schema.Schema.Type<typeof UserConfigSchema>;

export const emptyConfig: UserConfig = {};
