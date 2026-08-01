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
 * Whether git spawned at all. `Bun.spawn` throws before there is an exit code when the executable
 * is missing, and `Process` reports that as exit `-1` with its own (untranslated) message, so this
 * is the one classification that can read text safely.
 */
export function isMissingGit(error: { exitCode: number; message: string }) {
  return error.exitCode === -1 && /not found|ENOENT|no such file/i.test(error.message);
}

/**
 * The follow-up that separates "no repository here" from "a repository with no working tree here",
 * asked only once the context read has already failed.
 *
 * Git's stderr cannot answer this: it is translated, so matching `not a git repository` classifies
 * an English user and silently drops every other one into the unclassified branch. An exit code and
 * a `true`/`false` are the same in every locale.
 */
export function bareCheckArgs() {
  return ["git", "rev-parse", "--is-bare-repository"];
}

/**
 * Why the repository could not be read, from the bare check's outcome. Exiting non-zero means git
 * found no repository at all; exiting cleanly means it found one whose working tree is not here,
 * which covers both a bare repository and the inside of a `.git` directory.
 */
export function classifyRepoFailure(bareCheck: { exitCode: number }): RepoFailure {
  return bareCheck.exitCode === 0 ? "bare-repo" : "not-a-repo";
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

/**
 * Whether a ref is a side `git diff` can take, asked **only to explain a diff that already
 * failed**, never as a gate before one runs.
 *
 * Asked as a gate it is wrong in both directions: `rev-parse --verify` accepts any object, so a
 * blob sha passes and the diff then dies with git's usage block, while a revision range
 * (`main...HEAD`) and an unborn `HEAD` are rejected even though `git diff` takes them. Only the
 * diff knows what the diff accepts, so it runs first and this names the argument afterwards.
 * `^{tree}` is what rejects a blob; `--quiet` drops the "Needed a single revision" noise.
 */
export function refTreeArgs(ref: string) {
  return ["git", "rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{tree}`];
}

/**
 * A revision range (`a..b`, `a...b`), which `git diff` takes as a whole and `rev-parse --verify`
 * cannot resolve. It is exempt from the tree check rather than failing it, so a range is never
 * accused of being the reason a diff failed.
 */
export function isRevisionRange(ref: string) {
  return ref.includes("..");
}
