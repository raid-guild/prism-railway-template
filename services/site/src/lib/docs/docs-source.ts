import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

const docsRootCandidates = [
  process.env.PRISM_USER_DOCS_ROOT,
  path.resolve(process.cwd(), "docs", "user"),
  path.resolve(process.cwd(), "..", "docs", "user"),
  path.resolve(process.cwd(), "..", "..", "docs", "user"),
  path.resolve(process.cwd(), "..", "..", "..", "docs", "user"),
].filter((candidate): candidate is string => Boolean(candidate));

export type DocPage = {
  content: string;
  description?: string;
  filePath: string;
  slug: string[];
  title: string;
};

export type DocNavItem = {
  href: string;
  title: string;
};

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function docsAssetsRoot(docsRoot: string) {
  return path.join(docsRoot, "assets");
}

function slugToFilePath(docsRoot: string, slug: string[]) {
  const cleanSlug = slug.filter(Boolean);
  const relativePath =
    cleanSlug.length === 0 ? "README.md" : `${cleanSlug.join("/")}.md`;
  const filePath = path.resolve(docsRoot, relativePath);

  if (filePath !== path.resolve(docsRoot, "README.md") && !isInside(docsRoot, filePath)) {
    return null;
  }

  return filePath;
}

function titleFromMarkdown(content: string, fallback: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function titleFromSlug(slug: string[]) {
  if (slug.length === 0) {
    return "Prism User Docs";
  }

  return slug
    .at(-1)!
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getDocPage(slug: string[]): Promise<DocPage | null> {
  for (const docsRoot of docsRootCandidates) {
    const filePath = slugToFilePath(docsRoot, slug);
    if (!filePath) {
      continue;
    }

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = matter(raw);

      return {
        content: parsed.content,
        description:
          typeof parsed.data.description === "string"
            ? parsed.data.description
            : undefined,
        filePath,
        slug,
        title:
          typeof parsed.data.title === "string"
            ? parsed.data.title
            : titleFromMarkdown(parsed.content, titleFromSlug(slug)),
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function listMarkdownFiles(dir: string, assetsRoot: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entryPath === assetsRoot) {
          return [];
        }
        return listMarkdownFiles(entryPath, assetsRoot);
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [entryPath];
      }
      return [];
    }),
  );

  return files.flat();
}

export async function getDocSlugs() {
  for (const docsRoot of docsRootCandidates) {
    try {
      const files = await listMarkdownFiles(docsRoot, docsAssetsRoot(docsRoot));
      return files.map((file) => {
        const relative = path.relative(docsRoot, file).replace(/\\/g, "/");
        if (relative === "README.md") {
          return [];
        }
        return relative.replace(/\.md$/, "").split("/");
      });
    } catch {
      continue;
    }
  }

  return [[]];
}

export async function getDocNav(): Promise<DocNavItem[]> {
  const slugs = await getDocSlugs();
  const pages = await Promise.all(slugs.map((slug) => getDocPage(slug)));

  return pages
    .filter((page): page is DocPage => Boolean(page))
    .map((page) => ({
      href: page.slug.length === 0 ? "/docs" : `/docs/${page.slug.join("/")}`,
      title: page.title,
    }))
    .sort((a, b) => {
      if (a.href === "/docs") {
        return -1;
      }
      if (b.href === "/docs") {
        return 1;
      }
      return a.href.localeCompare(b.href);
    });
}

export async function getDocAsset(pathSegments: string[]) {
  for (const docsRoot of docsRootCandidates) {
    const assetsRoot = docsAssetsRoot(docsRoot);
    const assetPath = path.resolve(assetsRoot, ...pathSegments);
    if (!isInside(assetsRoot, assetPath)) {
      continue;
    }

    try {
      const assetStat = await stat(assetPath);
      if (!assetStat.isFile()) {
        continue;
      }
      return assetPath;
    } catch {
      continue;
    }
  }

  return null;
}
