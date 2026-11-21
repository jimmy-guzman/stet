import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createFixtureRepo, loadGitShowContent, runGit } from "./helpers";

test("File.content classifies a deleted binary file from git-show as binary", async () => {
  const repo = createFixtureRepo("file-service-binary-", { "keep.txt": "x\n" });

  writeFileSync(
    path.join(repo, "logo.bin"),
    Buffer.from([0x89, 0x50, 0x00, 0x47])
  );
  runGit(repo, ["add", "logo.bin"]);
  runGit(repo, ["commit", "-m", "add binary"]);
  runGit(repo, ["rm", "logo.bin"]);

  expect(await loadGitShowContent(repo, "logo.bin")).toEqual({
    bytes: 4,
    kind: "binary",
  });
});

test("File.content decodes a deleted text file from git-show", async () => {
  const repo = createFixtureRepo("file-service-text-", {
    "note.txt": "hello\nworld\n",
  });

  runGit(repo, ["rm", "note.txt"]);

  expect(await loadGitShowContent(repo, "note.txt")).toEqual({
    content: "hello\nworld",
    kind: "text",
    lineCount: 2,
    truncated: false,
  });
});
