import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getReleases } from "@/lib/releases";
import type { Release, ReleaseNote } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Changelog",
  description: "New releases and improvements to stet.",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const inlineToken =
  /`(?<code>[^`]+)`|\[(?<label>[^\]]+)\]\((?<href>https?:\/\/[^)]+)\)/gu;

const renderMessage = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(inlineToken)) {
    const { index } = match;

    if (index > last) {
      nodes.push(text.slice(last, index));
    }

    if (match.groups?.code === undefined) {
      nodes.push(
        <a
          key={index}
          href={match.groups?.href}
          target="_blank"
          rel="noreferrer noopener"
          className="decoration-fd-border hover:text-fd-foreground underline underline-offset-2 transition-colors"
        >
          {match.groups?.label}
        </a>
      );
    } else {
      nodes.push(
        <code
          key={index}
          className="bg-fd-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
        >
          {match.groups.code}
        </code>
      );
    }

    last = index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
};

const Note = ({ note }: { note: ReleaseNote }) => (
  <li className="leading-relaxed">
    {note.emoji === undefined ? null : (
      <span className="mr-1.5">{note.emoji}</span>
    )}
    {note.scope === undefined ? null : (
      <span className="text-fd-foreground font-medium">{note.scope}: </span>
    )}
    {renderMessage(note.message)}
    {note.pr ? (
      <>
        {" "}
        <a
          href={note.pr.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-fd-muted-foreground/70 hover:text-fd-foreground transition-colors"
        >
          #{note.pr.number}
        </a>
      </>
    ) : null}
  </li>
);

const ReleaseEntry = ({ release }: { release: Release }) => (
  <section className="grid grid-cols-1 gap-x-8 sm:grid-cols-[9rem_1fr]">
    <div className="mb-4 sm:sticky sm:top-24 sm:mb-0 sm:self-start">
      <h2 className="font-mono text-lg leading-none font-medium">
        <a
          href={release.url}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-fd-primary transition-colors"
        >
          {release.version}
        </a>
      </h2>
      <time
        dateTime={release.date}
        className="text-fd-muted-foreground mt-1.5 block text-sm"
      >
        {dateFormatter.format(new Date(release.date))}
      </time>
    </div>
    <div className="sm:border-fd-border relative flex flex-col gap-5 pb-12 sm:border-l sm:pl-8">
      <span
        aria-hidden
        className="bg-fd-muted-foreground/50 ring-fd-background absolute top-1.5 left-0 hidden size-2.5 -translate-x-1/2 rounded-full ring-4 sm:block"
      />
      {release.sections.map((section) => (
        <div key={section.title}>
          <h3 className="text-sm font-semibold">{section.title}</h3>
          <ul className="text-fd-muted-foreground marker:text-fd-border mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {section.notes.map((note) => (
              <Note key={`${note.scope ?? ""}:${note.message}`} note={note} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  </section>
);

export default async function Page() {
  const releases = await getReleases();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-10 pb-16 sm:pt-14 sm:pb-24">
      <header className="mb-16">
        <h1 className="font-mono text-3xl font-bold tracking-tight">
          Changelog
        </h1>
        <p className="text-fd-muted-foreground mt-2">
          New releases and improvements to stet.
        </p>
      </header>

      {releases.length === 0 ? (
        <p className="text-fd-muted-foreground">
          Couldn&apos;t load releases right now.{" "}
          <a
            href="https://github.com/jimmy-guzman/stet/releases"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-fd-foreground underline underline-offset-2"
          >
            View them on GitHub
          </a>
          .
        </p>
      ) : (
        <div>
          {releases.map((release) => (
            <ReleaseEntry key={release.version} release={release} />
          ))}
        </div>
      )}
    </main>
  );
}
