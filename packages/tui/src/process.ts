import { existsSync } from "node:fs";

import { Context, Effect, Layer } from "effect";

import { CommandError } from "@/command-error";
import { stripGitEnv } from "@/utils/env";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stdoutBytes: Uint8Array;
  stderr: string;
}

interface RunOptions {
  allowedExitCodes?: readonly number[];
  stdin?: string;
}

const renderCommand = (command: readonly string[]) =>
  command
    .map((part) => (part.includes(" ") ? JSON.stringify(part) : part))
    .join(" ");

export class Process extends Context.Service<
  Process,
  {
    readonly run: (
      command: readonly string[],
      cwd: string,
      options?: RunOptions
    ) => Effect.Effect<CommandResult, CommandError>;
  }
>()("stet/Process") {}

export const ProcessLive = Layer.succeed(Process)({
  // The release runs on interruption and failure, so the child is killed when a
  // Fiber is interrupted (e.g. a newer poll or a worktree switch) without any
  // Manual AbortController bookkeeping.
  run: (command, cwd, options) =>
    Effect.acquireUseRelease(
      // Bun.spawn throws synchronously when the executable is missing; Effect.try
      // Maps that into the typed CommandError channel instead of an escaping defect.
      Effect.try({
        catch: (cause) =>
          new CommandError({
            command,
            exitCode: -1,
            message: cause instanceof Error ? cause.message : String(cause),
            stderr: "",
            stdout: "",
          }),
        try: () => {
          // A deleted worktree leaves repoRoot pointing at a missing dir; Bun.spawn
          // Would surface a raw "ENOENT ... posix_spawn". Fail with a clear message
          // So callers (and the deletion detector) see the cause, not the syscall.
          if (!existsSync(cwd)) {
            throw new Error(`working directory no longer exists: ${cwd}`);
          }

          return Bun.spawn({
            cmd: [...command],
            cwd,
            // No git child may take .git/index.lock, or an agent's concurrent
            // `git commit` fails on it. GIT_OPTIONAL_LOCKS=0 covers `git status`, but
            // `git diff` refreshes the index after any stat-only change regardless of
            // it (refresh_index_quietly), so diff.autoRefreshIndex=false turns that off;
            // `assembleChanged` drops the stat-only entries it then reports. GIT_CONFIG_*
            // needs git 2.31, the floor `--path-format` already sets. Non-git children
            // ignore these. `stripGitEnv` drops any inherited GIT_DIR/GIT_WORK_TREE/etc
            // (e.g. from a launching shell or git hook), so cwd always governs repo
            // discovery.
            env: {
              ...stripGitEnv(Bun.env),
              GIT_CONFIG_COUNT: "1",
              GIT_CONFIG_KEY_0: "diff.autoRefreshIndex",
              GIT_CONFIG_VALUE_0: "false",
              GIT_OPTIONAL_LOCKS: "0",
            },
            stderr: "pipe",
            stdin:
              options?.stdin === undefined
                ? undefined
                : new Blob([options.stdin]),
            stdout: "pipe",
          });
        },
      }),
      (child) =>
        Effect.tryPromise({
          catch: (cause) =>
            new CommandError({
              command,
              exitCode: -1,
              message: cause instanceof Error ? cause.message : String(cause),
              stderr: "",
              stdout: "",
            }),
          try: async (signal) => {
            signal.addEventListener(
              "abort",
              () => {
                child.kill();
              },
              { once: true }
            );

            // ArrayBuffer() + an explicit Uint8Array view, never `.bytes()`: Bun
            // 1.3.14's runtime returns an ArrayBuffer from `bytes()` on a stream
            // (despite the Uint8Array typing, and unlike `bun test`, whose
            // Spec-correct Response masks it), which silently breaks every
            // Byte-level consumer downstream.
            return await Promise.all([
              new Response(child.stdout).arrayBuffer(),
              new Response(child.stderr).text(),
              child.exited,
            ]);
          },
        }).pipe(
          // Decode stdout for string consumers, but keep the raw bytes so
          // Byte-level consumers (git-show binary guards, the search column
          // Parse) never trust a lossy decode.
          Effect.flatMap(([stdoutBuffer, stderr, exitCode]) => {
            const stdoutBytes = new Uint8Array(stdoutBuffer);
            const stdout = new TextDecoder().decode(stdoutBytes);

            if ((options?.allowedExitCodes ?? [0]).includes(exitCode)) {
              return Effect.succeed({ exitCode, stderr, stdout, stdoutBytes });
            }

            const detail = stderr.trim() || stdout.trim();

            return Effect.fail(
              new CommandError({
                command,
                exitCode,
                message: `${renderCommand(command)} failed with exit ${exitCode}${detail === "" ? "" : `\n${detail}`}`,
                stderr,
                stdout,
              })
            );
          })
        ),
      (child) =>
        Effect.sync(() => {
          if (!child.killed) {
            child.kill();
          }
        })
    ),
});
