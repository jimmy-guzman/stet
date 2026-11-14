import { Context, Effect, Layer, Schedule } from "effect";
import { constVoid } from "effect/Function";

import type { DiffScope } from "@/cli";
import type { CommandError } from "@/command-error";
import { Process } from "@/process";

import { GitError } from "./errors";
import {
  buildFilePatch,
  classifySideBytes,
  fileDiffSides,
  readWorktreeSide,
  sideMeta,
} from "./file-patch";
import type {
  BinaryDiff,
  FilePatch,
  PatchSide,
  SideContent,
} from "./file-patch";
import { logArgs, parseLog } from "./log";
import type { Commit } from "./log";
import {
  assembleChanged,
  assembleModel,
  diffArgs,
  nameStatusArgs,
  numstatArgs,
  parseRepoFiles,
  untrackedDiffArgs,
} from "./model";
import type { ChangedFile, GitModel } from "./model";
import {
  bareCheckArgs,
  classifyRepoFailure,
  classifyRepoOutput,
  isMissingGit,
  isRevisionRange,
  parseRepoContext,
  refTreeArgs,
  repoContextArgs,
  repoFailureMessage,
} from "./repo";
import type { RepoContext } from "./repo";
import { parseSearchOutput, searchArgs } from "./search";
import type { SearchMatch, SearchOptions } from "./search";
import {
  commitTimeArgs,
  parseCommitTimes,
  parseWorktreeList,
  summarizeWorktree,
  worktreeStatusArgs,
} from "./worktree";
import type { Worktree, WorktreeSummary } from "./worktree";

const toGitError = (error: CommandError) =>
  new GitError({ message: error.message });

const isTransientGit = (error: CommandError) =>
  // An index.lock (an agent mid-commit) clears on a quick retry
  /index\.lock|unable to create/iu.test(error.stderr);

const retryTransient = <A>(effect: Effect.Effect<A, CommandError>) =>
  effect.pipe(
    Effect.retry({
      schedule: Schedule.spaced("50 millis"),
      times: 2,
      while: isTransientGit,
    })
  );

export class Git extends Context.Service<
  Git,
  {
    /**
     * Both sides' size and image dimensions for a binary changed file, so the viewer can render a
     * metadata placeholder in place of the diff stet cannot draw. Reuses the same side reads as
     * `fileDiff`; a side is absent when it is the empty side of an add or delete.
     */
    readonly binaryMeta: (
      repoRoot: string,
      scope: DiffScope,
      file: ChangedFile
    ) => Effect.Effect<BinaryDiff, GitError>;
    readonly changedFiles: (
      repoRoot: string,
      scope: DiffScope
    ) => Effect.Effect<
      Pick<GitModel, "changed" | "changedByPath" | "scopeKey" | "branch">,
      GitError
    >;
    readonly fileDiff: (
      repoRoot: string,
      scope: DiffScope,
      file: ChangedFile
    ) => Effect.Effect<string, GitError>;
    /**
     * The full text of the side an expanded gap reveals (the new side, or the old side for a
     * deletion). Loaded lazily on the first gap expansion in a file, never on the diff hot path.
     */
    readonly fileSource: (
      repoRoot: string,
      scope: DiffScope,
      file: ChangedFile
    ) => Effect.Effect<SideContent, GitError>;
    readonly gitDir: (repoRoot: string) => Effect.Effect<string, GitError>;
    /** The SHA HEAD points at, or `undefined` on a commitless repo (an unborn HEAD). */
    readonly headRef: (
      repoRoot: string
    ) => Effect.Effect<string | undefined, GitError>;
    readonly loadModel: (
      repoRoot: string,
      scope: DiffScope
    ) => Effect.Effect<GitModel, GitError>;
    /** HEAD's parent SHA, or `undefined` on a root commit. */
    readonly parentRef: (
      repoRoot: string
    ) => Effect.Effect<string | undefined, GitError>;
    /** The most recent commits (newest first), capped at `limit`. */
    readonly recentCommits: (
      repoRoot: string,
      limit: number
    ) => Effect.Effect<Commit[], GitError>;
    /**
     * Whether a ref is a side `git diff` can take. Asked only to explain a diff that already failed
     * (so an unknown ref is named rather than dumped), never as a gate before one runs; it answers
     * `true` when it cannot tell, so it can only ever add an explanation, never withhold a launch.
     */
    readonly refIsDiffable: (
      repoRoot: string,
      ref: string
    ) => Effect.Effect<boolean>;
    /**
     * The repository stet was launched in, or a `GitError` whose message is the one line to print.
     * Runs before the renderer, so its failure never reaches the alt screen.
     */
    readonly repoContext: (cwd: string) => Effect.Effect<RepoContext, GitError>;
    readonly repoFiles: (
      repoRoot: string
    ) => Effect.Effect<Pick<GitModel, "repoFiles" | "repoFilesKey">, GitError>;
    readonly search: (
      repoRoot: string,
      query: string,
      paths: readonly string[] | undefined,
      options: SearchOptions
    ) => Effect.Effect<SearchMatch[], GitError>;
    readonly worktrees: (
      repoRoot: string
    ) => Effect.Effect<Worktree[], GitError>;
    /**
     * When each of the given worktrees was last touched, by an agent or by git. A worktree that
     * cannot be read (a pruned one whose directory is gone) is omitted rather than failing the
     * batch, so one dead worktree never costs the caller the live ones.
     */
    readonly worktreeSummaries: (
      worktrees: readonly Worktree[],
      repoRoot: string
    ) => Effect.Effect<WorktreeSummary[]>;
  }
>()("stet/Git") {}

export const GitLive = Layer.effect(
  Git,
  Effect.gen(function* gitLive() {
    const process = yield* Process;

    // No retryTransient on `git show`: a bad spec (submodule gitlink, ref gone
    // Mid-flight) should fail fast into the fallback, not retry.
    const fetchSide = (
      repoRoot: string,
      side: PatchSide,
      worktreePath: string
    ): Effect.Effect<SideContent, CommandError> => {
      if (side.kind === "git") {
        return process
          .run(["git", "show", side.spec], repoRoot)
          .pipe(Effect.map((result) => classifySideBytes(result.stdoutBytes)));
      }

      if (side.kind === "worktree") {
        return Effect.promise(
          async () => await readWorktreeSide(repoRoot, worktreePath)
        );
      }

      return Effect.succeed({ kind: "text", text: "" });
    };

    return {
      binaryMeta: (repoRoot, scope, file) => {
        const { newSide, oldSide } = fileDiffSides(scope, file);

        return Effect.all(
          [
            fetchSide(repoRoot, oldSide, file.path),
            fetchSide(repoRoot, newSide, file.path),
          ],
          { concurrency: "unbounded" }
        ).pipe(
          Effect.map(([oldContent, newContent]) => ({
            newSide: sideMeta(newContent),
            oldSide: sideMeta(oldContent),
          })),
          Effect.mapError(toGitError)
        );
      },
      changedFiles: (repoRoot, scope) =>
        Effect.all(
          [
            process.run(
              ["git", "ls-files", "--others", "--exclude-standard", "-z"],
              repoRoot
            ),
            process.run(nameStatusArgs(scope), repoRoot),
            process.run(numstatArgs(scope), repoRoot),
            process.run(
              ["git", "status", "--porcelain=v1", "-b", "-z"],
              repoRoot
            ),
          ],
          { concurrency: "unbounded" }
        ).pipe(
          retryTransient,
          Effect.map(([untracked, nameStatus, numstat, porcelain]) =>
            assembleChanged(
              repoRoot,
              scope,
              untracked.stdout,
              nameStatus.stdout,
              numstat.stdout,
              porcelain.stdout
            )
          ),
          Effect.mapError(toGitError)
        ),
      // The per-file patch is computed in-process from the scope's two endpoints
      // (blob/worktree reads), never via `git diff <ref> -- <path>`: in very large
      // Repos git's pathspec-limited diff-index walks the whole index (seconds per
      // Invocation, #188), while a blob read stays O(path depth). The pathspec
      // Invocation survives only as the fallback for sides an in-process diff
      // Can't reproduce faithfully (submodules, eol conversion, oversized files).
      fileDiff: (repoRoot, scope, file) => {
        if (file.kind === "untracked") {
          return process
            .run(untrackedDiffArgs(file.path), repoRoot, {
              allowedExitCodes: [0, 1],
            })
            .pipe(
              Effect.map((result) => result.stdout),
              Effect.mapError(toGitError)
            );
        }

        // Numstat already flagged it binary; the render is a model-driven
        // Placeholder, so skip both side fetches.
        if (file.binary) {
          return Effect.succeed("");
        }

        const pathspecDiff = process
          .run(
            [
              ...diffArgs(scope),
              "--",
              ...(file.oldPath === undefined
                ? [file.path]
                : [file.oldPath, file.path]),
            ],
            repoRoot,
            { allowedExitCodes: [0, 1] }
          )
          .pipe(
            Effect.map((result) => result.stdout),
            Effect.mapError(toGitError)
          );

        const { newSide, oldSide } = fileDiffSides(scope, file);

        return Effect.all(
          [
            fetchSide(repoRoot, oldSide, file.path),
            fetchSide(repoRoot, newSide, file.path),
          ],
          { concurrency: "unbounded" }
        ).pipe(
          Effect.map(([oldContent, newContent]) =>
            buildFilePatch(file, oldContent, newContent)
          ),
          // A `git show` failure (submodule gitlink, ref gone mid-flight) falls
          // Back to the pathspec diff; scoped to CommandError so nothing else is
          // Swallowed into a fallback.
          Effect.catchTag("CommandError", () =>
            Effect.succeed<FilePatch>({ kind: "fallback" })
          ),
          Effect.flatMap((built) =>
            built.kind === "patch" ? Effect.succeed(built.patch) : pathspecDiff
          )
        );
      },
      fileSource: (repoRoot, scope, file) => {
        const { newSide, oldSide } = fileDiffSides(scope, file);

        return fetchSide(
          repoRoot,
          file.kind === "deleted" ? oldSide : newSide,
          file.path
        ).pipe(Effect.mapError(toGitError));
      },
      // The per-worktree git dir, absolute. In a linked worktree this resolves
      // Outside the worktree tree (to <main>/.git/worktrees/<name>), so the watcher
      // Watches it as a second root to catch staging/commit/checkout there.
      gitDir: (repoRoot) =>
        process.run(["git", "rev-parse", "--absolute-git-dir"], repoRoot).pipe(
          retryTransient,
          Effect.map((result) => result.stdout.trim()),
          Effect.mapError(toGitError)
        ),
      // Exit 128 is a commitless repo (no HEAD), which reports as `undefined` rather than as a
      // Substituted base: what to diff against instead is the caller's decision, and it needs the
      // Repository's own empty tree, which this service has no reason to know.
      headRef: (repoRoot) =>
        process
          .run(["git", "rev-parse", "--verify", "HEAD"], repoRoot, {
            allowedExitCodes: [0, 128],
          })
          .pipe(
            retryTransient,
            Effect.map((result) => result.stdout.trim() || undefined),
            Effect.mapError(toGitError)
          ),
      loadModel: (repoRoot, scope) =>
        Effect.all(
          [
            process.run(["git", "ls-files", "--stage", "-z"], repoRoot),
            process.run(
              ["git", "ls-files", "--others", "--exclude-standard", "-z"],
              repoRoot
            ),
            process.run(nameStatusArgs(scope), repoRoot),
            process.run(numstatArgs(scope), repoRoot),
            process.run(
              ["git", "status", "--porcelain=v1", "-b", "-z"],
              repoRoot
            ),
          ],
          { concurrency: "unbounded" }
        ).pipe(
          retryTransient,
          Effect.map(([tracked, untracked, nameStatus, numstat, porcelain]) =>
            assembleModel(
              repoRoot,
              scope,
              tracked.stdout,
              untracked.stdout,
              nameStatus.stdout,
              numstat.stdout,
              porcelain.stdout
            )
          ),
          Effect.mapError(toGitError)
        ),
      // Exit 128 is a root commit (no HEAD~1), reported as `undefined` for the same reason an
      // Unborn HEAD is: the empty tree that makes the first commit render as all-added is the
      // Repository's, so the caller substitutes it.
      parentRef: (repoRoot) =>
        process
          .run(["git", "rev-parse", "--verify", "HEAD~1"], repoRoot, {
            allowedExitCodes: [0, 128],
          })
          .pipe(
            retryTransient,
            Effect.map((result) => result.stdout.trim() || undefined),
            Effect.mapError(toGitError)
          ),
      // Exit 128 is a commitless repo (unborn HEAD): `git log` has no output, so
      // Allow it and parse the empty stdout to an empty list, letting the picker
      // Show its empty state instead of a failure notice (same as parentRef).
      recentCommits: (repoRoot, limit) =>
        process
          .run(logArgs(limit), repoRoot, { allowedExitCodes: [0, 128] })
          .pipe(
            retryTransient,
            Effect.map((result) => parseLog(result.stdout)),
            Effect.mapError(toGitError)
          ),
      // Only ever asked about a diff that already failed, so every way of not resolving is one
      // Answer: git rejects an unresolvable ref with exit 1 and a syntactically valid one it cannot
      // Evaluate (`HEAD@{500}`) with 128, and neither is a failure of this question.
      refIsDiffable: (repoRoot, ref) =>
        isRevisionRange(ref)
          ? Effect.succeed(true)
          : process
              .run(refTreeArgs(ref), repoRoot, {
                allowedExitCodes: [0, 1, 128],
              })
              .pipe(
                Effect.map((result) => result.exitCode === 0),
                Effect.orElseSucceed(() => true)
              ),
      // The startup preflight: every way git can refuse to answer becomes one actionable line,
      // Since this is the failure the user meets before stet has any UI to report it in. Never widen
      // A message to quote the invocation (only `other` repeats git, and only its first stderr line).
      repoContext: (cwd) =>
        process.run(repoContextArgs(), cwd).pipe(
          Effect.catchTag("CommandError", (commandError) =>
            // Otherwise git's stderr is translated, so the bare-vs-absent question is asked with a
            // Second command whose exit code answers it in every locale.
            (isMissingGit(commandError)
              ? Effect.succeed("missing-git" as const)
              : process
                  .run(bareCheckArgs(), cwd, { allowedExitCodes: [0, 128] })
                  .pipe(
                    Effect.map(classifyRepoFailure),
                    Effect.orElseSucceed(() => "other" as const)
                  )
            ).pipe(
              Effect.flatMap((failure) =>
                Effect.fail(
                  new GitError({
                    message: repoFailureMessage(
                      failure,
                      cwd,
                      commandError.stderr
                    ),
                  })
                )
              )
            )
          ),
          // A `rev-parse` that exits 0 can still answer nothing usable: a git too old for
          // `--path-format` echoes the option instead of rejecting it.
          Effect.flatMap((result) => {
            const context = parseRepoContext(result.stdout);

            return context === undefined
              ? Effect.fail(
                  new GitError({
                    message: repoFailureMessage(
                      classifyRepoOutput(result.stdout),
                      cwd,
                      result.stdout
                    ),
                  })
                )
              : Effect.succeed(context);
          })
        ),
      repoFiles: (repoRoot) =>
        Effect.all(
          [
            process.run(["git", "ls-files", "--stage", "-z"], repoRoot),
            process.run(
              ["git", "ls-files", "--others", "--exclude-standard", "-z"],
              repoRoot
            ),
          ],
          { concurrency: "unbounded" }
        ).pipe(
          retryTransient,
          Effect.map(([tracked, untracked]) =>
            parseRepoFiles(repoRoot, tracked.stdout, untracked.stdout)
          ),
          Effect.mapError(toGitError)
        ),
      // Git grep exits 1 when nothing matches, which is a normal empty result.
      search: (repoRoot, query, paths, options) =>
        process
          .run(searchArgs(query, paths, options), repoRoot, {
            allowedExitCodes: [0, 1],
          })
          .pipe(
            retryTransient,
            // Bytes, not the decoded stdout: the parse converts git's byte columns
            // Against the raw line, immune to replacement-char width drift.
            Effect.map((result) => parseSearchOutput(result.stdoutBytes)),
            Effect.mapError(toGitError)
          ),
      // Every worktree's HEAD resolves against the one shared object database, so their commit times
      // Come back in a single call rather than one per worktree. It is the portable floor under the
      // Reflog mtime (a repository can have reflogs turned off), so a failure here is not fatal.
      worktreeSummaries: (worktrees, repoRoot) => {
        const heads = worktrees
          .map((worktree) => worktree.head)
          .filter((head) => head !== "");

        const commitTimes =
          heads.length === 0
            ? Effect.succeed(new Map<string, number>())
            : process.run(commitTimeArgs(heads), repoRoot).pipe(
                Effect.map((result) => parseCommitTimes(result.stdout)),
                Effect.orElseSucceed(() => new Map<string, number>())
              );

        return commitTimes.pipe(
          Effect.flatMap((times) =>
            Effect.all(
              worktrees.map((worktree) =>
                process.run(worktreeStatusArgs, worktree.path).pipe(
                  retryTransient,
                  Effect.map((result) =>
                    summarizeWorktree(
                      worktree.path,
                      result.stdout,
                      times.get(worktree.head)
                    )
                  ),
                  Effect.orElseSucceed(constVoid)
                )
              ),
              { concurrency: "unbounded" }
            )
          ),
          Effect.map((summaries) =>
            summaries.filter((summary) => summary !== undefined)
          )
        );
      },
      worktrees: (repoRoot) =>
        process
          .run(["git", "worktree", "list", "--porcelain", "-z"], repoRoot)
          .pipe(
            retryTransient,
            Effect.map((result) => parseWorktreeList(result.stdout)),
            Effect.mapError(toGitError)
          ),
    };
  })
);
