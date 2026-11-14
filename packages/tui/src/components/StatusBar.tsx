import { Match, Switch } from "solid-js";

import { recencyFraction } from "@/git/activity";
import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { STATUS_BAR_PADDING } from "@/status/model";
import type { StatusBarActivity, StatusBarModel } from "@/status/model";
import { theme } from "@/theme/context";
import { lerpHex } from "@/utils/color";

import { RecencyDot } from "./RecencyDot";

export function StatusBar() {
  const model = () => state.statusBarModel();
  // Narrowed per branch so each `Match` gets the member it renders; the model is a closed union,
  // So a new content kind is a type error here rather than a silently blank row.
  const asMessage = (current: StatusBarModel) => (current.kind === "message" ? current : undefined);
  const asAmbient = (current: StatusBarModel) => (current.kind === "ambient" ? current : undefined);
  const asGuidance = (current: StatusBarModel) =>
    current.kind === "guidance" ? current : undefined;
  // The changed file carries the tree's cue: its git change kind tints the path, fading toward
  // Faint across the 30s recency window, so freshness reads as brightness and the row recedes as
  // It ages rather than announcing an age in words.
  const pathFg = (activity: StatusBarActivity) => {
    const base =
      activity.changeKind === undefined
        ? theme.colors.text.muted
        : theme.colors.kind[activity.changeKind];
    const fraction = recencyFraction(activity.at, state.now());
    return fraction === undefined ? base : lerpHex(base, theme.colors.text.faint, fraction);
  };

  return (
    <box
      height={1}
      flexDirection="row"
      paddingLeft={STATUS_BAR_PADDING}
      paddingRight={STATUS_BAR_PADDING}
      backgroundColor={theme.colors.surface.base}
    >
      <Switch>
        <Match when={asMessage(model())}>
          {/* Glyph and message share one span (both level-colored), so no empty <text> sits
              between them to paint a phantom cell. */}
          {(current) => (
            <text fg={levelColor(theme.colors, current().level)}>
              {`${levelGlyph(current().level)} ${current().message}`}
            </text>
          )}
        </Match>
        <Match when={asAmbient(model())}>
          {(current) => (
            <box flexDirection="row">
              <RecencyDot at={current().activity.at} marginRight={1} />
              <text fg={pathFg(current().activity)}>{current().activity.path}</text>
            </box>
          )}
        </Match>
        <Match when={asGuidance(model())}>
          {(current) => <text fg={theme.colors.text.muted}>{current().text}</text>}
        </Match>
      </Switch>
    </box>
  );
}
