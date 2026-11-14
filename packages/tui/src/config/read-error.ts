import { Data } from "effect";

export class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
  readonly message: string;
}> {}
