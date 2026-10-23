/**
 * The wire shapes of Vue's tsserver bridge. `vue-language-server` 3.x reads its project (which
 * tsconfig, hence which `vueCompilerOptions`) and every component fact from tsserver through
 * `@vue/typescript-plugin`, but it cannot reach tsserver itself: it sends a `tsserver/request`
 * notification and waits for the client to forward it and answer with `tsserver/response`. Shapes
 * measured against `@vue/language-server@3.3.12` and `typescript-language-server@5.3.0`.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * One forwarded request from `tsserver/request`'s params, `[[id, command, args]]` (the server wraps
 * its single array argument, so the triple is nested one level).
 *
 * @param params - The notification's params
 * @returns The request, or `undefined` when there is no id to answer
 */
export function parseTsserverRequest(params: unknown) {
  const triple = Array.isArray(params) ? params[0] : undefined;
  if (!Array.isArray(triple)) {
    return undefined;
  }
  const [id, command, args] = triple;
  if (typeof id !== "number" || typeof command !== "string") {
    return undefined;
  }
  return { args, command, id };
}

/**
 * The file a request is about, when it names one. tsserver answers a file only once it has the
 * document open, so the bridge opens it on tsserver before forwarding.
 */
export function tsserverRequestFile(args: unknown) {
  return isObject(args) && typeof args.file === "string" ? args.file : undefined;
}

/**
 * The `workspace/executeCommand` params that run one tsserver command through
 * typescript-language-server. `isAsync` keeps a slow command from blocking tsserver's queue.
 */
export function tsserverRequestParams(command: string, args: unknown) {
  return {
    arguments: [command, args, { isAsync: true, lowPriority: true }],
    command: "typescript.tsserverRequest",
  };
}

/** The tsserver response body out of the `executeCommand` result, `null` when it carried none. */
export function tsserverResponseBody(result: unknown) {
  return isObject(result) ? (result.body ?? null) : null;
}
