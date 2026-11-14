const latestReleaseUrl =
  "https://api.github.com/repos/jimmy-guzman/stet/releases/latest";

const releasesPageUrl = "https://github.com/jimmy-guzman/stet/releases/latest";

// Bun.semver.order throws on a non-semver string, so validate at the boundary: callers only ever
// See a parseable version (or undefined), never a string that detonates a later comparison.
const isValidVersion = (version: string) => {
  try {
    Bun.semver.order(version, version);

    return true;
  } catch {
    return false;
  }
};

/**
 * The semver version inside a release tag, or `undefined` when the tag carries none. release-please
 * tags the component, so the latest tag is `stet-v0.3.3`; a plain `v0.3.3` or bare `0.3.3` parses
 * too. Returning `undefined` for anything unparseable keeps every consumer total.
 */
export const tagToVersion = (tag: string) => {
  const withoutComponent = tag.startsWith("stet-")
    ? tag.slice("stet-".length)
    : tag;

  const version = withoutComponent.startsWith("v")
    ? withoutComponent.slice(1)
    : withoutComponent;

  return isValidVersion(version) ? version : undefined;
};

/** `candidate` is strictly newer than `base` (Bun.semver.order returns -1/0/1). */
export const isNewer = (candidate: string, base: string) =>
  Bun.semver.order(candidate, base) === 1;

export const formatUpdateNotice = (update: {
  current: string;
  latest: string;
}) => {
  const segments = [
    `A new release of stet is available: ${update.current} -> ${update.latest}`,
    `run "stet upgrade" to update`,
    releasesPageUrl,
  ];

  // Stack the segments so a narrow terminal never hard-wraps mid-segment; the "\n  "
  // Indent aligns continuation lines under the "ℹ " marker log() prepends.
  return segments.join("\n  ");
};

/**
 * The latest published version from GitHub Releases, the source all install channels derive from.
 * Plain fetch (not the Process service) so it works on the pre-TUI upgrade path that builds no
 * runtime, and swallows every failure to `undefined` so a check never blocks or breaks the caller.
 * A self-bounded timeout makes a stalled request fail fast, so every caller (including the upgrade
 * pre-check) gets the same contract without supplying one. GitHub's unauthenticated API rejects
 * requests without a User-Agent with 403, so it is required.
 */
export const fetchLatestVersion = async (): Promise<string | undefined> => {
  try {
    const response = await fetch(latestReleaseUrl, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "stet" },
      signal: AbortSignal.timeout(3000),
    });

    const body: unknown = response.ok ? await response.json() : undefined;

    const tag =
      typeof body === "object" && body !== null && "tag_name" in body
        ? body.tag_name
        : undefined;

    return typeof tag === "string" ? tagToVersion(tag) : undefined;
  } catch {
    return undefined;
  }
};
