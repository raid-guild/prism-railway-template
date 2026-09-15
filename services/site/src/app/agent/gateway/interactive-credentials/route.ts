import { NextResponse } from "next/server";
import {
  isSourceAdapterPlatform,
  loadConfig,
  readSourceAdapterPolicy,
  resolveAgentProfileInteraction,
  resolveSourceAdapterPolicy,
} from "@/lib/app-core";
import { credentialsForSourceMode } from "@/lib/gateway-credential-assignment";
import { requireServiceAccess } from "@/lib/internal-service";
import { listEnabledGatewayCredentialsOrEmpty } from "@/lib/prism-gateway";

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const platform = stringField(body?.platform);
  const targetId = stringField(body?.targetId);
  const userId = stringField(body?.userId);
  if (!platform || !targetId || !userId) {
    return NextResponse.json({ ok: false, error: "SOURCE_IDENTITY_REQUIRED" }, { status: 400 });
  }
  if (!isSourceAdapterPlatform(platform)) {
    return NextResponse.json({ ok: false, error: "SOURCE_PLATFORM_UNSUPPORTED" }, { status: 400 });
  }

  const identity = {
    platform,
    targetId,
    threadId: stringField(body?.threadId) || null,
    groupIds: Array.isArray(body?.groupIds)
      ? body.groupIds.map(stringField).filter(Boolean).slice(0, 100)
      : [],
    userId,
  };
  const boundAgent = resolveAgentProfileInteraction({
    surfaceType: platform as "buzz" | "discord" | "telegram",
    surfaceKey: targetId,
    threadId: identity.threadId,
    groupIds: identity.groupIds,
    userId,
  });
  const legacyPolicy = boundAgent ? null : resolveSourceAdapterPolicy(readSourceAdapterPolicy(loadConfig()), identity);
  const mode = boundAgent?.policy.accessMode ?? legacyPolicy?.mode ?? "off";
  const credentials = mode === "full" ? await listEnabledGatewayCredentialsOrEmpty() : [];
  return NextResponse.json({
    ok: true,
    profile: mode === "full" ? "admin" : mode === "off" ? "off" : "read",
    accessPolicy: boundAgent?.policy ?? legacyPolicy,
    agentProfile: boundAgent ? { key: boundAgent.profile.key, version: boundAgent.profile.version } : null,
    credentials: credentialsForSourceMode(mode, credentials),
  });
}
