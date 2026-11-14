import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-fd-primary font-mono text-sm">404</p>
      <h1 className="font-mono text-3xl font-bold tracking-tight">
        Page not found
      </h1>
      <p className="text-fd-muted-foreground max-w-md">
        That page does not exist. It may have moved, or the link is out of date.
      </p>
      <Link
        href="/"
        className="bg-fd-primary text-fd-primary-foreground mt-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Back home
      </Link>
    </main>
  );
}
