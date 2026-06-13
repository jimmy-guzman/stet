import { Context, Effect, Layer, Queue, Stream } from "effect"
import { runDiagnostics, type CheckerFileState, type CheckerName } from "../diagnostics"
import type { ChangedFile } from "../git"

export interface CheckerUpdate {
  checker: CheckerName
  state: Map<string, CheckerFileState>
}

export class Diagnostics extends Context.Service<
  Diagnostics,
  {
    readonly run: (repoRoot: string, files: ChangedFile[]) => Stream.Stream<CheckerUpdate>
  }
>()("sideye/Diagnostics") {}

export const DiagnosticsLive = Layer.succeed(Diagnostics)({
  // Failures surface as "failed" checker states rather than rejections, so the
  // Stream never errors. The promise's AbortSignal fires on interruption,
  // Killing in-flight checker processes; offers that still arrive land in an
  // Abandoned queue and are never consumed.
  run: (repoRoot, files) =>
    Stream.callback<CheckerUpdate>((queue) =>
      Effect.flatMap(
        Effect.promise((signal) =>
          runDiagnostics(
            repoRoot,
            files,
            (checker, state) => {
              Queue.offerUnsafe(queue, { checker, state })
            },
            signal,
          ),
        ),
        () => Queue.end(queue),
      ),
    ),
})
