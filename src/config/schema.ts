import { Schema } from "effect";

import { ThemeSchema } from "../theme/tokens";

// A theme is selected by a single name (pinned), or by an appearance-keyed pair
// That follows the terminal. Resolution against the registry is Part 2; here we
// Only validate the shape.
const ThemeSelection = Schema.Union([
  Schema.String,
  Schema.Struct({ dark: Schema.String, light: Schema.String }),
]);

// V1 validates full theme objects. `base` overrides and a bundled `syntaxTheme`
// Land in Part 2 alongside the merge that consumes them.
export const UserConfigSchema = Schema.Struct({
  theme: Schema.optionalKey(ThemeSelection),
  themes: Schema.optionalKey(Schema.Record(Schema.String, ThemeSchema)),
});

export type UserConfig = Schema.Schema.Type<typeof UserConfigSchema>;

export const emptyConfig: UserConfig = {};
