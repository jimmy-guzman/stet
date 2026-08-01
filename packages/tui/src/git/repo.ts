/**
 * Why stet cannot start here. Every branch maps to one actionable line, so a launch outside a
 * repository never prints the internal `rev-parse` invocation and git's raw stderr.
 */
export type RepoFailure = "missing-git" | "not-a-repo" | "bare-repo" | "unsupported-git" | "other";

export interface RepoContext {
  repoRoot: string;
  /**
   * The worktree holding the repository's real `.git`, resolved from the common dir. It lives
   * outside any linked worktree's tree, so it survives that worktree's deletion and is the recovery
   * target when one disappears mid-session.
   */
  mainWorktreePath: string;
}

// One rev-parse yields both paths. `--path-format=absolute` is what makes the common dir absolute;
// `--show-toplevel` is absolute either way.
export function repoContextArgs() {
  return ["git", "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"];
}

/**
 * The repo root and main worktree, or `undefined` when the output is not two absolute paths.
 *
 * A git that predates `--path-format` does not fail on it: `rev-parse` echoes an option it does not
 * recognize back to stdout and exits 0, so an unusable answer arrives as success. Requiring two
 * absolute paths is what catches that, which is why the caller classifies `undefined` rather than
 * trusting the exit code.
 */
export function parseRepoContext(stdout: string): RepoContext | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const repoRoot = lines[0];
  const commonDir = lines[1];
  if (lines.length !== 2 || repoRoot === undefined || commonDir === undefined) {
    return undefined;
  }
  if (!repoRoot.startsWith("/") || !commonDir.startsWith("/")) {
    return undefined;
  }

  const suffix = "/.git";
  return {
    mainWorktreePath: commonDir.endsWith(suffix) ? commonDir.slice(0, -suffix.length) : repoRoot,
    repoRoot,
  };
}

/**
 * Why a `rev-parse` that exited 0 produced no usable answer. An echoed option is the old-git
 * signature (see `parseRepoContext`); anything else is a git whose output stet cannot read.
 */
export function classifyRepoOutput(stdout: string): RepoFailure {
  return stdout.split("\n").some((line) => line.trimStart().startsWith("-"))
    ? "unsupported-git"
    : "other";
}

/**
 * Why a `rev-parse` failed. `Bun.spawn` throws before there is an exit code when the executable is
 * missing, which `Process` reports as exit `-1`, so that is the missing-git signal.
 */
export function classifyRepoFailure(error: { exitCode: number; stderr: string; message: string }) {
  if (error.exitCode === -1) {
    return /not found|ENOENT|no such file/i.test(error.message) ? "missing-git" : "other";
  }
  if (/not a git repository/i.test(error.stderr)) {
    return "not-a-repo";
  }
  // Also what git says from inside `.git` itself, where there is likewise no working tree to read.
  return /must be run in a work tree/i.test(error.stderr) ? "bare-repo" : "other";
}

/**
 * The line the user sees. `detail` is git's own stderr, used only by `other`, where stet has
 * nothing better to say than what git said.
 */
export function repoFailureMessage(failure: RepoFailure, cwd: string, detail: string) {
  if (failure === "missing-git") {
    return "git is not installed, or not on PATH";
  }
  if (failure === "not-a-repo") {
    return `not a git repository: ${cwd}`;
  }
  if (failure === "bare-repo") {
    return `no git working tree at ${cwd}`;
  }
  if (failure === "unsupported-git") {
    // Name the option git rejected rather than a minimum version: stet's floor is whatever the
    // Oldest of its invocations needs, and only this one has proven itself.
    return 'this git is too old for stet: it does not support "git rev-parse --path-format"';
  }

  const first = detail.trim().split("\n")[0] ?? "";
  return first === ""
    ? `could not read the git repository at ${cwd}`
    : `could not read the git repository at ${cwd}: ${first}`;
}

export function unknownRefMessage(ref: string) {
  return `unknown git ref: ${ref}`;
}

// --quiet drops the "Needed a single revision" noise and turns an unresolvable ref into a plain
// Exit 1, so an unknown ref is told apart from a broken repository by the exit code alone.
export function verifyRefArgs(ref: string) {
  return ["git", "rev-parse", "--verify", "--quiet", "--end-of-options", ref];
}
