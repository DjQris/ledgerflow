import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-8">
      <p className="text-sm uppercase tracking-widest text-muted-foreground">LedgerFlow</p>
      <h1 className="text-4xl font-semibold tracking-tight">Frontend foundation</h1>
      <p className="text-muted-foreground">
        Phase 3A is a setup check. No account or financial features are enabled here.
      </p>
      <Link className="underline underline-offset-4" href="/ui-check">
        Open UI check
      </Link>
    </main>
  );
}
