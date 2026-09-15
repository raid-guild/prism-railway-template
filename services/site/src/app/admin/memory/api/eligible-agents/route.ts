import { NextResponse } from "next/server";

import { listAgentProfiles } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";
import { fetchPrismMemoryJson } from "@/lib/prism-memory";
import {
  eligibleMemoryAgents,
  resolveLabMemoryReferences,
} from "@/lib/prism-lab-routes/memory-context-service";

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canChatAgents");
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const body = (await request.json().catch(() => null)) as {
    references?: unknown;
  } | null;
  try {
    const references = await resolveLabMemoryReferences(
      body?.references,
      (path) => fetchPrismMemoryJson(path),
    );
    if (
      !references.every(
        (item) =>
          item.reference.type === "rolling-day" ||
          item.reference.audience !== "restricted" ||
          access.capabilities.includes("canRunAgent"),
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Selected Memory includes restricted records" },
        { status: 403 },
      );
    }
    const agents = eligibleMemoryAgents({
      profiles: listAgentProfiles(),
      references,
      capabilities: access.capabilities,
    }).map(
      ({
        key,
        name,
        avatarUrl,
        accentColor,
        description,
        version,
        systemKey,
      }) => ({
        key,
        name,
        avatarUrl,
        accentColor,
        description,
        version,
        systemKey,
      }),
    );
    return NextResponse.json({
      ok: true,
      agents,
      references: references.map(({ label, citation, reference }) => ({
        label,
        citation,
        reference,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not resolve Memory selection",
      },
      { status: 400 },
    );
  }
}
