# Upgrading

```sh
sideye upgrade
```

Updates sideye to the latest release using whichever channel it was installed
through: a standalone install re-runs the install script, an npm install runs
npm, and a Homebrew install runs `brew upgrade`. If the install channel cannot
be determined, it prints the upgrade commands instead. It checks the latest
GitHub release first and reports `sideye X.Y.Z is already up to date` without
running anything when you are current, falling back to the channel update if it
cannot reach GitHub.

sideye also checks for a newer release in the background while it runs, and
prints a one-line notice on clean exit when one is available, the way `gh` does.
The check is non-blocking and never interrupts the session.
