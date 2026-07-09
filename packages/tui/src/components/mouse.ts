import { MouseButton } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";

// OpenTUI types `MouseEvent.button` as a bare number, so a direct `=== MouseButton.RIGHT`
// Trips no-unsafe-enum-comparison. The enum member is that numeric code, so read it back
// As a number (`.valueOf()`) to compare like with like without a cast.
export const isRightClick = (event: MouseEvent) => event.button === MouseButton.RIGHT.valueOf();
