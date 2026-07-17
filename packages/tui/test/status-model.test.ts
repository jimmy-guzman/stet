import { describe, expect, test } from "bun:test";

import { buildStatusBarModel } from "@/status/model";
import type { StatusBarActivity, StatusBarHint, StatusBarModelInput } from "@/status/model";

const baseInput = {
  activity: undefined,
  backgroundProgress: undefined,
  contextualFinding: undefined,
  foregroundProgress: undefined,
  hint: { category: "guidance", mode: "generic", text: "? keys · q quit" },
  notification: undefined,
  outcome: undefined,
  provenance: undefined,
  width: 80,
} satisfies StatusBarModelInput;

describe("status bar model", () => {
  test("shows guidance by itself in the split layout", () => {
    expect(buildStatusBarModel(baseInput)).toEqual({
      content: undefined,
      hint: baseInput.hint,
      layout: "split",
    });
  });

  test("promotes foreground progress and gives it priority over a notification", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      foregroundProgress: "resolving definition…",
      notification: { level: "success", text: "copied src/state.ts" },
    });

    expect(model).toMatchObject({
      content: {
        category: "foreground-progress",
        kind: "message",
        level: "info",
        message: "resolving definition…",
      },
      layout: "full",
    });
  });

  test("promotes action notifications to the full row", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      notification: { level: "success", text: "copied src/state.ts" },
    });

    expect(model).toMatchObject({
      content: {
        category: "notification",
        kind: "message",
        level: "success",
        message: "copied src/state.ts",
      },
      layout: "full",
    });
  });

  test("promotes the caret finding ahead of provenance", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      contextualFinding: { level: "warning", text: "diagnostics: unused value" },
      provenance: { band: "session", text: "Jimmy · now · fix status" },
    });

    expect(model).toMatchObject({
      content: {
        category: "contextual-inspection",
        kind: "message",
        level: "warning",
        message: "diagnostics: unused value",
      },
      layout: "full",
    });
  });

  test("uses provenance as full-row contextual inspection", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      backgroundProgress: "checking…",
      provenance: { band: "session", text: "Jimmy · now · fix status" },
    });

    expect(model).toEqual({
      content: {
        band: "session",
        category: "contextual-inspection",
        kind: "provenance",
        text: "Jimmy · now · fix status",
      },
      layout: "full",
    });
  });

  test("promotes persistent warnings and errors ahead of provenance", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      backgroundProgress: "installing typescript server…",
      outcome: { level: "error", text: "typescript failed" },
      provenance: { band: "session", text: "Jimmy · now · fix status" },
    });

    expect(model).toMatchObject({
      content: {
        category: "ambient",
        kind: "ambient",
        level: "error",
        message: "typescript failed",
      },
      layout: "full",
    });
  });

  test("keeps complete background content beside the generic hint when it fits", () => {
    const activity = {
      at: 1000,
      changeKind: "modified",
      path: "src/state.ts",
    } satisfies StatusBarActivity;
    const model = buildStatusBarModel({
      ...baseInput,
      activity,
      backgroundProgress: "checking…",
      width: 80,
    });

    expect(model).toEqual({
      content: {
        activity,
        category: "background-progress",
        kind: "ambient",
        level: "info",
        message: "checking…",
      },
      hint: baseInput.hint,
      layout: "split",
    });
  });

  test("promotes background content when the complete group does not fit", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      activity: { at: 1000, changeKind: "modified", path: "src/components/StatusBar.tsx" },
      backgroundProgress: "installing typescript server…",
      width: 48,
    });

    expect(model.layout).toBe("full");
    expect(model.content).toMatchObject({
      category: "background-progress",
      kind: "ambient",
      level: "info",
      message: "installing typescript server…",
    });
  });

  test("protects active-mode guidance and degrades the background content instead", () => {
    const hint = {
      category: "guidance",
      mode: "active",
      text: "type to find · enter confirm · esc cancel",
    } satisfies StatusBarHint;
    const model = buildStatusBarModel({
      ...baseInput,
      activity: { at: 1000, changeKind: "modified", path: "src/components/StatusBar.tsx" },
      backgroundProgress: "installing typescript server…",
      hint,
      width: 48,
    });

    expect(model).toEqual({ content: undefined, hint, layout: "split" });
  });

  test("uses display-cell width for the fit decision", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      activity: { at: 1000, changeKind: "added", path: "src/🐛🐛🐛🐛.ts" },
      width: 34,
    });

    expect(model.layout).toBe("full");
    expect(
      Bun.stringWidth(
        model.content?.kind === "ambient" ? (model.content.activity?.path ?? "") : "",
      ),
    ).toBeLessThanOrEqual(30);
  });

  test("drops the activity group before truncating a longer status message", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      activity: { at: 1000, changeKind: "modified", path: "src/state.ts" },
      backgroundProgress: "installing an unusually long language server name…",
      width: 28,
    });

    expect(model.layout).toBe("full");
    expect(model.content).toMatchObject({
      activity: undefined,
      category: "background-progress",
      kind: "ambient",
    });
    if (model.content?.kind === "ambient") {
      expect(model.content.message.startsWith("installing")).toBe(true);
      expect(Bun.stringWidth(`ℹ ${model.content.message}`)).toBeLessThanOrEqual(26);
    }
  });
});
