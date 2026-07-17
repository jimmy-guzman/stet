import { Show } from "solid-js";

import { recencyFraction } from "@/git/activity";
import { levelColor, levelGlyph } from "@/log/levels";
import type { LogLevel } from "@/log/levels";
import { state } from "@/state";
import { STATUS_BAR_GROUP_GAP, STATUS_BAR_PADDING } from "@/status/model";
import type { StatusBarActivity, StatusBarAmbient } from "@/status/model";
import { useTheme } from "@/theme/context";
import { lerpHex } from "@/utils/color";

import { provenanceGlyph } from "./provenance";
import { RecencyDot } from "./RecencyDot";

export function StatusBar() {
  const theme = useTheme();
  const content = () => state.statusBarModel().content;
  const hint = () => {
    const model = state.statusBarModel();
    return model.layout === "split" ? model.hint : undefined;
  };
  const message = () => {
    const current = content();
    return current?.kind === "message" && current.message !== "" ? current : undefined;
  };
  const provenance = () => {
    const current = content();
    return current?.kind === "provenance" && current.text !== "" ? current : undefined;
  };
  const ambient = () => {
    const current = content();
    return current?.kind === "ambient" && (current.activity !== undefined || current.message !== "")
      ? current
      : undefined;
  };
  const messageFg = (level: LogLevel | undefined) =>
    level === undefined ? theme.colors.text.secondary : levelColor(theme.colors, level);
  const messageLead = (level: LogLevel | undefined) =>
    level === undefined ? "" : `${levelGlyph(level)} `;
  const pathFg = (activity: StatusBarActivity) => {
    const base =
      activity.changeKind === undefined
        ? theme.colors.text.muted
        : theme.colors.kind[activity.changeKind];
    const fraction = recencyFraction(activity.at, state.now());
    return fraction === undefined ? base : lerpHex(base, theme.colors.text.faint, fraction);
  };
  const hasBothGroups = (current: StatusBarAmbient) =>
    current.activity !== undefined && current.message !== "";

  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={STATUS_BAR_PADDING}
      paddingRight={STATUS_BAR_PADDING}
      backgroundColor={theme.colors.surface.base}
    >
      <Show when={hint()}>
        {(current) => <text fg={theme.colors.text.muted}>{current().text}</text>}
      </Show>
      <Show when={provenance()}>
        {(current) => (
          <box flexDirection="row">
            <text fg={theme.colors.provenance[current().band]} marginRight={1}>
              {provenanceGlyph(current().band)}
            </text>
            <text fg={theme.colors.text.secondary}>{current().text}</text>
          </box>
        )}
      </Show>
      <Show when={message()}>
        {(current) => (
          <text fg={messageFg(current().level)}>
            {`${levelGlyph(current().level)} ${current().message}`}
          </text>
        )}
      </Show>
      <Show when={ambient()}>
        {(current) => (
          <box flexDirection="row">
            <Show when={current().activity}>
              {(activity) => (
                <>
                  <RecencyDot at={activity().at} marginRight={1} />
                  <text fg={pathFg(activity())}>{activity().path}</text>
                </>
              )}
            </Show>
            <Show when={hasBothGroups(current())}>
              <text>{STATUS_BAR_GROUP_GAP}</text>
            </Show>
            <Show when={current().message}>
              {(text) => (
                <text fg={messageFg(current().level)}>
                  {`${messageLead(current().level)}${text()}`}
                </text>
              )}
            </Show>
          </box>
        )}
      </Show>
    </box>
  );
}
