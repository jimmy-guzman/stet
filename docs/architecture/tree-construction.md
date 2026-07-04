# Tree construction

- Source the tree from `git ls-files --stage` (tracked, carrying the file mode) plus `git ls-files --others --exclude-standard` (untracked, gitignore respected), union'd with the changed set so staged deletions stay visible.
- A symlink is identified by git mode `120000` for tracked files and by `lstat` for untracked ones; it renders with a distinct symlink icon, and its content/diff is the link's target path text (matching git), never the dereferenced target. The local-file read path uses `lstat`/`readlink`, so a link to a directory, a binary, or a missing target still reads as its one-line path.
- Ordering is directories-first, then alphabetical, always: stable under polling by construction, so the list never reorders under the cursor.
- Flatten single-child directory chains into one row.
- Tag each changed file with its stage state (staged, unstaged, mixed, untracked) from `git status`.
- Include untracked files in the changed set (except in the `staged` scope) and render them as all-added diffs.
- Go-to-file (`ctrl-p`) searches the same file universe as the tree.
