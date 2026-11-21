import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createIndexCopies } from "@/git/private-index";

test("createIndexCopies drops a copy once its index is gone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "private-index-gone-"));
  const index = path.join(dir, "index");
  writeFileSync(index, "index bytes");
  const copies = createIndexCopies();

  const copy = copies.copyFor(index);
  rmSync(index);

  expect(copy !== undefined && existsSync(copy)).toBe(true);
  expect(copies.copyFor(index)).toBeUndefined();
  expect(copy !== undefined && existsSync(copy)).toBe(false);

  copies.dispose();
  rmSync(dir, { force: true, recursive: true });
});

test("createIndexCopies removes every copy on dispose", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "private-index-dispose-"));
  const index = path.join(dir, "index");
  writeFileSync(index, "index bytes");
  const copies = createIndexCopies();

  const copy = copies.copyFor(index);
  copies.dispose();

  expect(copy).toBeDefined();
  expect(copy !== undefined && existsSync(copy)).toBe(false);

  rmSync(dir, { force: true, recursive: true });
});
