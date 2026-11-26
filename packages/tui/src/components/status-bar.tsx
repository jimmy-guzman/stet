import { Index, Match, Show, Switch } from "solid-js";

import { recencyFraction } from "@/git/activity";
import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import type { StatusBarActivity, StatusBarModel } from "@/status/model";
import { theme } from "@/theme/context";
import { lerpHex } from "@/utils/color";

import { ActionText } from "./action-text";
import { BAR_EDGE, BAR_SEP } from "./bar";
import { Island } from "./island";
import { leftPress } from "./mouse";
import { hoverable } from "./pointer";
import { RecencyDot } from "./recency-dot";

const model = () => state.statusBarModel();

// Narrowed per branch so each `Match` gets the member it renders; the model is a closed union,
// So a new content kind is a type error here rather than a silently blank row.
const asMessage = (current: StatusBarModel) =>
  current.kind === "message" ? current : undefined;

const asAmbient = (current: StatusBarModel) =>
  current.kind === "ambient" ? current : undefined;

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

  return fraction === undefined
    ? base
    : lerpHex(base, theme.colors.text.faint, fraction);
};

// The recent file opens on a click, as `.` opens it.
const Activity = (props: { activity: StatusBarActivity }) => {
  const hover = hoverable("pointer");

  return (
    <box
      ref={hover.ref}
      flexDirection="row"
      onMouseDown={leftPress(() => {
        state.openLatestFile();
      })}
    >
      <RecencyDot at={props.activity.at} marginRight={1} />
      <text
        selectable={false}
        fg={
          hover.hovered() ? theme.colors.text.primary : pathFg(props.activity)
        }
      >
        {props.activity.path}
      </text>
    </box>
  );
};

export const StatusBar = () => (
  <box height={1} flexDirection="row" paddingLeft={BAR_EDGE}>
    <Island>
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
          {(current) => <Activity activity={current().activity} />}
        </Match>
        <Match when={asGuidance(model())}>
          {(current) => (
            <box flexDirection="row">
              <Index each={current().text.split(BAR_SEP)}>
                {(hint, index) => (
                  <>
                    <Show when={index > 0}>
                      <text
                        selectable={false}
                        fg={theme.colors.border.unfocused}
                      >
                        {BAR_SEP}
                      </text>
                    </Show>
                    {/* A fitted hint keeps its place in the list, so its index names its action
                        even when the bar truncated its label. */}
                    <ActionText
                      label={hint()}
                      onPress={() => {
                        state.guidance()[index]?.run();
                      }}
                    />
                  </>
                )}
              </Index>
            </box>
          )}
        </Match>
      </Switch>
    </Island>
  </box>
);
