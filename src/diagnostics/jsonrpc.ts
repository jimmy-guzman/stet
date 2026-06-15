/**
 * JSON-RPC 2.0 envelope types and the LSP base-protocol `Content-Length` stdio framing. Pure: no
 * Effect, no process. The decoder is a stateful closure so it survives chunk boundaries (a single
 * read can split a header or a body, or carry several messages).
 */

type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponseError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcResponseError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A response carries an `id` and either a `result` (any JSON value, including `null`) or a
 * well-formed `error` object. A malformed `error` (e.g. `null`) is rejected so the router never
 * dereferences `error.message` on it.
 */
export function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
  if (!isObject(message) || !("id" in message)) {
    return false;
  }
  if ("error" in message) {
    return isObject(message.error) && typeof message.error.message === "string";
  }
  return "result" in message;
}

/** A server-to-client request carries both a `method` and an `id`. */
export function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
  return isObject(message) && "method" in message && "id" in message;
}

/** A notification carries a `method` and no `id`. */
export function isJsonRpcNotification(message: unknown): message is JsonRpcNotification {
  return isObject(message) && "method" in message && !("id" in message);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Bounds the decoder's buffer so a server that floods bytes without a frame separator, or declares a
// Pathological `Content-Length`, cannot exhaust memory. Far above any real LSP message.
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encodeMessage(message: JsonRpcMessage): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const framed = new Uint8Array(header.length + body.length);
  framed.set(header, 0);
  framed.set(body, header.length);
  return framed;
}

function indexOfSeparator(buffer: Uint8Array): number {
  for (let i = 0; i + 3 < buffer.length; i += 1) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function parseContentLength(headerText: string): number | undefined {
  for (const line of headerText.split("\r\n")) {
    const match = /^content-length:\s*(?<length>\d+)$/i.exec(line.trim());
    if (match !== null) {
      return Number.parseInt(match.groups?.length ?? "", 10);
    }
  }
  return undefined;
}

/**
 * Creates a stateful decoder. Feed it raw stdout bytes; it returns every message that is now fully
 * framed, retaining any partial trailing bytes for the next call. `Content-Length` is a byte count,
 * so the body is sliced on bytes and decoded once whole, keeping multibyte sequences intact across
 * chunk splits. Bodies are returned as `unknown`: the framing layer does not vouch for their shape,
 * the router narrows each to a `JsonRpcMessage`.
 */
export function createFrameDecoder() {
  let buffer = new Uint8Array(0);

  function append(chunk: Uint8Array) {
    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer, 0);
    next.set(chunk, buffer.length);
    buffer = next;
  }

  return function push(chunk: Uint8Array): unknown[] {
    append(chunk);
    if (buffer.length > MAX_MESSAGE_BYTES) {
      // Throws like a malformed-JSON body would: the read loop ends the channel and the pool rebuilds.
      throw new Error(`LSP frame exceeds ${MAX_MESSAGE_BYTES} bytes`);
    }
    const messages: unknown[] = [];

    let headerEnd = indexOfSeparator(buffer);
    while (headerEnd !== -1) {
      const contentLength = parseContentLength(decoder.decode(buffer.subarray(0, headerEnd)));
      if (contentLength === undefined) {
        // Unparseable header: skip past the separator to resync rather than wedge the stream.
        buffer = buffer.subarray(headerEnd + 4);
        headerEnd = indexOfSeparator(buffer);
        continue;
      }

      const bodyEnd = headerEnd + 4 + contentLength;
      if (buffer.length < bodyEnd) {
        break;
      }

      const body: unknown = JSON.parse(decoder.decode(buffer.subarray(headerEnd + 4, bodyEnd)));
      buffer = buffer.subarray(bodyEnd);
      messages.push(body);
      headerEnd = indexOfSeparator(buffer);
    }

    return messages;
  };
}
