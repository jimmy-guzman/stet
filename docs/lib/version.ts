/**
 * Latest published stet version from npm, for the nav/footer badge. Revalidated hourly and
 * failure-tolerant (offline/CI simply omits the badge), mirroring the bounded, swallow-to-undefined
 * shape of stet's own `src/upgrade/release.ts`.
 */

const isVersionPayload = (value: unknown): value is { version: string } =>
  typeof value === "object" &&
  value !== null &&
  "version" in value &&
  typeof value.version === "string";

export const getStetVersion = async (): Promise<string | undefined> => {
  try {
    const res = await fetch(
      "https://registry.npmjs.org/@jimmy.codes/stet/latest",
      {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!res.ok) {
      return undefined;
    }

    const data: unknown = await res.json();

    return isVersionPayload(data) ? data.version : undefined;
  } catch {
    return undefined;
  }
};
