import { homedir } from "node:os";
import path from "node:path";

/**
 * Config path candidates in priority order (`config.jsonc`, then `config.json`); the service reads
 * the first that exists. `env` is injected so tests can pin it without touching the real
 * environment.
 */
export const configPaths = (env: NodeJS.ProcessEnv = process.env) => {
  const base = env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");

  return [
    path.join(base, "stet", "config.jsonc"),
    path.join(base, "stet", "config.json"),
  ];
};

/** The directory user themes are read from: Zed theme files, one or more themes each. */
export const themesDir = (env: NodeJS.ProcessEnv = process.env) =>
  path.join(
    env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "stet",
    "themes"
  );
