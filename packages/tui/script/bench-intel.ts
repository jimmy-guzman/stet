import { realpathSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { Effect, Fiber, Layer, ManagedRuntime, Queue, Stream } from "effect";
import { bench, run } from "mitata";

import { REFERENCES_MAX_ROWS } from "@/constants";
import { LspProcess, LspProcessLive } from "@/diagnostics/lsp-process";
import { ProvisionerLive } from "@/diagnostics/provision";
import {
  activeServersForPath,
  LanguageServers,
  LanguageServersLive,
  lspLanguageId,
  registerServers,
  resolveServers,
  serversProviding,
} from "@/diagnostics/servers";
import { Diagnostics, DiagnosticsLive } from "@/diagnostics/service";
import { defaultFileSupportRegistry, registerFileSupport } from "@/file-support/registry";
import { File, FileLive } from "@/file/service";
import { Intel, IntelLive } from "@/intel/service";
import { ProcessLive } from "@/process";
import { relativize } from "@/utils/path";

/**
 * Headless intel benchmark against a real repository and a real language server, so perf changes
 * cite measured numbers instead of guesses. Each stage of a pull (server acquire, project-load
 * wait, request round-trip) is timed on its own clock, with an event-loop stall histogram running
 * throughout, because the costs this exists to catch (a request queued behind indexing, a sync
 * syscall storm on the render thread) show up in different columns.
 *
 * `--pos` is 1-based line:column as an editor displays it.
 */
const USAGE = `usage: bun run bench:intel <scenario> --repo <abs-path> [options]
scenarios:
  cold             acquire, project load, then a cold and a repeat pull
  references       one references pull cold, then repeated
  references-open  what the overlay pays: locations, windowed previews, every file
  churn            pulls while watcher batches invalidate the cache
  contention       pulls against N documents held open on the connection
  contention-run   a pull issued while a real diagnostics run is in flight
  diagnostics      one diagnostics run over N changed files
  cold-loop        re-check nudges provoked by one cold project load
  gates            server-gate snapshot cost
  realpath         per-result canonicalization vs prefix relativize
options:
  --repo <abs-path>   repository to benchmark against (required)
  --file <rel-path>   file to pull intel on (required except diagnostics/cold-loop/realpath)
  --pos <line:col>    1-based caret for definition/references pulls
  --runs <n>          pulls per scenario (default 5)
  --docs <n>          held-open or changed documents (default 50)`;

function parseArgs(argv: string[]) {
  const [scenario, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key === undefined || !key.startsWith("--") || value === undefined) {
      return undefined;
    }
    flags.set(key.slice(2), value);
  }
  if (scenario === undefined) {
    return undefined;
  }
  // A count that is not a positive integer is rejected rather than coerced: `Number("all")` is
  // NaN, and `slice(0, NaN)` samples zero files, so the harness would silently report timings for
  // A benchmark that measured nothing.
  const docs = positiveCount(flags.get("docs"), 50);
  const runs = positiveCount(flags.get("runs"), 5);
  if (docs === undefined || runs === undefined) {
    return undefined;
  }
  const pos = /^(?<line>\d+):(?<column>\d+)$/.exec(flags.get("pos") ?? "");
  return {
    docs,
    file: flags.get("file"),
    position:
      pos?.groups === undefined
        ? { character: 0, line: 0 }
        : { character: Number(pos.groups.column) - 1, line: Number(pos.groups.line) - 1 },
    repo: flags.get("repo"),
    runs,
    scenario,
  };
}

function positiveCount(raw: string | undefined, fallback: number) {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const now = () => performance.now();
const ms = (value: number) => `${value.toFixed(1)}ms`;

function report(label: string, value: string) {
  console.log(`${label.padEnd(44)} ${value}`);
}

async function listFiles(repo: string, extension: string, limit?: number) {
  const proc = Bun.spawn(["git", "-C", repo, "ls-files", "-z"], { stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  const matched = out.split("\0").filter((path) => path.endsWith(extension));
  return limit === undefined ? matched : matched.slice(0, limit);
}

interface Caret {
  character: number;
  line: number;
}

/** A timed-out or failed pull is a data point for this harness, not a crash. */
function timed<A, E>(label: string, effect: Effect.Effect<A, E>, describe?: (value: A) => string) {
  return Effect.suspend(() => {
    const start = now();
    return effect.pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          const detail = describe === undefined ? "" : ` (${describe(value)})`;
          report(label, `${ms(now() - start)}${detail}`);
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          const message =
            typeof error === "object" && error !== null && "message" in error
              ? String(error.message)
              : String(error);
          report(label, `FAILED after ${ms(now() - start)}: ${message}`);
        }),
      ),
    );
  });
}

function makeRuntime() {
  // The same startup snapshot main.tsx seeds: built-in servers and file support, no user config,
  // So `serversProviding`/`lspLanguageId` resolve exactly as they do in the app.
  registerServers(resolveServers({}).servers);
  registerFileSupport(defaultFileSupportRegistry());
  return ManagedRuntime.make(
    Layer.mergeAll(IntelLive, DiagnosticsLive, FileLive).pipe(
      Layer.provideMerge(LanguageServersLive),
      Layer.provideMerge(LspProcessLive),
      Layer.provideMerge(ProvisionerLive),
      Layer.provide(ProcessLive),
    ),
  );
}

type BenchRuntime = ReturnType<typeof makeRuntime>;

/**
 * Acquire (spawn + initialize), project-load wait, then a cold and a repeat definition pull, each
 * stage on its own clock. The acquire scope stays open across the pulls, standing in for the warm
 * hold, so the pool's 30s idle TTL cannot reap the server between stages.
 */
function coldScenario(runtime: BenchRuntime, repo: string, file: string, caret: Caret) {
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* cold() {
        const intel = yield* Intel;
        const servers = yield* LanguageServers;
        const candidates = yield* serversProviding(file, "definition", repo);
        const language = candidates[0];
        if (language === undefined) {
          console.error(`no definition-capable server for ${file}`);
          return;
        }
        report("server", language);
        const acquireStart = now();
        const handle = yield* servers.acquire(language, repo);
        report("acquire (spawn + initialize)", ms(now() - acquireStart));
        // Open the target before waiting: a server announces its project load only once it has a
        // Document (waiting first would ride the silent-server grace and latch "loaded" early,
        // Which the first run of this harness demonstrated). Same order as the app's warm hold.
        const text = yield* Effect.promise(() => Bun.file(join(repo, file)).text());
        const uri = pathToFileURL(join(repo, file)).href;
        yield* handle.connection.openDocument({
          languageId: lspLanguageId(file),
          text,
          uri,
          version: 1,
        });
        const loadStart = now();
        yield* handle.connection.whenProjectLoaded;
        report("project load wait", ms(now() - loadStart));
        yield* handle.connection.closeDocument(uri);
        yield* timed(
          "definition pull (cold)",
          intel.definition(repo, file, caret),
          (locations) => `${locations.length} hits`,
        );
        yield* timed("definition pull (repeat)", intel.definition(repo, file, caret));
        yield* timed(
          "hover pull",
          intel.hover(repo, file, caret),
          (segments) => `${segments.length} segments`,
        );
      }),
    ),
  );
}

/**
 * One references pull cold, one repeated (cache hit), reporting result count: the scenario whose
 * reply size drives the relativize and preview costs.
 */
function referencesScenario(runtime: BenchRuntime, repo: string, file: string, caret: Caret) {
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* references() {
        const intel = yield* Intel;
        yield* timed(
          "references pull (cold)",
          intel.references(repo, file, caret),
          (locations) => `${locations.length} results`,
        );
        yield* timed("references pull (repeat)", intel.references(repo, file, caret));
      }),
    ),
  );
}

/**
 * Pulls while synthetic watcher batches land every 500ms, modeling exactly what state.ts does on
 * each debounced tick during agent churn (repo-wide `Intel.invalidate` plus `notifyWatchedFiles`),
 * so every pull is a cold pull.
 */
async function churnScenario(
  runtime: BenchRuntime,
  repo: string,
  file: string,
  caret: Caret,
  runs: number,
) {
  const tracked = new Set(await listFiles(repo, ""));
  const batch = Array.from({ length: 40 }, (_, index) => ({
    path: `src/churn-${index}.ts`,
    renamed: false,
  }));
  const tick = setInterval(() => {
    runtime
      .runPromise(
        Effect.gen(function* invalidateTick() {
          const intel = yield* Intel;
          const servers = yield* LanguageServers;
          yield* intel.invalidate(repo, []);
          yield* servers.notifyWatchedFiles(repo, batch, (path) => tracked.has(path));
        }),
      )
      .catch(() => undefined);
  }, 500);
  try {
    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* churnPulls() {
          const intel = yield* Intel;
          const servers = yield* LanguageServers;
          const candidates = yield* serversProviding(file, "definition", repo);
          const language = candidates[0];
          if (language === undefined) {
            return;
          }
          const handle = yield* servers.acquire(language, repo);
          yield* handle.connection.whenProjectLoaded;
          for (let index = 0; index < runs; index += 1) {
            yield* timed(
              `definition pull under churn #${index + 1}`,
              intel.definition(repo, file, caret),
            );
            yield* Effect.sleep(700);
          }
        }),
      ),
    );
  } finally {
    // A failed acquire must not leave the ticker invalidating against a dead runtime.
    clearInterval(tick);
  }
}

/**
 * Pulls with N documents held open on the same connection, then again right after a full-set
 * didChange burst: the diagnostics-keeper shape, answering whether background sync work queues the
 * intel answer behind it.
 */
function contentionScenario(
  runtime: BenchRuntime,
  repo: string,
  file: string,
  caret: Caret,
  runs: number,
  docs: number,
) {
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* contention() {
        const intel = yield* Intel;
        const servers = yield* LanguageServers;
        const candidates = yield* serversProviding(file, "definition", repo);
        const language = candidates[0];
        if (language === undefined) {
          return;
        }
        const handle = yield* servers.acquire(language, repo);
        yield* handle.connection.whenProjectLoaded;
        const paths = yield* Effect.promise(() => listFiles(repo, ".ts", docs));
        const texts = yield* Effect.promise(() =>
          Promise.all(paths.map((path) => Bun.file(join(repo, path)).text())),
        );
        for (const [index, path] of paths.entries()) {
          const text = texts[index];
          if (text !== undefined) {
            yield* handle.connection.openDocument({
              languageId: lspLanguageId(path),
              text,
              uri: pathToFileURL(join(repo, path)).href,
              version: 1,
            });
          }
        }
        yield* timed(
          `definition with ${paths.length} docs quiet`,
          intel.definition(repo, file, caret),
        );
        for (let round = 0; round < runs; round += 1) {
          for (const [index, path] of paths.entries()) {
            const text = texts[index];
            if (text !== undefined) {
              yield* handle.connection.changeDocument(
                pathToFileURL(join(repo, path)).href,
                `${text}\n// bench-${round}`,
              );
            }
          }
          yield* intel.invalidate(repo, []);
          yield* timed(
            `definition after didChange burst #${round + 1}`,
            intel.definition(repo, file, caret),
          );
        }
      }),
    ),
  );
}

/**
 * One real diagnostics run against a cold server with N synthetic changed files (the repo is never
 * touched: the changed set is just a file list). Reports wall clock and the resolved/pending split
 * of the final snapshot: a run that settles into a mid-load window caps out with everything
 * pending, and each late publish then provokes a re-run.
 */
function diagnosticsScenario(runtime: BenchRuntime, repo: string, docs: number) {
  return runtime.runPromise(
    Effect.gen(function* diagnosticsRun() {
      const diagnostics = yield* Diagnostics;
      const paths = yield* Effect.promise(() => listFiles(repo, ".ts", docs));
      const files = paths.map((path) => ({
        additions: 1,
        binary: false,
        deletions: 0,
        kind: "modified" as const,
        mtimeMs: 0,
        path,
        stage: "unstaged" as const,
        warnings: [],
      }));
      const start = now();
      const updates = [...(yield* Stream.runCollect(diagnostics.run(repo, files)))];
      const statuses = [...(updates.at(-1)?.state.values() ?? [])].map((file) => file.status);
      const counts = [...Map.groupBy(statuses, (status) => status)]
        .map(([status, entries]) => `${status}:${entries.length}`)
        .join(" ");
      report(`diagnostics run (${paths.length} changed files)`, `${ms(now() - start)} (${counts})`);
    }),
  );
}

/** The synthetic changed set a diagnostics run takes: file paths only, the repo is never touched. */
function changedFiles(paths: readonly string[]) {
  return paths.map((path) => ({
    additions: 1,
    binary: false,
    deletions: 0,
    kind: "modified" as const,
    mtimeMs: 0,
    path,
    stage: "unstaged" as const,
    warnings: [],
  }));
}

/**
 * The interleaving the foreground gate governs, and the one the plain `contention` scenario cannot
 * see: a real `Diagnostics.run` (which is what sends the keeper's didOpen/didChange traffic) is in
 * flight while the user presses F12. Driving `changeDocument` directly, as `contention` does,
 * exercises the transport but never `syncDocuments`, so it measures the same thing before and
 * after.
 *
 * **Writes to `--repo`**, appending and then restoring a line in each sampled file, because the
 * keeper re-sends a document only when its on-disk content moved. Point it at a scratch checkout.
 */
function contentionRunScenario(
  runtime: BenchRuntime,
  repo: string,
  file: string,
  caret: Caret,
  docs: number,
) {
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* contentionRun() {
        const intel = yield* Intel;
        const servers = yield* LanguageServers;
        const candidates = yield* serversProviding(file, "definition", repo);
        const language = candidates[0];
        if (language === undefined) {
          console.error(`no definition-capable server for ${file}`);
          return;
        }
        // Warm the server and its project first: this measures contention, not the cold load.
        const handle = yield* servers.acquire(language, repo);
        const text = yield* Effect.promise(() => Bun.file(join(repo, file)).text());
        const uri = pathToFileURL(join(repo, file)).href;
        yield* handle.connection.openDocument({
          languageId: lspLanguageId(file),
          text,
          uri,
          version: 1,
        });
        yield* handle.connection.whenProjectLoaded;
        yield* handle.connection.closeDocument(uri);
        yield* timed("definition on a quiet server", intel.definition(repo, file, caret));

        const paths = yield* Effect.promise(() => listFiles(repo, ".ts", docs));
        const diagnostics = yield* Diagnostics;
        const files = changedFiles(paths);

        // Round 1: a fresh changed set, so the run's traffic is N didOpens.
        const openFiber = yield* Effect.forkChild(Stream.runDrain(diagnostics.run(repo, files)));
        yield* intel.invalidate(repo, []);
        yield* timed(
          `definition during a ${paths.length}-file didOpen run`,
          intel.definition(repo, file, caret),
        );
        report("run still in flight", String(openFiber.pollUnsafe() === undefined));
        yield* Fiber.join(openFiber);

        // Round 2: the same documents with moved content, so the keeper re-sends them all as
        // Change notifications. This is the traffic that starved the pull, because a server
        // Answers a semantic request only after rebuilding the program those changes invalidated,
        // And it is why this scenario needs a checkout it may write to (restored below).
        const originals = yield* Effect.promise(() =>
          Promise.all(paths.map((path) => Bun.file(join(repo, path)).text())),
        );
        // The edit is a resource, not a step: a failed pull, an interrupt, or a ctrl-c between
        // Here and the end of the scenario would otherwise leave the checkout dirty, and this
        // Writes to whatever `--repo` names.
        yield* Effect.acquireRelease(
          Effect.promise(() =>
            Promise.all(
              paths.map((path, index) =>
                Bun.write(join(repo, path), `${originals[index] ?? ""}\n// bench-touch\n`),
              ),
            ),
          ),
          () =>
            Effect.promise(() =>
              Promise.all(
                paths.map((path, index) => Bun.write(join(repo, path), originals[index] ?? "")),
              ),
            ),
        );
        const changeFiber = yield* Effect.forkChild(Stream.runDrain(diagnostics.run(repo, files)));
        yield* intel.invalidate(repo, []);
        yield* timed(
          `definition during a ${paths.length}-file didChange run`,
          intel.definition(repo, file, caret),
        );
        report("run still in flight", String(changeFiber.pollUnsafe() === undefined));
        yield* Fiber.interrupt(changeFiber);
      }),
    ),
  );
}

/**
 * How many diagnostics runs one cold project load provokes. A run that settles into a mid-load
 * window caps out with every file pending; each late publish is then read as the server changing
 * its mind and nudges another full run, for the whole duration of the load. Counting the nudges on
 * `LspProcess.refreshes` is the direct measure of that loop.
 */
function coldLoopScenario(runtime: BenchRuntime, repo: string, docs: number) {
  return runtime.runPromise(
    Effect.gen(function* coldLoop() {
      const diagnostics = yield* Diagnostics;
      const lsp = yield* LspProcess;
      const paths = yield* Effect.promise(() => listFiles(repo, ".ts", docs));
      const start = now();
      const updates = [...(yield* Stream.runCollect(diagnostics.run(repo, changedFiles(paths))))];
      const statuses = [...(updates.at(-1)?.state.values() ?? [])].map((entry) => entry.status);
      const counts = [...Map.groupBy(statuses, (status) => status)]
        .map(([status, entries]) => `${status}:${entries.length}`)
        .join(" ");
      report(`cold run (${paths.length} files)`, `${ms(now() - start)} (${counts})`);
      // Nothing else drains the queue in the harness, so the nudges a run provokes accumulate on
      // It. Wait out the window in which the server's late publishes land, then read the count
      // Without suspending (`clear`, since an empty queue is the outcome the fix predicts).
      yield* Effect.sleep("20 seconds");
      const nudges = yield* Queue.clear(lsp.refreshes);
      report("re-check nudges provoked", String(nudges.length));
    }),
  );
}

/**
 * What the overlay pays before it can be used. Phase 1 is the locations pull (the overlay opens on
 * it), phase 2 is the preview read. The windowed read covers one viewport; the eager read is what
 * every distinct referenced file in full used to cost, which is what delayed the open.
 */
function referencesOpenScenario(runtime: BenchRuntime, repo: string, file: string, caret: Caret) {
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* referencesOpen() {
        const intel = yield* Intel;
        const files = yield* File;
        const start = now();
        const locations = yield* intel
          .references(repo, file, caret)
          .pipe(Effect.catch(() => Effect.succeed([])));
        report(
          "locations (overlay can open)",
          `${ms(now() - start)} (${locations.length} results)`,
        );
        const distinct = [...new Set(locations.map((location) => location.path))];
        report("distinct files referenced", String(distinct.length));

        const readAll = (paths: readonly string[], concurrency: 4 | "unbounded") =>
          Effect.all(
            paths.map((path) => files.content(repo, path, { full: true })),
            { concurrency },
          );
        // One viewport's worth, the slice the windowed fill actually requests first.
        const windowStart = now();
        yield* readAll(distinct.slice(0, REFERENCES_MAX_ROWS), 4);
        report("previews for the first viewport", ms(now() - windowStart));
        const eagerStart = now();
        yield* readAll(distinct, "unbounded");
        report("previews for every referenced file", ms(now() - eagerStart));
      }),
    ),
  );
}

/** Gate snapshot cost: memo hit vs the re-evaluation a watcher batch forces today. */
async function gatesScenario(runtime: BenchRuntime, repo: string, file: string) {
  bench("activeServersForPath (memo hit)", () =>
    runtime.runPromise(activeServersForPath(file, repo)));
  bench("activeServersForPath (after watcher batch)", () =>
    runtime.runPromise(
      Effect.gen(function* invalidated() {
        const servers = yield* LanguageServers;
        yield* servers.notifyWatchedFiles(
          repo,
          [{ path: "src/churn.ts", renamed: false }],
          () => true,
        );
        return yield* activeServersForPath(file, repo);
      }),
    ));
  await run();
}

/**
 * The relativize micro decision: canonicalizing every location via realpathSync vs the pure prefix
 * relativize, over real repo paths, so the syscall cost per references result is a number.
 */
async function realpathScenario(repo: string) {
  const sampled = await listFiles(repo, "", 2000);
  const paths = sampled.map((path) => join(repo, path));
  report("paths sampled", String(paths.length));
  bench("realpathSync per location", () => {
    for (const path of paths) {
      try {
        realpathSync(path);
      } catch {
        /* A vanished path falls back to the raw string; its cost is not what this measures */
      }
    }
  });
  bench("prefix relativize per location", () => {
    for (const path of paths) {
      relativize(path, repo);
    }
  });
  await run();
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  if (args?.repo === undefined) {
    console.error(USAGE);
    process.exit(1);
  }
  const { docs, position, repo, runs, scenario } = args;
  const runtime = makeRuntime();
  const stalls = monitorEventLoopDelay({ resolution: 10 });
  stalls.enable();
  const wallStart = now();

  if (scenario === "realpath") {
    await realpathScenario(repo);
  } else if (scenario === "diagnostics") {
    await diagnosticsScenario(runtime, repo, docs);
  } else if (scenario === "cold-loop") {
    await coldLoopScenario(runtime, repo, docs);
  } else {
    const { file } = args;
    if (file === undefined) {
      console.error(USAGE);
      process.exit(1);
    }
    if (scenario === "cold") {
      await coldScenario(runtime, repo, file, position);
    } else if (scenario === "references") {
      await referencesScenario(runtime, repo, file, position);
    } else if (scenario === "churn") {
      await churnScenario(runtime, repo, file, position, runs);
    } else if (scenario === "contention") {
      await contentionScenario(runtime, repo, file, position, runs, docs);
    } else if (scenario === "contention-run") {
      await contentionRunScenario(runtime, repo, file, position, docs);
    } else if (scenario === "references-open") {
      await referencesOpenScenario(runtime, repo, file, position);
    } else if (scenario === "gates") {
      await gatesScenario(runtime, repo, file);
    } else {
      console.error(USAGE);
      process.exit(1);
    }
  }

  report("scenario wall clock", ms(now() - wallStart));
  stalls.disable();
  report(
    "event-loop stalls (mean/p99/max)",
    `${ms(stalls.mean / 1e6)} / ${ms(stalls.percentile(99) / 1e6)} / ${ms(stalls.max / 1e6)}`,
  );
  await runtime.dispose();
  process.exit(0);
}

await main();
