import { Data } from "effect";

export class ConfigWriteError extends Data.TaggedError("ConfigWriteError")<{
  readonly message: string;
}> {}
