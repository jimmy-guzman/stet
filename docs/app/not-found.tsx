import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-sm text-fd-primary">404</p>
      <h1 className="font-mono text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="max-w-md text-fd-muted-foreground">
        That page does not exist. It may have moved, or the link is out of date.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
      >
        Back home
      </Link>
    </main>
  );
}
