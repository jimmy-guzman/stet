import { createMemo, Index, Show } from "solid-js";

import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { useTheme } from "@/theme/context";

import { ListScrollbar } from "./ListScrollbar";
import { SymbolKindIcon } from "./SymbolKindIcon";
import { windowWheelHandler } from "./wheel";

// A query-less palette-family overlay: the symbol outline for `textDocument/documentSymbol`,
// Mirroring the ReferencesOverlay chrome minus the input and the source-line preview (a symbol
// Row is the symbol name, not a scattered source line). Every status (loading/empty/error/ready)
// Is a designed screen so it never shows a blank pane, and the box grows in place.
//
// The list windows off `symbolsScrollTop` (followed off the selected index in `state`), the same
// Windowed pattern the panes ship, rather than a native scrollbox.
export function SymbolsOverlay() {
  const theme = useTheme();

  const results = () => state.symbolsResults();
  // Pad `line:col` to the widest in the set so the columns line up as a table.
  const locWidth = createMemo(() =>
    results().reduce((max, symbol) => Math.max(max, `${symbol.line}:${symbol.column}`.length), 0),
  );
  const summary = () => {
    const count = results().length;
    return `${count} symbol${count === 1 ? "" : "s"}`;
  };

  const viewport = () => state.symbolsViewport();
  const start = () => state.symbolsScrollTop();
  const visible = createMemo(() => results().slice(start(), start() + viewport()));
  const onWheel = windowWheelHandler({
    rowCount: () => results().length,
    scrollTop: state.symbolsScrollTop,
    setScrollTop: state.setSymbolsScrollTop,
    viewport,
  });

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
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.colors.text.strong}>symbols</text>
      </box>
      <Show when={state.symbolsStatus() === "loading"}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.text.muted}>finding symbols…</text>
        </box>
      </Show>
      <Show when={state.symbolsStatus() === "empty"}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.text.muted}>no symbols</text>
        </box>
      </Show>
      <Show when={state.symbolsStatus() === "error"}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text
            fg={levelColor(theme.colors, "error")}
          >{`${levelGlyph("error")} language server unreachable`}</text>
        </box>
      </Show>
      <Show when={state.symbolsStatus() === "ready"}>
        <box width="100%" height={viewport()} flexDirection="row" onMouseScroll={onWheel}>
          <box ref={(el) => (el.selectable = false)} flexGrow={1} flexDirection="column">
            <Index each={visible()}>
              {(symbol, offset) => {
                const index = () => start() + offset;
                const selected = () => index() === state.symbolsIndex();
                return (
                  <box
                    ref={(el) => (el.selectable = false)}
                    width="100%"
                    height={1}
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={
                      selected() ? theme.colors.surface.cursor : theme.colors.surface.panel
                    }
                    onMouseDown={() => state.jumpToSymbol(index())}
                  >
                    {/* Each nesting level indents by 2 cells; a tuned starting value. */}
                    <box width={symbol().depth * 2} />
                    <SymbolKindIcon kind={symbol().kind} />
                    <text fg={selected() ? theme.colors.text.strong : theme.colors.text.primary}>
                      {` ${symbol().name}`}
                    </text>
                    <box flexGrow={1} />
                    <text fg={theme.colors.text.muted}>
                      {`${symbol().line}:${symbol().column}`.padStart(locWidth())}
                    </text>
                  </box>
                );
              }}
            </Index>
          </box>
          <ListScrollbar
            rowCount={() => results().length}
            viewport={viewport}
            scrollTop={state.symbolsScrollTop}
          />
        </box>
      </Show>
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.colors.text.muted}>
          {state.symbolsStatus() === "ready" ? summary() : ""}
        </text>
      </box>
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.text.muted}>↑↓ navigate · ⏎ open · esc close</text>
      </box>
    </box>
  );
}
