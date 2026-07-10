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
  "Features": "Features",
  "Bug Fixes": "Bug fixes",
  "Performance Improvements": "Performance improvements",
  "⚠ BREAKING CHANGES": "Breaking changes",
  "Reverts": "Reverts",
  "Documentation": "Documentation",
};

function normalizeTitle(raw: string) {
  return sectionTitles[raw] ?? raw.replace(/^[^\p{L}]+/u, "").trim();
}

function parseNote(line: string): ReleaseNote {
  let message = line.replace(/^\*\s+/, "").trim();

  const pr = message.match(/\(\[#(\d+)\]\((https?:\/\/[^)]+)\)\)/);

  message = message
    .replace(/,?\s*closes\s+\[#\d+\]\(https?:\/\/[^)]+\)/gi, "")
    .replace(/\s*\(\[[0-9a-f]{7,40}\]\(https?:\/\/[^)]+\)\)/gi, "")
    .replace(/\s*\(\[#\d+\]\(https?:\/\/[^)]+\)\)/g, "")
    .trim();

  const scopeMatch = message.match(/^\*\*([^*:]+):\*\*\s*/);
  const scope = scopeMatch?.[1];
  if (scopeMatch) message = message.slice(scopeMatch[0].length);

  const emojiMatch = message.match(
    /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s+/u,
  );
  const emoji = emojiMatch?.[1];
  if (emojiMatch) message = message.slice(emojiMatch[0].length);

  return {
    emoji,
    scope,
    message: message.trim(),
    pr: pr ? { number: Number(pr[1]), url: pr[2] } : undefined,
  };
}

export function parseReleaseBody(body: string): ReleaseSection[] {
  const sections: ReleaseSection[] = [];

  for (const line of body.split("\n")) {
    const heading = line.match(/^###\s+(.*)$/);
    if (heading) {
      sections.push({ title: normalizeTitle(heading[1].trim()), notes: [] });
      continue;
    }
    if (line.startsWith("* ") && sections.length > 0) {
      sections[sections.length - 1].notes.push(parseNote(line));
    }
  }

  return sections.filter((section) => section.notes.length > 0);
}

function isGithubRelease(value: unknown): value is GithubRelease {
  return (
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
    typeof value.prerelease === "boolean"
  );
}

function toRelease(release: GithubRelease): Release {
  return {
    version: release.tag_name.replace(/^[a-z0-9]+-v/i, "v"),
    url: release.html_url,
    date: release.published_at,
    sections: parseReleaseBody(release.body ?? ""),
  };
}

function fetchReleasesPage(page: number): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/jimmy-guzman/stet/releases?per_page=100&page=${page}`,
    {
      headers: {
        "User-Agent": "stet-docs",
        "Accept": "application/vnd.github+json",
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    },
  );
}

function lastPageFrom(linkHeader: string | null): number {
  const match = linkHeader?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match ? Number(match[1]) : 1;
}

export async function getReleases(): Promise<Release[]> {
  try {
    const first = await fetchReleasesPage(1);
    if (!first.ok) return [];
    const firstData: unknown = await first.json();
    if (!Array.isArray(firstData)) return [];

    const lastPage = lastPageFrom(first.headers.get("link"));
    const restPages = Array.from({ length: lastPage - 1 }, (_, index) => index + 2);
    const restResponses = await Promise.all(restPages.map(fetchReleasesPage));
    if (restResponses.some((res) => !res.ok)) return [];
    const restData: unknown[] = await Promise.all(restResponses.map((res) => res.json()));
    if (restData.some((data) => !Array.isArray(data))) return [];

    return [firstData, ...restData]
      .flat()
      .filter(isGithubRelease)
      .filter((release) => !release.draft && !release.prerelease)
      .map(toRelease);
  } catch {
    return [];
  }
}
