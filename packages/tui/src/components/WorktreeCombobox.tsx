import type { ScrollBoxRenderable } from "@opentui/core";
import { batch, createEffect, Index, Show } from "solid-js";

import { recencyFraction } from "@/git/activity";
import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { worktreeLabel } from "@/ui-helpers";
import { lerpHex } from "@/utils/color";
import { relativeTime } from "@/utils/relative-time";
import { collapseHome, truncate, truncateLeft } from "@/utils/text";

// The right-hand columns are fixed width and the label column takes the slack, so counts and ages
// Line up down the list instead of drifting with each row's label and badges. `999 changed` is the
// Widest count and `11mo` the widest age `relativeTime` produces.
const MARKER_CELLS = 2;
const COUNT_CELLS = 11;
const AGE_CELLS = 4;
const GAP = 2;
const LABEL_MIN = 10;
// Below this a left-truncated path stops carrying enough tail to be worth its column, so a narrow
// Overlay drops it outright: which worktree is busy outranks where it sits on disk.
const PATH_MIN = 10;
const PATH_MAX = 24;

export function WorktreeCombobox() {
  const theme = useTheme();
  let worktreeComboboxRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    worktreeComboboxRef?.scrollChildIntoView(`worktree-combobox-${state.worktreeComboboxIndex()}`);
  });

  const repoRoot = () => state.gitModel().repoRoot;

  const available = () => state.overlayWidth() - 2;
  const pathCells = () => {
    const slack =
      available() - MARKER_CELLS - LABEL_MIN - GAP - COUNT_CELLS - GAP - AGE_CELLS - GAP;
    return slack < PATH_MIN ? 0 : Math.min(slack, PATH_MAX);
  };
  const rightCells = () =>
    GAP + COUNT_CELLS + GAP + AGE_CELLS + (pathCells() === 0 ? 0 : GAP + pathCells());
  const labelCells = (badges: string) =>
    Math.max(
      4,
      available() - rightCells() - MARKER_CELLS - (badges === "" ? 0 : badges.length + 1),
    );

  // A worktree whose summary has not landed yet, or whose directory is gone so it can never be read,
  // Leaves its cells blank rather than guessing at a count. The columns stay reserved either way, so
  // A summary arriving never shifts the row.
  const countText = (changed: number | undefined) =>
    (changed === undefined ? "" : changed === 0 ? "clean" : `${changed} changed`).padStart(
      COUNT_CELLS,
    );
  const ageText = (at: number | undefined) =>
    (at === undefined
      ? ""
      : relativeTime(Math.floor(at / 1000), Math.floor(state.now() / 1000))
    ).padStart(AGE_CELLS);
  // The age is this row's recency cue, so it carries the fade the dot carries elsewhere: pink while
  // An agent is working in that worktree, cooling into the faint gray the ramp ends on as it goes
  // Quiet. The word itself is the signal, so the row still reads under NO_COLOR; color only ranks it.
  const ageColor = (at: number | undefined) => {
    const fraction = recencyFraction(at, state.now());
    return fraction === undefined
      ? theme.colors.text.faint
      : lerpHex(theme.colors.recency.fresh, theme.colors.recency.aged, fraction);
  };

  function onInput(value: string) {
    batch(() => {
      state.setWorktreeComboboxQuery(value);
      state.setWorktreeComboboxIndex(0);
    });
  }

  function onSubmit() {
    const worktree = state.worktreeComboboxResults()?.[state.worktreeComboboxIndex()];
    if (worktree === undefined) {
      state.setWorktreeComboboxOpen(false);
    } else {
      void state.switchWorktree(worktree);
    }
  }

  return (
    <box
      position="absolute"
      left={state.overlayLeft()}
      top={1}
      width={state.overlayWidth()}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border.focused}
      backgroundColor={theme.colors.surface.panel}
      zIndex={100}
    >
      <input
        focused
        width="100%"
        placeholder="switch worktree…"
        backgroundColor={theme.colors.surface.panel}
        focusedBackgroundColor={theme.colors.surface.panel}
        textColor={theme.colors.text.primary}
        focusedTextColor={theme.colors.text.primary}
        cursorColor={theme.colors.accent.primary}
        onInput={onInput}
        onSubmit={onSubmit}
      />
      <scrollbox
        ref={(el) => (worktreeComboboxRef = el)}
        width="100%"
        height={Math.min(12, Math.max(1, state.worktreeComboboxResults()?.length ?? 1))}
        scrollY
        viewportCulling
        scrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.rgba.transparent,
            foregroundColor: theme.colors.scrollbar.thumb,
          },
        }}
      >
        <Show
          when={state.worktreeComboboxResults() !== undefined}
          fallback={
            <box id="worktree-combobox-loading" paddingLeft={1}>
              <text fg={theme.colors.text.muted}>loading…</text>
            </box>
          }
        >
          <Show
            when={(state.worktreeComboboxResults()?.length ?? 0) > 0}
            fallback={
              <box id="worktree-combobox-empty" paddingLeft={1}>
                <text fg={theme.colors.text.muted}>
                  {state.worktreeComboboxQuery() === "" ? "no worktrees" : "no matches"}
                </text>
              </box>
            }
          >
            {/* Id-by-index is required: reordering must never change a live renderable's id */}
            <Index each={state.worktreeComboboxResults()}>
              {(worktree, index) => {
                const summary = () => state.worktreeSummaries().get(worktree().path);
                const activityAt = () => summary()?.lastActivityAt;
                const current = () => worktree().path === repoRoot();
                const badges = () =>
                  [worktree().locked ? "locked" : "", worktree().prunable ? "prunable" : ""]
                    .filter((badge) => badge !== "")
                    .join(" ");
                const nameFg = () =>
                  index === state.worktreeComboboxIndex()
                    ? theme.colors.text.selected
                    : theme.colors.text.strong;
                return (
                  <box
                    id={`worktree-combobox-${index}`}
                    height={1}
                    width="100%"
                    flexDirection="row"
                    justifyContent="space-between"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={
                      index === state.worktreeComboboxIndex()
                        ? theme.colors.surface.cursor
                        : theme.colors.surface.panel
                    }
                    onMouseDown={() => batch(() => void state.switchWorktree(worktree()))}
                  >
                    {/* Every text is pinned to one line (height 1 + wrapMode none): a branch name or
                        path long enough to wrap would lay the row out two cells tall and mangle the
                        list, exactly as it would in the scope menu's commit rows. */}
                    <box flexDirection="row" flexShrink={0}>
                      <text flexShrink={0} wrapMode="none" height={1} fg={nameFg()}>
                        {`${current() ? "● " : "  "}${truncate(worktreeLabel(worktree()), labelCells(badges()))}`}
                      </text>
                      <Show when={badges() !== ""}>
                        <text
                          flexShrink={0}
                          wrapMode="none"
                          height={1}
                          fg={theme.colors.severity.warning}
                        >
                          {` ${badges()}`}
                        </text>
                      </Show>
                    </box>
                    <box flexDirection="row" flexShrink={0}>
                      <text
                        flexShrink={0}
                        wrapMode="none"
                        height={1}
                        marginLeft={GAP}
                        fg={
                          (summary()?.changed ?? 0) > 0
                            ? theme.colors.text.secondary
                            : theme.colors.text.faint
                        }
                      >
                        {countText(summary()?.changed)}
                      </text>
                      <text
                        flexShrink={0}
                        wrapMode="none"
                        height={1}
                        marginLeft={GAP}
                        fg={ageColor(activityAt())}
                      >
                        {ageText(activityAt())}
                      </text>
                      <Show when={pathCells() > 0}>
                        <text
                          flexShrink={0}
                          wrapMode="none"
                          height={1}
                          marginLeft={GAP}
                          fg={theme.colors.text.muted}
                        >
                          {truncateLeft(collapseHome(worktree().path), pathCells()).padEnd(
                            pathCells(),
                          )}
                        </text>
                      </Show>
                    </box>
                  </box>
                );
              }}
            </Index>
          </Show>
        </Show>
      </scrollbox>
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.text.muted}>↑↓ navigate · ⏎ switch · esc close</text>
      </box>
    </box>
  );
}
