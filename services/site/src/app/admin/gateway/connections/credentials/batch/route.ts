import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

type CredentialEntry = {
  connectionId: string;
  credentials: Record<string, string>;
};

function validEntry(value: unknown): value is CredentialEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CredentialEntry>;
  if (typeof entry.connectionId !== "string" || !entry.connectionId.trim())
    return false;
  if (!entry.credentials || typeof entry.credentials !== "object") return false;
  const credentials = Object.entries(entry.credentials);
  return (
    credentials.length > 0 &&
    credentials.length <= 4 &&
    credentials.every(
      ([name, secret]) =>
        name.length > 0 &&
        name.length <= 100 &&
        typeof secret === "string" &&
        secret.length > 0,
    )
  );
}

export async function POST(request: Request) {
  const access = await requireAdminAccess();
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );

  const body = (await request.json().catch(() => null)) as {
    entries?: unknown[];
  } | null;
  if (
    !body?.entries ||
    body.entries.length === 0 ||
    body.entries.length > 25 ||
    !body.entries.every(validEntry)
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid credential batch" },
      { status: 400 },
    );
  }

  const updated: string[] = [];
  const failed: Array<{ connectionId: string; error: string }> = [];
  for (const entry of body.entries) {
    try {
      await prismGatewayRequest(
        `/connections/${encodeURIComponent(entry.connectionId)}/credentials`,
        {
          method: "PUT",
          body: JSON.stringify({ credentials: entry.credentials }),
        },
      );
      updated.push(entry.connectionId);
    } catch (error) {
      failed.push({
        connectionId: entry.connectionId,
        error:
          error instanceof PrismGatewayError || error instanceof Error
            ? error.message
            : "CONNECTION_UPDATE_FAILED",
      });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    updated,
    failed,
  }, { status: failed.length === 0 ? 200 : 207 });
}
