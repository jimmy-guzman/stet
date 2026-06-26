import { Layer, ManagedRuntime } from "effect";

import { ClipboardLive } from "./clipboard/service";
import { LspProcessLive } from "./diagnostics/lsp-process";
import { ProvisionerLive } from "./diagnostics/provision";
import { LanguageServersLive } from "./diagnostics/servers";
import { DiagnosticsLive } from "./diagnostics/service";
import { DiffEngineLive } from "./diff/engine";
import { EditorLive } from "./editor/service";
import { FileLive } from "./file/service";
import { GitLive } from "./git/service";
import { ProcessLive } from "./process";
import { WatcherLive } from "./watcher/service";

// One long-lived Effect runtime holding the service layer. Solid signals and
// Effects run service effects through `runtime.runPromise` / `runtime.runFork`
// Instead of the old effect-atom registry; this is the only Effect↔Solid seam.
// ProvideMerge keeps Process in the runtime context (not just wired into the
// Other services) so startup effects can spawn git directly. The LSP-backed
// Diagnostics pool sits over its own long-lived LspProcess.
const AppLayer = Layer.mergeAll(
  DiagnosticsLive,
  DiffEngineLive,
  EditorLive,
  FileLive,
  ClipboardLive,
  WatcherLive,
).pipe(
  Layer.provideMerge(LanguageServersLive),
  Layer.provideMerge(LspProcessLive),
  Layer.provideMerge(ProvisionerLive),
  // Provide Git to Watcher (and re-export it to the runtime for startup/state).
  Layer.provideMerge(GitLive),
  Layer.provideMerge(ProcessLive),
);

export const runtime = ManagedRuntime.make(AppLayer);
