/**
 * JSON-RPC request/response correlation over an abstract message channel. A forked router fiber
 * drains inbound messages: responses resolve the matching pending request, server-to-client
 * requests get a minimal reply so the server never blocks, notifications are logged. Decoupled from
 * the process so it can be driven by a fake in-process peer in tests.
 */
import { Data, Deferred, Effect, Queue } from "effect";
import type { Cause } from "effect";

import { isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse } from "./jsonrpc";
import type { JsonRpcMessage } from "./jsonrpc";

export class LspRequestError extends Data.TaggedError("LspRequestError")<{
  readonly method: string;
  readonly message: string;
}> {}

export interface LspTransportChannel {
  readonly inbound: Queue.Dequeue<unknown, Cause.Done>;
  readonly send: (message: JsonRpcMessage) => Effect.Effect<void>;
}

interface TextDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly text: string;
  readonly version: number;
}

export interface LspConnection {
  readonly request: (method: string, params?: unknown) => Effect.Effect<unknown, LspRequestError>;
  readonly notify: (method: string, params?: unknown) => Effect.Effect<void>;
  /**
   * Refcounted `textDocument/didOpen`: sent only on the first holder of a uri (count 0→1); a later
   * holder reuses the already-open doc. Intel pulls and the diagnostics run share one connection,
   * so this keeps a second open from resetting the server's view of a doc another holder still
   * needs.
   */
  readonly openDocument: (textDocument: TextDocument) => Effect.Effect<void>;
  /** Refcounted `textDocument/didClose`: sent only when the last holder of the uri releases (1→0). */
  readonly closeDocument: (uri: string) => Effect.Effect<void>;
  /** Latest server-pushed `publishDiagnostics` items, keyed by document URI. */
  readonly published: Effect.Effect<ReadonlyMap<string, unknown[]>>;
  /** Drop stored diagnostics for the given URIs before reopening them, so a re-pull starts clean. */
  readonly clearPublished: (uris: readonly string[]) => Effect.Effect<void>;
  /** True once the server's stdout closed — the child died; the pool should rebuild it. */
  readonly closed: Effect.Effect<boolean>;
}

interface Pending {
  readonly deferred: Deferred.Deferred<unknown, LspRequestError>;
  readonly method: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function makeTransport(
  channel: LspTransportChannel,
  onRequest?: (method: string, params: unknown) => Effect.Effect<unknown>,
) {
  return Effect.gen(function* makeTransportScope() {
    // Default answer for a server-to-client request: a null result, so a server that asks for
    // Something we do not model (typescript) never stalls. oxlint supplies a real handler.
    const respond = onRequest ?? (() => Effect.succeed(null));
    const pending = new Map<number, Pending>();
    const published = new Map<string, unknown[]>();
    const openCounts = new Map<string, number>();
    let nextId = 0;
    let closed = false;

    function dispatch(message: unknown) {
      if (isJsonRpcResponse(message)) {
        if (typeof message.id !== "number") {
          return Effect.void;
        }
        const entry = pending.get(message.id);
        if (entry === undefined) {
          return Effect.void;
        }
        pending.delete(message.id);
        return message.error === undefined
          ? Deferred.succeed(entry.deferred, message.result)
          : Deferred.fail(
              entry.deferred,
              new LspRequestError({ message: message.error.message, method: entry.method }),
            );
      }
      if (isJsonRpcRequest(message)) {
        // Answer server-to-client requests so the server does not stall waiting on us; the handler
        // (or the null default) decides the result.
        const { id } = message;
        return respond(message.method, message.params).pipe(
          Effect.flatMap((result) => channel.send({ id, jsonrpc: "2.0", result })),
        );
      }
      if (isJsonRpcNotification(message)) {
        if (message.method === "textDocument/publishDiagnostics" && isObject(message.params)) {
          const { diagnostics, uri } = message.params;
          if (typeof uri === "string" && Array.isArray(diagnostics)) {
            published.set(uri, diagnostics);
          }
          return Effect.void;
        }
        return Effect.logDebug(`lsp notification ${message.method}`);
      }
      return Effect.void;
    }

    // The router stops when the inbound queue ends or fails (the connection closed); fail every
    // Still-pending request so a caller awaiting a reply is released rather than hanging forever.
    const router = Queue.take(channel.inbound).pipe(
      Effect.flatMap(dispatch),
      Effect.forever,
      Effect.catchCause(() =>
        Effect.sync(() => {
          closed = true;
        }).pipe(
          Effect.andThen(
            Effect.forEach(
              [...pending.values()],
              (entry) =>
                Deferred.fail(
                  entry.deferred,
                  new LspRequestError({ message: "connection closed", method: entry.method }),
                ),
              { discard: true },
            ),
          ),
        ),
      ),
    );
    yield* Effect.forkScoped(router);

    const request = (method: string, params?: unknown) =>
      Deferred.make<unknown, LspRequestError>().pipe(
        Effect.flatMap((deferred) => {
          const id = nextId;
          nextId += 1;
          pending.set(id, { deferred, method });
          return channel
            .send({ id, jsonrpc: "2.0", method, params })
            .pipe(
              Effect.andThen(Deferred.await(deferred)),
              Effect.ensuring(Effect.sync(() => pending.delete(id))),
            );
        }),
      );

    const notify = (method: string, params?: unknown) =>
      channel.send({ jsonrpc: "2.0", method, params });

    // The count is read-modified-written synchronously inside `suspend`, before the async send, so a
    // Second fiber acquiring the same uri can't interleave between the read and the increment.
    const openDocument = (textDocument: TextDocument) =>
      Effect.suspend(() => {
        const count = openCounts.get(textDocument.uri) ?? 0;
        openCounts.set(textDocument.uri, count + 1);
        return count === 0 ? notify("textDocument/didOpen", { textDocument }) : Effect.void;
      });

    const closeDocument = (uri: string) =>
      Effect.suspend(() => {
        const count = openCounts.get(uri) ?? 0;
        if (count > 1) {
          openCounts.set(uri, count - 1);
          return Effect.void;
        }
        openCounts.delete(uri);
        return count === 1
          ? notify("textDocument/didClose", { textDocument: { uri } })
          : Effect.void;
      });

    return {
      clearPublished: (uris: readonly string[]) =>
        Effect.sync(() => {
          for (const uri of uris) {
            published.delete(uri);
          }
        }),
      closeDocument,
      closed: Effect.sync(() => closed),
      notify,
      openDocument,
      published: Effect.sync(() => published),
      request,
    } satisfies LspConnection;
  });
}
