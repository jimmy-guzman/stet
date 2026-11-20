import { homedir } from "node:os";
import path from "node:path";

/** `$XDG_CONFIG_HOME/stet`, else `~/.config/stet`: the one base the config file and themes share. */
const stetConfigDir = (env: NodeJS.ProcessEnv) =>
  path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "stet");

/**
 * Config path candidates in priority order (`config.jsonc`, then `config.json`); the service reads
 * the first that exists. `env` is injected so tests can pin it without touching the real
 * environment.
 */
export const configPaths = (env: NodeJS.ProcessEnv = process.env) => [
  path.join(stetConfigDir(env), "config.jsonc"),
  path.join(stetConfigDir(env), "config.json"),
];

/** The directory user themes are read from: Zed theme files, one or more themes each. */
export const themesDir = (env: NodeJS.ProcessEnv = process.env) =>
  path.join(stetConfigDir(env), "themes");
