import { Schema } from "effect";

// A theme is selected by a single name (pinned), or by an appearance-keyed pair
// That follows the terminal. Resolution against the registry is Part 2; here we
// Only validate the shape.
const ThemeSelection = Schema.Union([
  Schema.String,
  Schema.Struct({ dark: Schema.String, light: Schema.String }),
]);

// Theme entries stay raw here; `resolveThemes` (theme/registry) validates each
// One, because an entry may be a full theme or a `{ base, ...overrides }` partial
// That is only a valid theme once merged over its base.
export const UserConfigSchema = Schema.Struct({
  theme: Schema.optionalKey(ThemeSelection),
  themes: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type UserConfig = Schema.Schema.Type<typeof UserConfigSchema>;

export const emptyConfig: UserConfig = {};
