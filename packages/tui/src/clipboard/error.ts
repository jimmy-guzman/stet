import { Data } from "effect";

export class ClipboardError extends Data.TaggedError("ClipboardError")<{
  readonly message: string;
}> {}
