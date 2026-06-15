import { expect, test } from "bun:test";

import { Effect } from "effect";

import {
  languageForPath,
  performHandshake,
  resolveServerCommand,
} from "../src/diagnostics/servers";
import type { LspConnection } from "../src/diagnostics/transport";

test("maps source file extensions to their language server", () => {
  expect(languageForPath("src/a.tsx")).toBe("typescript");
  expect(languageForPath("src/a.mjs")).toBe("typescript");
  expect(languageForPath("README.md")).toBeUndefined();
  expect(languageForPath("Makefile")).toBeUndefined();
});

test("resolveServerCommand returns undefined for a language with no registered server", () => {
  expect(resolveServerCommand("ruby", "/repo")).toBeUndefined();
});

test("handshake reports pull-diagnostics support from the initialize result", async () => {
  const requested: string[] = [];
  const notified: string[] = [];
  const connection: LspConnection = {
    clearPublished: () => Effect.void,
    closed: Effect.sync(() => false),
    notify: (method) => Effect.sync(() => void notified.push(method)),
    published: Effect.sync(() => new Map<string, unknown[]>()),
    request: (method) =>
      Effect.sync(() => {
        requested.push(method);
        return method === "initialize"
          ? { capabilities: { diagnosticProvider: { interFileDependencies: true } } }
          : null;
      }),
  };

  const handle = await Effect.runPromise(performHandshake(connection, "/repo"));

  expect(handle.supportsPullDiagnostics).toBe(true);
  expect(requested).toEqual(["initialize"]);
  expect(notified).toEqual(["initialized"]);
});

test("handshake reports no pull support when the server has no diagnosticProvider", async () => {
  const connection: LspConnection = {
    clearPublished: () => Effect.void,
    closed: Effect.sync(() => false),
    notify: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    request: () => Effect.succeed({ capabilities: {} }),
  };

  const handle = await Effect.runPromise(performHandshake(connection, "/repo"));

  expect(handle.supportsPullDiagnostics).toBe(false);
});
