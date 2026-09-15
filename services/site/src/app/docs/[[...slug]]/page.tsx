import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Footer } from "@/components/shared/footer";
import { getDocNav, getDocPage, getDocSlugs } from "@/lib/docs/docs-source";
import { renderMarkdown } from "@/lib/docs/markdown";

type DocsPageProps = {
  params: Promise<{
    slug?: string[];
  }>;
};

export async function generateStaticParams() {
  const slugs = await getDocSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: DocsPageProps): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = await getDocPage(slug);

  if (!page) {
    return {
      title: "Docs | Prism Refactory",
    };
  }

  return {
    title: `${page.title} | Prism Docs`,
    description: page.description,
  };
}

export default async function DocsPage({ params }: DocsPageProps) {
  const { slug = [] } = await params;
  const [page, nav] = await Promise.all([getDocPage(slug), getDocNav()]);

  if (!page) {
    notFound();
  }

  const html = await renderMarkdown(page.content, page.slug);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <main className="w-full flex-1 px-4 py-6 text-foreground md:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border border-border/60 bg-card/70 p-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:overflow-auto">
            <Link
              className="block text-sm font-semibold uppercase tracking-[0.18em] text-primary"
              href="/docs"
            >
              Prism Docs
            </Link>
            <nav className="mt-6 flex flex-col gap-1 text-sm">
              {nav.map((item) => {
                const active =
                  item.href ===
                  (page.slug.length === 0
                    ? "/docs"
                    : `/docs/${page.slug.join("/")}`);

                return (
                  <Link
                    className={
                      active
                        ? "border border-border bg-background px-3 py-2 text-foreground"
                        : "px-3 py-2 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                    }
                    href={item.href}
                    key={item.href}
                  >
                    {item.title}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <article className="min-w-0 border border-border/60 bg-card/70 px-5 py-8 md:px-8 lg:px-12">
            <div
              className="docs-content mx-auto max-w-4xl"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
