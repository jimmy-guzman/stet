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
  problems: Schema.optionalKey(
    Schema.Struct({
      height: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
      open: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  provenance: Schema.optionalKey(Toggle),
  // Values are a schema URL, a list of URLs, or false; `resolveSchemas` validates
  // Them and merges over the built-in JSON associations.
  schemas: Schema.optionalKey(RawRegistry),
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

/**
 * What an omitted key means, and the only place that says so. Two readers need it and used to
 * restate every default independently: `main.tsx`, seeding a session signal, and `config/write.ts`,
 * deciding whether a session value diverges from the file. A disagreement between those copies
 * makes `ctrl-s` either decline to write a setting the user changed or write one they did not, and
 * the structure guaranteed a fresh pair of copies for every key added. The `satisfies` clause
 * checks it against `UserConfig`, so a typo, a stale key, or a value the schema would reject is a
 * compile error rather than a default nothing reads.
 *
 * Only keys whose absence means a value belong here. `editor`, `ide`, and `theme` are absent
 * because an unset key means "nothing to say" and is deliberately never written; `sidebar.width`
 * and `problems.height` because an absent size is the one the layout model computes, not a config
 * value; the registries because they are merge bases their own resolvers fold over, not settings.
 */
export const configDefaults = {
  diagnostics: { download: true, enabled: true },
  icons: { enabled: true },
  intel: { enabled: true },
  problems: { open: false },
  provenance: { enabled: false },
  search: { caseSensitive: false, regex: false, scope: "changed" },
  sidebar: { changesOnly: false, open: true },
  update: { check: true },
  viewer: { wrap: false },
} as const satisfies { [K in keyof UserConfig]?: UserConfig[K] };

export const emptyConfig: UserConfig = {};
