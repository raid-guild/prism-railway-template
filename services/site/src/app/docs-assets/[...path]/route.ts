import { readFile } from "node:fs/promises";
import path from "node:path";

import { getDocAsset } from "@/lib/docs/docs-source";

type DocsAssetRouteProps = {
  params: Promise<{
    path: string[];
  }>;
};

const contentTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(_request: Request, { params }: DocsAssetRouteProps) {
  const { path: pathSegments } = await params;
  const assetPath = await getDocAsset(pathSegments);

  if (!assetPath) {
    return new Response("Not found", { status: 404 });
  }

  const body = await readFile(assetPath);
  const contentType =
    contentTypes[path.extname(assetPath).toLowerCase()] ||
    "application/octet-stream";

  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": contentType,
    },
  });
}
