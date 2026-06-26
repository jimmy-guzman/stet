import { Schema } from "effect";

const ThemeSelection = Schema.Union([
  Schema.String,
  Schema.Struct({ dark: Schema.String, light: Schema.String }),
]);

// Entries stay raw; `resolveThemes` validates each, since a `{ base, ...overrides }`
// Partial is only a valid theme once merged over its base.
export const UserConfigSchema = Schema.Struct({
  editor: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
  ide: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
  theme: Schema.optionalKey(ThemeSelection),
  themes: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type UserConfig = Schema.Schema.Type<typeof UserConfigSchema>;

export const emptyConfig: UserConfig = {};
