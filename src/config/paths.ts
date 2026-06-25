import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The global config path: `$XDG_CONFIG_HOME/sideye/config.json`, falling back to
 * `~/.config/sideye/config.json`. `env` is injected so tests can pin it without touching the real
 * environment; the service passes `process.env`.
 */
export function configPath(env: NodeJS.ProcessEnv = process.env) {
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "sideye", "config.json");
}
