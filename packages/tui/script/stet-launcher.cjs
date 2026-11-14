#!/usr/bin/env node
/// <reference types="node" />

// Npm launcher: resolves the platform-specific stet binary package and execs it.
// Pattern from opencode's bin launcher (anomalyco/opencode packages/opencode/bin/opencode).

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];

/** @param {string} target path of the platform binary to exec */
const run = (target) => {
  const child = childProcess.spawn(target, process.argv.slice(2), {
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  for (const signal of forwardedSignals) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        // The child may have already exited
      }
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
};

const packageName = `stet-${os.platform()}-${os.arch()}`;

/**
 * Walks up from `dir` through each ancestor's `node_modules`, the way Node resolves a package.
 * @param {string} dir directory to start the search from
 * @returns {string | undefined} the binary's path, or undefined when no ancestor has it
 */
const findBinary = (dir) => {
  const candidate = path.join(dir, "node_modules", packageName, "bin", "stet");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const parent = path.dirname(dir);
  return parent === dir ? undefined : findBinary(parent);
};

const fromEnv = process.env.STET_BIN_PATH;
const resolved =
  fromEnv !== undefined && fromEnv !== "" ? fromEnv : findBinary(__dirname);

if (resolved === undefined) {
  console.error(
    `Could not find the stet binary for your platform. Your package manager may have skipped optional dependencies; try reinstalling, or install "${packageName}" directly. Supported platforms: darwin/linux on arm64/x64.`
  );
  process.exit(1);
}

run(resolved);
