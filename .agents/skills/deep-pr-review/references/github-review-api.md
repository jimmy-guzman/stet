# GitHub review API mechanics

Concrete `gh api` commands for authoring, inspecting, editing, and submitting a pending PR
review with inline committable suggestions. Load this when you reach the "deliver as a
pending review" step. All examples use `OWNER/REPO` and pull number `N`; fill them from
`gh pr view N --json headRefOid` (the `headRefOid` is the `commit_id` you anchor against).

## Build the payload with jq and rawfiles

Write each comment body to its own file, then assemble the JSON with `jq --rawfile`. This
avoids hand-escaping newlines and the backticks inside committable ` ```suggestion ` blocks,
which is the main source of malformed payloads.

```bash
# one file per comment body (markdown, including any ```suggestion block)
#   bodyA.md, bodyB.md, ...

jq -n \
  --arg sha "<headRefOid>" \
  --rawfile a bodyA.md --rawfile b bodyB.md \
  '{commit_id:$sha, comments:[
     {path:"src/foo.ts", line:88,  side:"RIGHT", body:$a},
     {path:"src/bar.ts", line:123, side:"RIGHT", body:$b}
   ]}' > review.json
```

- `line` is the line number in the file at `commit_id` (the head commit), and must be part
  of the PR diff. `side` is `RIGHT` for the new version (use `LEFT` only to comment on a
  removed line).
- For a multi-line anchor, add `start_line` (and `start_side`) alongside `line`.

## Create a pending review

Omit `event` to leave the review in `PENDING` state (a draft only the author sees until they
submit it).

```bash
gh api repos/OWNER/REPO/pulls/N/reviews --method POST --input review.json \
  --jq '{id, state, html_url}'
```

## Verify the inline comments landed

The create response's body length is not the inline-comment count. List the actual inline
comments:

```bash
gh api repos/OWNER/REPO/pulls/N/reviews/<reviewId>/comments \
  --jq '.[] | {path, line, head: (.body|split("\n")|.[0])}'
```

## Edit = delete and recreate

A pending review's inline comments are fixed at creation. To change them, delete the review
and recreate it with the full updated set.

```bash
gh api repos/OWNER/REPO/pulls/N/reviews/<reviewId> --method DELETE
# then recreate with the create command above
```

## Submit

Submitting publishes all pending comments at once and cannot be reverted to pending (only
dismissed afterward).

```bash
gh api repos/OWNER/REPO/pulls/N/reviews/<reviewId>/events --method POST \
  -f event=COMMENT -f body="<optional summary>"
```

`event` is one of `COMMENT`, `APPROVE`, `REQUEST_CHANGES`. On your own PR only `COMMENT` is
allowed; the others return a 422.

## Committable suggestion rules

A ` ```suggestion ` block replaces exactly the line(s) the comment is anchored to. The block
content is the literal replacement text, so it must match the file's indentation and be
syntactically complete on its own. A fix that needs a new import, helper, or change elsewhere
cannot be expressed as a committable suggestion on a single anchor; describe it in prose (or
a non-`suggestion` code block) instead.
