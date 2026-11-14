/**
 * Release history sourced from the GitHub Releases API, parsed into structured data so the
 * changelog page renders in stet's own UI instead of dumping release-please markdown. Revalidated
 * hourly and failure-tolerant (offline/CI/rate-limit yields an empty list, which the page renders
 * as a "view on GitHub" fallback), mirroring the shape of `lib/version.ts`.
 */

export interface ReleaseNote {
  emoji?: string;
  scope?: string;
  message: string;
  pr?: { number: number; url: string };
}

export interface ReleaseSection {
  title: string;
  notes: ReleaseNote[];
}

export interface Release {
  version: string;
  url: string;
  date: string;
  sections: ReleaseSection[];
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

const sectionTitles: Record<string, string> = {
  Features: "Features",
  "Bug Fixes": "Bug fixes",
  "Performance Improvements": "Performance improvements",
  "⚠ BREAKING CHANGES": "Breaking changes",
  Reverts: "Reverts",
  Documentation: "Documentation",
};

const normalizeTitle = (raw: string) =>
  sectionTitles[raw] ?? raw.replace(/^[^\p{L}]+/u, "").trim();

const parseNote = (line: string): ReleaseNote => {
  let message = line.replace(/^\*\s+/u, "").trim();

  const pr = /\(\[#(?<number>\d+)\]\((?<url>https?:\/\/[^)]+)\)\)/u.exec(
    message
  );

  message = message
    .replaceAll(/,?\s*closes\s+\[#\d+\]\(https?:\/\/[^)]+\)/giu, "")
    .replaceAll(/\s*\(\[[0-9a-f]{7,40}\]\(https?:\/\/[^)]+\)\)/giu, "")
    .replaceAll(/\s*\(\[#\d+\]\(https?:\/\/[^)]+\)\)/gu, "")
    .trim();

  const scopeMatch = /^\*\*(?<scope>[^*:]+):\*\*\s*/u.exec(message);
  const scope = scopeMatch?.groups?.scope;

  if (scopeMatch) {
    message = message.slice(scopeMatch[0].length);
  }

  const emojiMatch =
    /^(?<emoji>\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s+/u.exec(
      message
    );

  const emoji = emojiMatch?.groups?.emoji;

  if (emojiMatch) {
    message = message.slice(emojiMatch[0].length);
  }

  return {
    emoji,
    scope,
    message: message.trim(),
    pr: pr?.groups
      ? { number: Number(pr.groups.number), url: pr.groups.url }
      : undefined,
  };
};

export const parseReleaseBody = (body: string): ReleaseSection[] => {
  const sections: ReleaseSection[] = [];

  for (const line of body.split("\n")) {
    const heading = /^###\s+(?<title>.*)$/u.exec(line);

    if (heading?.groups) {
      sections.push({
        title: normalizeTitle(heading.groups.title.trim()),
        notes: [],
      });
      continue;
    }

    if (line.startsWith("* ") && sections.length > 0) {
      sections.at(-1)?.notes.push(parseNote(line));
    }
  }

  return sections.filter((section) => section.notes.length > 0);
};

const isGithubRelease = (value: unknown): value is GithubRelease =>
  typeof value === "object" &&
  value !== null &&
  "tag_name" in value &&
  typeof value.tag_name === "string" &&
  "html_url" in value &&
  typeof value.html_url === "string" &&
  "published_at" in value &&
  typeof value.published_at === "string" &&
  "body" in value &&
  (typeof value.body === "string" || value.body === null) &&
  "draft" in value &&
  typeof value.draft === "boolean" &&
  "prerelease" in value &&
  typeof value.prerelease === "boolean";

const toRelease = (release: GithubRelease): Release => ({
  version: release.tag_name.replace(/^[a-z0-9]+-v/iu, "v"),
  url: release.html_url,
  date: release.published_at,
  sections: parseReleaseBody(release.body ?? ""),
});

const fetchReleasesPage = async (page: number) => {
  const res = await fetch(
    `https://api.github.com/repos/jimmy-guzman/stet/releases?per_page=100&page=${page}`,
    {
      headers: {
        "User-Agent": "stet-docs",
        Accept: "application/vnd.github+json",
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!res.ok) {
    throw new Error(`releases request failed: ${res.status}`);
  }

  const data: unknown = await res.json();

  if (!Array.isArray(data)) {
    throw new TypeError("unexpected releases payload");
  }

  return {
    releases: data.filter(isGithubRelease),
    link: res.headers.get("link"),
  };
};

const lastPageFrom = (linkHeader: string | null): number => {
  const match = linkHeader?.match(/[?&]page=(?<last>\d+)[^>]*>;\s*rel="last"/u);

  return match?.groups ? Number(match.groups.last) : 1;
};

export const getReleases = async (): Promise<Release[]> => {
  try {
    const first = await fetchReleasesPage(1);

    const rest = await Promise.all(
      Array.from(
        { length: lastPageFrom(first.link) - 1 },
        async (_, index) => await fetchReleasesPage(index + 2)
      )
    );

    return [first, ...rest]
      .flatMap((page) => page.releases)
      .filter((release) => !release.draft && !release.prerelease)
      .map(toRelease);
  } catch {
    return [];
  }
};
