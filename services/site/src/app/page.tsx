import Image from "next/image";
import Link from "next/link";

import { Footer } from "@/components/shared/footer";
import { Button } from "@/components/ui/button";
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://127.0.0.1:3100";

async function getHealth() {
  try {
    const response = await fetch(`${apiBase}/api/health`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<{
      ok: boolean;
      service: string;
      timestamp: string;
    }>;
  } catch {
    return null;
  }
}

export default async function Page() {
  const health = await getHealth();
  const labEnabled = isPrismLabEnabled(process.env.PRISM_LAB_ENABLED);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <main className="w-full flex-1 px-4 py-6 text-foreground md:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-0">
          <section className="relative isolate overflow-hidden border border-border/60 bg-card/90 px-8 py-20 shadow-[0_24px_80px_-36px_rgba(26,31,44,0.45)] backdrop-blur md:px-12 md:py-28">
            <Image
              alt=""
              aria-hidden="true"
              className="object-cover object-center opacity-30"
              fill
              priority
              src="/images/SP_bg-prism.png"
            />
            <div className="relative z-10 flex max-w-4xl flex-col gap-6">
              <p className="font-mono text-xs font-medium uppercase tracking-[0.24em] text-primary">
                Prism Refactory
              </p>
              <h1 className="max-w-4xl text-5xl leading-none tracking-tight md:text-7xl">
                Change requests in front, controlled agent runs behind.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-muted-foreground md:text-2xl">
                A product-friendly surface for triaging work, routing it into
                controlled agent runs, and keeping every production-facing
                change under human review.
              </p>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                Operators can collect requests, shape the scope, hand off to
                Codex with clear context, and track the resulting branch,
                preview, and review flow in one place.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button asChild className="holographic-shimmer-hover">
                  <Link href="/admin">Open admin board</Link>
                </Button>
                {labEnabled ? (
                  <Button asChild variant="secondary">
                    <Link href="/admin/lab">Open Prism Lab</Link>
                  </Button>
                ) : null}
                <Button asChild variant="secondary">
                  <Link href="/docs">Read user docs</Link>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href="https://docs.railway.com/templates/create"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Railway template docs
                  </a>
                </Button>
              </div>
            </div>
          </section>

          <section className="border-x border-b border-border/60 bg-card/70 px-8 py-16 backdrop-blur md:px-12">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  Agent Driven Change Management
                </p>
                <h2 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
                  Triage requests, route them to review branches, and keep
                  production out of the blast radius.
                </h2>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                  This task list refreshes live while Codex triages, branches,
                  and moves requests toward review.
                </p>
              </div>
              <div className="grid gap-px border border-border/60 bg-border">
                <div className="bg-background/70 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Request Intake
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Capture change requests with clear scope, priority,
                    repository target, and review constraints.
                  </p>
                </div>
                <div className="bg-background/70 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Controlled Agent Flow
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Route approved work into agent sessions that stay linked to
                    threads, branches, and execution logs.
                  </p>
                </div>
                <div className="bg-background/70 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Human Review
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Keep previews, compare links, comments, and final approval
                    visible before anything touches production.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="relative isolate overflow-hidden border-x border-b border-border/60 px-8 py-16 shadow-[0_24px_80px_-36px_rgba(26,31,44,0.45)] md:px-12">
            <Image
              alt=""
              aria-hidden="true"
              className="object-cover object-center opacity-95"
              fill
              src="/images/prism_landscape.png"
            />
            <div className="relative z-10 mx-auto max-w-3xl border border-border/60 bg-[var(--code-surface)] text-[var(--code-surface-foreground)]">
              <div className="border-b border-border/60 px-6 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--code-surface-muted)]">
                  API status
                </p>
              </div>
              <pre className="overflow-auto bg-background/20 p-6 text-sm leading-6">
                {JSON.stringify(
                  health ?? { ok: false, service: "api", timestamp: null },
                  null,
                  2,
                )}
              </pre>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
