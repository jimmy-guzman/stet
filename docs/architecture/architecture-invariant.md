# Architecture invariant

Git output is the synchronous source of truth. The git-backed file tree renders first; diagnostics arrive later as independent async decorations over the stable tree, so the basic view stays useful while checks run.

The git-backed tree renders synchronously; diagnostics decorate it later:

```mermaid
flowchart TD
    git["git output<br/>synchronous source of truth"] --> tree["file tree renders first"]
    tree --> view["view is usable"]
    servers["language servers<br/>async"] -. decorate later .-> view
```
