"use client";

import { Check, Copy, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

type Status = "idle" | "copied" | "error";

const labels: Record<Status, string> = {
  idle: "Copy install command",
  copied: "Copied",
  error: "Copy failed",
};

const icons: Record<Status, ReactNode> = {
  idle: <Copy className="size-4" />,
  copied: <Check className="text-fd-primary size-4" />,
  error: <X className="text-fd-muted-foreground size-4" />,
};

export const InstallCommand = ({ command }: { command: string }) => {
  const [status, setStatus] = useState<Status>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = async () => {
    clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(command);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    resetTimer.current = setTimeout(() => {
      setStatus("idle");
    }, 1500);
  };

  return (
    <div className="border-fd-border bg-fd-card flex w-full max-w-xl items-center gap-3 rounded-lg border px-4 py-3 text-left font-mono text-sm">
      <span className="text-fd-muted-foreground select-none">$</span>
      <code className="text-fd-foreground flex-1 overflow-x-auto whitespace-nowrap">
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          void copy();
        }}
        aria-label={labels[status]}
        className="text-fd-muted-foreground hover:text-fd-foreground shrink-0 transition-colors"
      >
        {icons[status]}
      </button>
    </div>
  );
};
