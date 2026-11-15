import { expect, test } from "bun:test";
import path from "node:path";

const PACKAGE_DIR = path.resolve(import.meta.dir, "..");
const SHUTDOWN_MODULE = path.join(PACKAGE_DIR, "src", "shutdown.ts");

/**
 * A real renderer on the child's own stdout (a pipe), kept alive the way the git poll keeps stet
 * alive. The parent then closes its end of the pipe, which fails the child's output with no signal
 * involved, so only the output watcher can end the process.
 */
const childScript = `
import { createCliRenderer } from "@opentui/core";
import { exitOnOutputFailure } from ${JSON.stringify(SHUTDOWN_MODULE)};

const renderer = await createCliRenderer({ exitSignals: [], exitOnCtrlC: false });
void exitOnOutputFailure(renderer);
setInterval(() => renderer.requestRender(), 50);
process.stderr.write("ready\\n");
`;

test("a renderer whose output fails takes the process down instead of leaving it headless", async () => {
  const child = Bun.spawn(["bun", "-e", childScript], {
    cwd: PACKAGE_DIR,
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    let stderr = "";

    for await (const chunk of child.stderr) {
      stderr += new TextDecoder().decode(chunk);

      if (stderr.includes("ready")) {
        break;
      }
    }

    expect(stderr).toContain("ready");

    await child.stdout.cancel();

    const outcome = await Promise.race([
      child.exited,
      Bun.sleep(4000).then(() => "still running"),
    ]);

    expect(outcome).toBe(1);
  } finally {
    child.kill(9);
  }
}, 15_000);

/**
 * The same kept-alive renderer, with stet's signal handlers installed and its output discarded, so
 * only a signal can end the process.
 */
const signalChildScript = `
import { createCliRenderer } from "@opentui/core";
import { exitOnSignals } from ${JSON.stringify(SHUTDOWN_MODULE)};

const pending = createCliRenderer({ exitSignals: [], exitOnCtrlC: false });
exitOnSignals(pending);
const renderer = await pending;
setInterval(() => renderer.requestRender(), 50);
process.stderr.write("ready\\n");
`;

test("a signal exits stet with the shell's 128 + signal number", async () => {
  const child = Bun.spawn(["bun", "-e", signalChildScript], {
    cwd: PACKAGE_DIR,
    stderr: "pipe",
    stdout: "ignore",
  });

  try {
    let stderr = "";

    for await (const chunk of child.stderr) {
      stderr += new TextDecoder().decode(chunk);

      if (stderr.includes("ready")) {
        break;
      }
    }

    expect(stderr).toContain("ready");

    child.kill("SIGTERM");

    const outcome = await Promise.race([
      child.exited,
      Bun.sleep(4000).then(() => "still running"),
    ]);

    expect(outcome).toBe(143);
    expect(child.signalCode).toBeNull();
  } finally {
    child.kill(9);
  }
}, 15_000);

/**
 * The child signals itself while `createCliRenderer` is still setting up, the window in which the
 * renderer has taken over the terminal but has not resolved yet.
 */
const setupSignalChildScript = `
import { createCliRenderer } from "@opentui/core";
import { exitOnSignals } from ${JSON.stringify(SHUTDOWN_MODULE)};

const pending = createCliRenderer({ exitSignals: [], exitOnCtrlC: false });
exitOnSignals(pending);
process.kill(process.pid, "SIGTERM");
const renderer = await pending;
setInterval(() => renderer.requestRender(), 50);
`;

test("a signal during renderer setup still exits through stet's handler", async () => {
  const child = Bun.spawn(["bun", "-e", setupSignalChildScript], {
    cwd: PACKAGE_DIR,
    stderr: "ignore",
    stdout: "ignore",
  });

  try {
    const outcome = await Promise.race([
      child.exited,
      Bun.sleep(4000).then(() => "still running"),
    ]);

    expect(outcome).toBe(143);
    expect(child.signalCode).toBeNull();
  } finally {
    child.kill(9);
  }
}, 15_000);
