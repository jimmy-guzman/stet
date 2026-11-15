import { expect, test } from "bun:test";

import { TextRenderable } from "@opentui/core";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";
import { setSelection } from "@/theme/active";

const mountedFileNames = (root: Renderable) => {
  const names: string[] = [];

  const visit = (node: Renderable) => {
    if (
      node instanceof TextRenderable &&
      /^f\d{5}\.txt$/u.test(node.plainText)
    ) {
      names.push(node.plainText);
    }

    for (const child of node.getChildren()) {
      visit(child);
    }
  };

  visit(root);

  return names;
};

test("mounts only the viewport through scroll and resize with monochrome and icons off", async () => {
  state.setGitModel({
    ...state.gitModel(),
    repoFiles: Array.from({ length: 10_000 }, (_, i) => ({
      path: `big/f${String(i).padStart(5, "0")}.txt`,
      symlink: false,
      tracked: true,
    })),
    repoFilesKey: "loaded",
  });
  state.setExpandedDirectories(new Set(["dir:big"]));
  state.setIconsEnabled(false);
  setSelection("mono-dark");

  const { renderer, renderOnce, captureCharFrame, mockMouse, mockInput } =
    await testRender(() => <App />, { height: 24, width: 100 });

  try {
    await renderOnce();
    expect(mountedFileNames(renderer.root).length).toBeGreaterThan(0);
    expect(mountedFileNames(renderer.root).length).toBeLessThanOrEqual(
      state.layout().sidebar.content.height
    );
    expect(captureCharFrame()).toContain("▾");
    state.selectFile("big/f09999.txt");
    await renderOnce();
    expect(mountedFileNames(renderer.root)).toContain("f09999.txt");
    expect(mountedFileNames(renderer.root).length).toBeLessThanOrEqual(
      state.layout().sidebar.content.height
    );
    renderer.resize(60, 12);
    await renderOnce();
    await renderOnce();
    expect(mountedFileNames(renderer.root)).toContain("f09999.txt");
    expect(mountedFileNames(renderer.root).length).toBeLessThanOrEqual(
      state.layout().sidebar.content.height
    );
    await mockMouse.scroll(5, 5, "up");
    await renderOnce();
    expect(mountedFileNames(renderer.root).length).toBeLessThanOrEqual(
      state.layout().sidebar.content.height
    );
    mockInput.pressKey("k");
    await renderOnce();
    expect(captureCharFrame()).toContain("f09998.txt");
  } finally {
    renderer.destroy();
  }
});
