// GIT_DIR/GIT_WORK_TREE/etc. override cwd-based repo discovery for any child process that
// Inherits them (e.g. from an enclosing git hook), silently redirecting a git invocation meant
// For one repo onto another. Stripping the whole GIT_* family, not just the known-dangerous
// Names, means this doesn't depend on enumerating every git env var that exists today or later.
export function stripGitEnv(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}
