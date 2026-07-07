/**
 * Latest published stet version from npm, for the nav/footer badge. Revalidated hourly and
 * failure-tolerant (offline/CI simply omits the badge), mirroring the bounded, swallow-to-undefined
 * shape of stet's own `src/upgrade/release.ts`.
 */
export async function getStetVersion() {
  try {
    const res = await fetch("https://registry.npmjs.org/@jimmy.codes/stet/latest", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "version" in data &&
      typeof data.version === "string"
    ) {
      return data.version;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
