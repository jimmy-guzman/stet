---
name: deep-pr-review
description: Deep, evidence-based review of a GitHub pull request or local diff. Reproduce the change empirically, fan out parallel reviewers across dimensions, adversarially verify findings against the code, then post a pending GitHub review with inline committable suggestions. Use when asked to deeply or thoroughly review a PR, audit a diff, do a careful code review, or leave inline review comments.
metadata:
  version: "1.0"
---

# Deep PR review

A method for reviewing a pull request (or a local branch diff) thoroughly enough to trust
the verdict: reproduce behavior instead of reasoning about it, get independent perspectives,
verify every load-bearing claim against the code, and deliver findings as inline review
comments the author can apply.

## When to use

Use for a deep or thorough review of a PR or branch diff, an audit, or any request to write
careful inline review comments. Not for a quick lint pass or a one-line sanity check, where
the fan-out and verification overhead is not worth it.

## Workflow

Work the steps in order. Each one feeds the next.

1. **Scope the diff.** Get the head commit and the full change set: `gh pr view <n> --json
   number,headRefName,headRefOid,state`, `gh pr diff <n>`, or for a local branch
   `git diff <base>...HEAD --stat` then per file. Note which files are actually in the diff;
   you can only anchor inline comments on those lines (see Gotchas).

2. **Review the committed state, not your working tree.** If you have uncommitted local
   edits (for example fixes you drafted while exploring), read the code under review with
   `git show <head>:<path>` so you review what the PR contains, not your local changes. Line
   numbers for comment anchors must come from the committed file.

3. **Reproduce before reasoning.** Do not conclude a bug or a pass from reading alone. Run
   the app, the tests, or the specific path; check the env vars and config that gate the
   behavior. A reported "X does not work" is often resolution or configuration, not a code
   bug. Confirm the actual trigger empirically before writing it up. See Gotchas for tracing
   stray external calls.

4. **Fan out parallel reviewers.** Launch independent reviewers (Agent tool) across distinct
   dimensions in a single batch so they run concurrently. A good default split:
   - correctness and edge cases in the core logic,
   - tests (coverage gaps, behavior-vs-implementation, missing real-behavior tests),
   - architecture, lifecycle, and docs (convention violations, subprocess/resource handling,
     README and inline-doc accuracy).
   Give each reviewer the diff, the head commit to read against, the project's own
   conventions file (for example `AGENTS.md`/`CONTRIBUTING`), and any findings already known
   so they do not re-report them.

5. **Dedup and adversarially verify.** Merge overlapping findings. When reviewers disagree,
   or when a finding is load-bearing or surprising, read the code yourself and decide. Treat
   reviewer output as claims to check, not conclusions. Drop contrived edge cases the code
   never promises to handle and findings argued by ROI ("low value", "not worth it"); keep
   only what is correct and real. Assign a severity to each survivor.

6. **Deliver as a pending review.** Post the survivors as inline comments on a pending GitHub
   review (one comment per finding, anchored to the relevant changed line), using the comment
   template below. Keep the review pending so the author reads, edits, and submits it; do not
   submit unless asked. For the exact `gh` API commands, read
   `references/github-review-api.md`.

## Gotchas

- **Self-PR submission.** GitHub allows only `event=COMMENT` when you review your own PR;
  `APPROVE` and `REQUEST_CHANGES` are rejected.
- **Anchor only on diff lines.** An inline comment must target a line that is part of the PR
  diff. A file the PR did not change cannot take an inline comment. When the root cause lives
  in an unchanged file, anchor the comment on the changed line that triggers it and describe
  the unchanged-file fix in the body.
- **Pending comments are fixed at creation.** A pending review's inline comments are set when
  the review is created. To add, remove, or reword one, delete the review and recreate it
  with the full set. The comment count in the create response reflects the review body, not
  the inline comments; list them via the comments endpoint to confirm they landed.
- **Tracing a stray external call.** When something spawns an unexpected subprocess (a test
  that launches a real binary, a path that shells out), shadow that binary on `PATH` with a
  logging stub that records its argv and `exit 0`, run the suite one unit at a time with
  stdin from `/dev/null`, and see which run wrote to the log. Per-unit timing also localizes
  a hang or slowdown to a single file.
- **Env neutralization has limits.** Setting an env var to a harmless value only changes
  behavior if the code reads that env var at the call site. Defaults baked into application
  state, signals, or constants ignore the env, so the env trick silently does nothing there;
  use the PATH stub instead.

## Comment template

Author each inline comment in this shape (it renders cleanly and the author can apply the
fix directly):

```markdown
_<severity header>_

**<one-line title of the problem>.**

<root cause: what the code does, why it is wrong, and the user-visible effect>

```suggestion
<the corrected line(s), only when the fix is self-contained on the anchored line(s)>
```

> [!NOTE]
> <the broader or deferred fix, or a caveat the committable suggestion does not cover>
```

Include the `suggestion` block only when the replacement is complete on the line(s) you
anchored to (a fix that needs a new import or helper elsewhere is not committable inline, so
describe it in prose instead). Drop the `[!NOTE]` when there is nothing broader to say.

## Severity labels

Lead each comment with a severity so the author can triage:

- `⚠️ Potential issue | 🔴 Critical` - breaks a core path or ships a real bug.
- `🛠️ Refactor suggestion | 🟠 Major` - significant correctness, testability, or structure
  problem that should be addressed.
- `⚠️ Potential issue | 🟡 Minor` - a real but small robustness or correctness gap.
- `📝 Nitpick` - docs, naming, or a low-impact polish. Use sparingly; do not pad the review.
