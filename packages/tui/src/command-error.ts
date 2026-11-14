import { Data } from "effect";

export class CommandError extends Data.TaggedError("CommandError")<{
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string;
}> {}
