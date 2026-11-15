import { constants } from "node:os";

import type { CliRenderer } from "@opentui/core";

import type { LogLevel } from "./log/levels";
import { log } from "./log/terminal";

/**
 * Renderers whose shutdown stet started, so `exitOnOutputFailure` can tell a close stet asked for
 * from the renderer giving up on its own. Keyed per renderer rather than a module flag, so a test
 * renderer never carries the mark into the next test.
 */
const shuttingDown = new WeakSet<CliRenderer>();

/**
 * The one way stet exits once the renderer is up: the keyboard quit, the worktree-recovery exit, and
 * the signal and crash backstops all route here. `destroy()` returns at once but restores the
 * terminal asynchronously, and `closed` resolves once the restore has been written, so the message
 * waits for it and lands on the restored screen rather than the alt buffer, and the exit cannot cut
 * the restore short. A rejected `closed` (the output failed, or the close ran late) leaves nothing
 * stet can still restore, so it exits the same way. `destroy()` is idempotent, so a backstop that
 * races an exit already in flight is harmless. Destroying the renderer also resets the terminal
 * title.
 *
 * @param renderer The renderer to tear down.
 * @param code The process exit code.
 * @param message A line to print on the restored screen, at its own severity.
 */
export const exitAfterRestore = async (
  renderer: CliRenderer,
  code: number,
  message?: { text: string; level: LogLevel }
) => {
  shuttingDown.add(renderer);
  renderer.destroy();

  await Promise.allSettled([renderer.closed]);

  if (message !== undefined) {
    log(message.level, message.text);
  }

  process.exit(code);
};

/**
 * Exit when the renderer shuts itself down. Since OpenTUI 0.6, an output stream that errors, closes,
 * or finishes makes the renderer destroy itself and reject `closed`, and nothing reaches a signal or
 * crash handler, so without this the git poll keeps a process with no screen alive. A `closed` that
 * rejects after stet started its own shutdown belongs to that shutdown, which is already exiting.
 *
 * @param renderer The renderer whose output to watch.
 */
export const exitOnOutputFailure = async (renderer: CliRenderer) => {
  try {
    await renderer.closed;
  } catch (error) {
    if (shuttingDown.has(renderer)) {
      return;
    }

    await exitAfterRestore(renderer, 1, {
      level: "error",
      text: `terminal output failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};

/**
 * Restore the terminal and exit on the signals OpenTUI's own handlers covered, minus SIGBUS and
 * Windows-only SIGBREAK. In raw mode a keyboard ctrl-c is a keypress the keymap owns, so these fire
 * only on an external kill or a fault, paths that would otherwise leave the alt-screen buffer active
 * and the next launch blank. A real bus error cannot be handled from JS: the faulting access repeats,
 * so a listener spins at full CPU in the alt screen instead of terminating, and SIGBUS is left to
 * crash. Each exits with the shell's 128 + signal number, so a script never reads a killed stet as a
 * success.
 *
 * It takes the renderer still being created, because `createCliRenderer` enters the alt screen
 * before it resolves: handlers registered only after it left a signal during startup to its default
 * action, which skips every restore. A signal that arrives before setup finishes waits for it, then
 * restores the same way; a setup that fails has already torn itself down, so it just exits.
 *
 * @param pending The renderer `createCliRenderer` is still setting up.
 */
export const exitOnSignals = (pending: Promise<CliRenderer>) => {
  const exitWhenReady = async (code: number) => {
    try {
      await exitAfterRestore(await pending, code);
    } catch {
      process.exit(code);
    }
  };

  for (const signal of [
    "SIGINT",
    "SIGTERM",
    "SIGQUIT",
    "SIGABRT",
    "SIGHUP",
    "SIGPIPE",
  ] as const) {
    process.on(signal, () => {
      void exitWhenReady(128 + constants.signals[signal]);
    });
  }
};
