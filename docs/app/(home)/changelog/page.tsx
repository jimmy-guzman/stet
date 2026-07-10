import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getReleases, type Release, type ReleaseNote } from "@/lib/releases";

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

const inlineToken = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

function renderMessage(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(inlineToken)) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));

    if (match[1] !== undefined) {
      nodes.push(
        <code key={index} className="rounded bg-fd-muted px-1 py-0.5 font-mono text-[0.85em]">
          {match[1]}
        </code>,
      );
    } else {
      nodes.push(
        <a
          key={index}
          href={match[3]}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-fd-border underline-offset-2 transition-colors hover:text-fd-foreground"
        >
          {match[2]}
        </a>,
      );
    }

    last = index + match[0].length;
  }

  if (last < text.length) nodes.push(text.slice(last));

  return nodes;
}

function Note({ note }: { note: ReleaseNote }) {
  return (
    <li className="leading-relaxed">
      {note.emoji ? <span className="mr-1.5">{note.emoji}</span> : null}
      {note.scope ? <span className="font-medium text-fd-foreground">{note.scope}: </span> : null}
      {renderMessage(note.message)}
      {note.pr ? (
        <>
          {" "}
          <a
            href={note.pr.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fd-muted-foreground/70 transition-colors hover:text-fd-foreground"
          >
            #{note.pr.number}
          </a>
        </>
      ) : null}
    </li>
  );
}

function ReleaseEntry({ release }: { release: Release }) {
  return (
    <section className="grid grid-cols-1 gap-x-8 sm:grid-cols-[9rem_1fr]">
      <div className="mb-4 sm:sticky sm:top-24 sm:mb-0 sm:self-start">
        <h2 className="font-mono text-lg font-medium leading-none">
          <a
            href={release.url}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-fd-primary"
          >
            {release.version}
          </a>
        </h2>
        <time dateTime={release.date} className="mt-1.5 block text-sm text-fd-muted-foreground">
          {dateFormatter.format(new Date(release.date))}
        </time>
      </div>
      <div className="relative flex flex-col gap-5 pb-12 sm:border-l sm:border-fd-border sm:pl-8">
        <span
          aria-hidden
          className="absolute top-1.5 left-0 hidden size-2.5 -translate-x-1/2 rounded-full bg-fd-muted-foreground/50 ring-4 ring-fd-background sm:block"
        />
        {release.sections.map((section) => (
          <div key={section.title}>
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-fd-muted-foreground marker:text-fd-border">
              {section.notes.map((note) => (
                <Note key={`${note.scope ?? ""}:${note.message}`} note={note} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function Page() {
  const releases = await getReleases();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-10 pb-16 sm:pt-14 sm:pb-24">
      <header className="mb-16">
        <h1 className="font-mono text-3xl font-bold tracking-tight">Changelog</h1>
        <p className="mt-2 text-fd-muted-foreground">New releases and improvements to stet.</p>
      </header>

      {releases.length === 0 ? (
        <p className="text-fd-muted-foreground">
          Couldn't load releases right now.{" "}
          <a
            href="https://github.com/jimmy-guzman/stet/releases"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-fd-foreground"
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
