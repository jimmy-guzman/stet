export function Logo({ version }: { version?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="inline-block h-[1.05em] w-[0.5em] bg-fd-primary" />
      <span className="font-mono text-base font-semibold tracking-tight">stet</span>
      {version ? (
        <span className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-fd-muted-foreground">
          v{version}
        </span>
      ) : null}
    </span>
  );
}
