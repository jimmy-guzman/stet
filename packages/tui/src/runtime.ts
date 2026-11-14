import { Layer, ManagedRuntime } from "effect";

import { ClipboardLive } from "./clipboard/service";
import { ConfigLive } from "./config/service";
import { DiffEngineLive } from "./diff/engine";
import { EditorLive } from "./editor/service";
import { FileLive } from "./file/service";
import { GitLive } from "./git/service";
import { ProcessLive } from "./process";
import { WatcherLive } from "./watcher/service";

// One long-lived Effect runtime holding the service layer. Solid signals and
// Effects run service effects through `runtime.runPromise` / `runtime.runFork`
// Instead of the old effect-atom registry; this is the only Effect↔Solid seam.
const AppLayer = Layer.mergeAll(
  DiffEngineLive,
  EditorLive,
  FileLive,
  ClipboardLive,
  // The `ctrl-s` settings write; startup still loads config on its own
  // Short-lived runtime in main.tsx, before this one first runs.
  ConfigLive,
  WatcherLive,
).pipe(
  // Provide Git to Watcher (and re-export it to the runtime for startup/state).
  Layer.provideMerge(GitLive),
  // Every subprocess reaches Process through its own service, so this one only wires the layers
  // Above rather than re-exporting.
  Layer.provide(ProcessLive),
);

export const runtime = ManagedRuntime.make(AppLayer);
