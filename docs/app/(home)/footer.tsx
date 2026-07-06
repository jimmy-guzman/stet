const links = [
  { label: "GitHub", href: "https://github.com/jimmy-guzman/stet" },
  { label: "npm", href: "https://www.npmjs.com/package/@jimmy.codes/stet" },
  {
    label: "MIT License",
    href: "https://github.com/jimmy-guzman/stet/blob/main/LICENSE",
  },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t border-fd-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-fd-muted-foreground sm:flex-row">
        <span className="font-mono">stet</span>
        <nav className="flex items-center gap-6">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="transition-colors hover:text-fd-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
