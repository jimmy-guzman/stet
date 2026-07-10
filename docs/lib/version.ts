/**
 * Latest published stet version from npm, for the nav/footer badge. Revalidated hourly and
 * failure-tolerant (offline/CI simply omits the badge), mirroring the bounded, swallow-to-undefined
 * shape of stet's own `src/upgrade/release.ts`.
 */

import { Data, Effect } from "effect";

class VersionError extends Data.TaggedError("VersionError")<{ message: string }> {}

function isVersionPayload(value: unknown): value is { version: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string"
  );
}

const loadVersion = Effect.gen(function* () {
  const res = yield* Effect.tryPromise({
    try: (signal) =>
      fetch("https://registry.npmjs.org/@jimmy.codes/stet/latest", {
        next: { revalidate: 3600 },
        signal,
      }),
    catch: (cause) =>
      new VersionError({ message: cause instanceof Error ? cause.message : String(cause) }),
  }).pipe(Effect.timeout("3 seconds"));

  if (!res.ok) {
    return yield* Effect.fail(
      new VersionError({ message: `version request failed: ${res.status}` }),
    );
  }

  const data = yield* Effect.tryPromise({
    try: () => res.json() as Promise<unknown>,
    catch: (cause) =>
      new VersionError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });

  if (isVersionPayload(data)) return data.version;

  return yield* Effect.fail(new VersionError({ message: "unexpected npm payload" }));
});

export function getStetVersion(): Promise<string | undefined> {
  return Effect.runPromise(
    loadVersion.pipe(Effect.orElseSucceed((): string | undefined => undefined)),
  );
}
