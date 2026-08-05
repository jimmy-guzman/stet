import { realpathSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { Effect, Layer, ManagedRuntime } from "effect";
import { bench, run } from "mitata";

import { LspProcessLive } from "@/diagnostics/lsp-process";
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
import { defaultFileSupportRegistry, registerFileSupport } from "@/file-support/registry";
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
const USAGE = `usage: bun run bench:intel <cold|references|churn|contention|gates|realpath>
  --repo <abs-path>   repository to benchmark against (required)
  --file <rel-path>   file to pull intel on (required except realpath)
  --pos <line:col>    1-based caret for definition/references pulls
  --runs <n>          pulls per scenario (default 5)
  --docs <n>          held-open documents for contention (default 50)`;

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
  const pos = /^(?<line>\d+):(?<column>\d+)$/.exec(flags.get("pos") ?? "");
  return {
    docs: Number(flags.get("docs") ?? 50),
    file: flags.get("file"),
    position:
      pos?.groups === undefined
        ? { character: 0, line: 0 }
        : { character: Number(pos.groups.column) - 1, line: Number(pos.groups.line) - 1 },
    repo: flags.get("repo"),
    runs: Number(flags.get("runs") ?? 5),
    scenario,
  };
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
    IntelLive.pipe(
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
  clearInterval(tick);
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
