import { Data } from "effect";

export class EditorError extends Data.TaggedError("EditorError")<{
  readonly message: string;
}> {}
