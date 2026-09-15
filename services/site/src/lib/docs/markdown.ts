import path from "node:path";

import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

function resolveMarkdownUrl(href: string, slug: string[]) {
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("mailto:")
  ) {
    return href;
  }

  const suffixStart = href.search(/[?#]/);
  const pathname = suffixStart === -1 ? href : href.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : href.slice(suffixStart);
  const currentDir = slug.length === 0 ? "." : slug.slice(0, -1).join("/");
  const resolved = path.posix.normalize(path.posix.join(currentDir, pathname));

  if (resolved.startsWith("assets/")) {
    return `/docs-assets/${resolved.replace(/^assets\//, "")}${suffix}`;
  }

  if (resolved.endsWith(".md")) {
    const docPath = resolved.replace(/\.md$/, "").replace(/\/README$/, "");
    return docPath ? `/docs/${docPath}${suffix}` : `/docs${suffix}`;
  }

  return href;
}

function rewriteMarkdownUrls(markdown: string, slug: string[]) {
  return markdown
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, href) => {
      return `![${alt}](${resolveMarkdownUrl(href, slug)})`;
    })
    .replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => {
      return `[${label}](${resolveMarkdownUrl(href, slug)})`;
    });
}

export async function renderMarkdown(markdown: string, slug: string[]) {
  const rewrittenMarkdown = rewriteMarkdownUrls(markdown, slug);
  const processed = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "wrap",
      properties: {
        className: ["docs-heading-link"],
      },
    })
    .use(rehypeStringify)
    .process(rewrittenMarkdown);

  return processed.toString();
}
