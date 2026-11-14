import { Logo } from "@/components/logo";

const links = [
  { label: "GitHub", href: "https://github.com/jimmy-guzman/stet" },
  { label: "npm", href: "https://npmx.dev/package/@jimmy.codes/stet" },
  { label: "Changelog", href: "/changelog" },
  { label: "llms.txt", href: "/llms.txt" },
  {
    label: "MIT License",
    href: "https://github.com/jimmy-guzman/stet/blob/main/LICENSE",
  },
];

export const Footer = ({ version }: { version?: string }) => (
  <footer className="border-fd-border mt-auto border-t">
    <div className="text-fd-muted-foreground mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm sm:flex-row">
      <div className="flex flex-col items-center gap-1 sm:items-start">
        <div className="flex items-center gap-3">
          <Logo />
          {version === undefined ? null : (
            <span className="text-fd-muted-foreground font-mono text-xs">
              v{version}
            </span>
          )}
        </div>
        <span className="text-xs">
          Built by{" "}
          <a
            href="https://jimmy.codes"
            className="hover:text-fd-foreground transition-colors"
          >
            Jimmy Guzman Moreno
          </a>
        </span>
      </div>
      <nav className="flex items-center gap-6">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="hover:text-fd-foreground transition-colors"
          >
            {link.label}
          </a>
        ))}
      </nav>
    </div>
  </footer>
);
