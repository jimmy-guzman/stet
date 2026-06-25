import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The global config candidates, in priority order: `config.jsonc` then `config.json` (both parsed
 * as JSONC) under `$XDG_CONFIG_HOME/sideye/`, falling back to `~/.config/sideye/`. The service
 * reads the first that exists. `env` is injected so tests can pin it without touching the real
 * environment; the service passes `process.env`.
 */
export function configPaths(env: NodeJS.ProcessEnv = process.env) {
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return [join(base, "sideye", "config.jsonc"), join(base, "sideye", "config.json")];
}
