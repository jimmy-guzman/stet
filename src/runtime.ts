import { Layer, ManagedRuntime } from "effect"
import { ClipboardLive } from "./services/clipboard"
import { DiagnosticsLive } from "./services/diagnostics"
import { FileLive } from "./services/file"
import { GitLive } from "./services/git"
import { ProcessLive } from "./services/process"

// One long-lived Effect runtime holding the service layer. Solid signals and
// Effects run service effects through `runtime.runPromise` / `runtime.runFork`
// Instead of the old effect-atom registry; this is the only Effect↔Solid seam.
// ProvideMerge keeps Process in the runtime context (not just wired into the
// Other services) so startup effects can spawn git directly.
const AppLayer = Layer.mergeAll(DiagnosticsLive, GitLive, FileLive, ClipboardLive).pipe(Layer.provideMerge(ProcessLive))

export const runtime = ManagedRuntime.make(AppLayer)
