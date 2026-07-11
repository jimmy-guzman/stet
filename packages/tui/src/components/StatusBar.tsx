import { createMemo, Show } from "solid-js";

import { recencyFraction } from "@/git/activity";
import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { lerpHex } from "@/utils/color";

import { RecencyDot } from "./RecencyDot";

export function StatusBar() {
  const theme = useTheme();
  // Pair the level glyph with its color so severity reads without relying on color
  // Alone, the way the counts badge and problems panel already do. An idle bar (no
  // Leveled message) renders bare: no glyph, neutral color.
  const status = createMemo(() => {
    const level = state.statusRightLevel();
    return {
      glyph: level === undefined ? "" : `${levelGlyph(level)} `,
      messageFg:
        level === undefined ? theme.colors.text.secondary : levelColor(theme.colors, level),
    };
  });
  // The recent file carries the tree's changed-file cue: its git change kind tints the path
  // (added/modified/deleted), which fades toward faint (the nearest-to-background text tone)
  // Across the 30s recency window, alongside the RecencyDot. So it reads as a changed file
  // Without a number, and recedes as it ages rather than competing with the leveled outcome.
  const pathFg = () => {
    const kind = state.statusRightChangeKind();
    const base = kind === undefined ? theme.colors.text.muted : theme.colors.kind[kind];
    const fraction = recencyFraction(state.statusRightRecencyAt(), state.now());
    return fraction === undefined ? base : lerpHex(base, theme.colors.text.faint, fraction);
  };
  // The two halves read as parallel groups, each led by its own mark: the changed file
  // (recency dot + kind-tinted path) and the outcome (severity glyph + message). A plain
  // Gap divides them (space groups better than a middot would), shown only when both are
  // Present. The dot leads the path (its marginRight is the space) since the status bar is
  // A single inline item, not the tree's aligned name column where the dot trails.
  const hasBothGroups = () => state.statusRightPath() !== "" && state.statusRightMessage() !== "";
  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.colors.surface.base}
    >
      {/* In provenance mode the caret line's commit fills the bar (a blame inspector),
          taking the hint's place; the right group is hidden so it spans the width. A
          transient tier (notice, finding, intel) clears the commit and restores both. */}
      <Show
        when={state.statusProvenanceCommit()}
        fallback={<text fg={theme.colors.text.muted}>{state.statusHint()}</text>}
      >
        {(commit) => <text fg={theme.colors.text.secondary}>{commit()}</text>}
      </Show>
      <Show when={state.statusProvenanceCommit() === undefined}>
        <box flexDirection="row">
          <RecencyDot at={state.statusRightRecencyAt()} marginRight={1} />
          <Show when={state.statusRightPath()}>
            <text fg={pathFg()}>{state.statusRightPath()}</text>
          </Show>
          <Show when={hasBothGroups()}>
            <text>{"  "}</text>
          </Show>
          {/* Glyph and message share one span (both level-colored), so no empty <text>
              sits between them to paint a phantom cell. */}
          <Show when={state.statusRightMessage()}>
            <text fg={status().messageFg}>{`${status().glyph}${state.statusRightMessage()}`}</text>
          </Show>
        </box>
      </Show>
    </box>
  );
}
