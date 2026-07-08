import type { ReactNode } from "react";

export function TerminalFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/20">
      <div className="flex items-center gap-2 border-b border-fd-border px-4 py-3">
        <span className="size-3 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-3 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-3 rounded-full bg-fd-muted-foreground/30" />
        <span className="ml-2 font-mono text-xs text-fd-muted-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}
