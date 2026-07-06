"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-4 py-3 font-mono text-sm">
      <span className="text-fd-muted-foreground select-none">$</span>
      <code className="flex-1 overflow-x-auto whitespace-nowrap text-fd-foreground">{command}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy install command"}
        className="shrink-0 text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        {copied ? <Check className="size-4 text-fd-primary" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
