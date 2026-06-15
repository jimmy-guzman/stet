import { expect, test } from "bun:test";

import { mapLspDiagnostic } from "../src/diagnostics/protocol";

const range = { end: { character: 5, line: 0 }, start: { character: 1, line: 0 } };

test("maps the 0-based LSP start line to a 1-based line", () => {
  const mapped = mapLspDiagnostic(
    {
      message: "oops",
      range: { end: { character: 0, line: 41 }, start: { character: 0, line: 41 } },
    },
    "file:///repo/src/a.ts",
  );
  expect(mapped.line).toBe(42);
});

test("maps LSP severities onto the domain vocabulary", () => {
  const severityOf = (severity: number | undefined) =>
    mapLspDiagnostic({ message: "m", range, severity }, "file:///repo/a.ts").severity;
  expect(severityOf(1)).toBe("error");
  expect(severityOf(2)).toBe("warning");
  expect(severityOf(3)).toBe("info");
  expect(severityOf(4)).toBe("info");
  expect(severityOf(undefined)).toBe("error");
});

test("converts a file URI to an absolute filesystem path", () => {
  const mapped = mapLspDiagnostic({ message: "m", range }, "file:///repo/src/a.ts");
  expect(mapped.path).toBe("/repo/src/a.ts");
});

test("carries the LSP source label through", () => {
  const mapped = mapLspDiagnostic({ message: "m", range, source: "ts" }, "file:///repo/a.ts");
  expect(mapped.source).toBe("ts");
});
