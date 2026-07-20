import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect } from "effect";

import { LspProcess, LspProcessLive } from "@/diagnostics/lsp-process";
import { handshakeConfigFor, performHandshake, resolveServerCommand } from "@/diagnostics/servers";
import type { LspConnection, LspRequestError } from "@/diagnostics/transport";

/**
 * Pull diagnostics until the document has some (the outer timeout caps it). The JSON server is a
 * `diagnosticProvider`, so under stet's pull-capable handshake it answers `textDocument/diagnostic`
 * rather than pushing, exactly as the run loop reads it.
 */
function pullUntilDiagnostics(
  connection: LspConnection,
  uri: string,
): Effect.Effect<unknown[], LspRequestError> {
  return connection
    .pullDiagnostics(uri)
    .pipe(
      Effect.flatMap((report) =>
        report.items.length > 0
          ? Effect.succeed(report.items)
          : Effect.sleep("100 millis").pipe(
              Effect.andThen(() => pullUntilDiagnostics(connection, uri)),
            ),
      ),
    );
}

/**
 * The delivery path (`handshakeConfigFor` -> `performHandshake` -> transport) is unit-tested
 * against a fake peer; this drives the real `vscode-json-language-server` end to end to prove the
 * association notification actually makes it validate. The schema is a `file://` fixture on disk,
 * so the check is hermetic (no SchemaStore network) and stays green offline. It skips when the
 * server binary is not discoverable, which is the case in CI (`STET_NO_LSP_DOWNLOAD` blocks
 * provisioning).
 */
const jsonCommand = resolveServerCommand("json", process.cwd());

test.skipIf(jsonCommand === undefined)(
  "the real json server validates a document against a schema stet associates",
  async () => {
    if (jsonCommand === undefined) {
      throw new Error("json server command unexpectedly missing after skip guard");
    }
    const repo = mkdtempSync(join(tmpdir(), "stet-json-schema-e2e-"));
    try {
      writeFileSync(
        join(repo, "schema.json"),
        JSON.stringify({
          properties: { name: { type: "string" } },
          required: ["name"],
          type: "object",
        }),
      );
      const uri = pathToFileURL(join(repo, "config.json")).href;
      // A repo-local schema, associated by file-match; `{repoUri}` resolves to this repo's file URI.
      const config = handshakeConfigFor(
        { schemaAssociations: { "config.json": ["{repoUri}/schema.json"] } },
        repo,
      );

      const diagnostics = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* driveServer() {
            const lsp = yield* LspProcess;
            const connection = yield* lsp.start(jsonCommand, repo, config?.onRequest);
            yield* performHandshake(connection, repo, config);
            // `name` must be a string; the number is the schema violation to surface.
            yield* connection.openDocument({
              languageId: "json",
              text: '{ "name": 123 }',
              uri,
              version: 1,
            });
            return yield* pullUntilDiagnostics(connection, uri);
          }),
        ).pipe(Effect.provide(LspProcessLive), Effect.timeout("15 seconds")),
      );

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(JSON.stringify(diagnostics)).toContain("Incorrect type");
    } finally {
      rmSync(repo, { force: true, recursive: true });
    }
  },
);
