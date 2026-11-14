export const Logo = ({ version }: { version?: string }) => (
  <span className="flex items-center gap-2">
    <span className="stet-mark relative inline-block font-mono text-base leading-none font-semibold">
      stet
      <span
        aria-hidden
        className="absolute inset-x-0 top-[0.9375em] flex justify-around"
      >
        <span className="bg-fd-primary size-[0.1875em] rounded-full" />
        <span className="bg-fd-primary size-[0.1875em] rounded-full" />
        <span className="bg-fd-primary size-[0.1875em] rounded-full" />
        <span className="bg-fd-primary size-[0.1875em] rounded-full" />
      </span>
    </span>
    {version === undefined ? null : (
      <span
        title="latest release"
        className="bg-fd-muted text-fd-muted-foreground rounded px-1.5 py-0.5 font-mono text-[0.65rem]"
      >
        v{version}
      </span>
    )}
  </span>
);
