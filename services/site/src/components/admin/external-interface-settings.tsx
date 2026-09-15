"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Copy, KeyRound, Power, RefreshCw, RotateCw, ShieldCheck, ShieldX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AgentProfile = {
  key: string;
  name: string;
  runtimeProfileKey: string | null;
  version: number;
  bindings: Array<{ surfaceType: string; surfaceKey: string; configuration: { accessMode?: string } }>;
};

type ExternalInterface = {
  key: string;
  name: string;
  enabled: boolean;
  interactionProfileKey: string;
  allowedOrigins: string[];
  credential: {
    configured: boolean;
    prefix: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
  };
};

type AccessEvent = {
  id: string;
  interfaceKey: string | null;
  outcome: string;
  reason: string;
  requestId: string | null;
  createdAt: string;
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const interactionBaseUrl = (process.env.NEXT_PUBLIC_INTERACTION_BASE_URL ?? "").trim().replace(/\/+$/, "");

function interactionSessionUrl(interfaceKey: string) {
  const path = `/interactions/${interfaceKey}/sessions`;
  return interactionBaseUrl ? `${interactionBaseUrl}${path}` : path;
}

export function ExternalInterfaceSettings() {
  const [interfaces, setInterfaces] = useState<ExternalInterface[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [revealedCredential, setRevealedCredential] = useState<{ key: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const profileByInterface = useMemo(() => new Map(profiles.flatMap((profile) => profile.bindings
    .filter((binding) => binding.surfaceType === "external")
    .map((binding) => [binding.surfaceKey, { profile, binding }] as const))), [profiles]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [interfaceResponse, profileResponse] = await Promise.all([
        fetch("/admin/external-interfaces", { cache: "no-store" }),
        fetch("/admin/agent-profiles", { cache: "no-store" }),
      ]);
      const interfacePayload = await interfaceResponse.json().catch(() => null) as {
        interfaces?: ExternalInterface[]; recentEvents?: AccessEvent[]; error?: string;
      } | null;
      const profilePayload = await profileResponse.json().catch(() => null) as {
        profiles?: AgentProfile[]; error?: string;
      } | null;
      if (!interfaceResponse.ok || !Array.isArray(interfacePayload?.interfaces)) {
        throw new Error(interfacePayload?.error || "External interfaces could not be loaded.");
      }
      if (!profileResponse.ok || !Array.isArray(profilePayload?.profiles)) {
        throw new Error(profilePayload?.error || "Agent Profiles could not be loaded.");
      }
      setInterfaces(interfacePayload.interfaces);
      setEvents(Array.isArray(interfacePayload.recentEvents) ? interfacePayload.recentEvents : []);
      setProfiles(profilePayload.profiles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "External interfaces could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggleInterface(externalInterface: ExternalInterface) {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const response = await fetch(`/admin/external-interfaces/${encodeURIComponent(externalInterface.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !externalInterface.enabled }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error || "External interface could not be updated.");
        return;
      }
      setNotice(`${externalInterface.name} ${externalInterface.enabled ? "disabled" : "enabled"}.`);
      await refresh();
    });
  }

  function rotateCredential(externalInterface: ExternalInterface) {
    if (externalInterface.credential.configured && !window.confirm("Rotate this credential? The current value will stop working immediately.")) return;
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const response = await fetch(`/admin/external-interfaces/${encodeURIComponent(externalInterface.key)}/credential`, { method: "POST" });
      const payload = await response.json().catch(() => null) as { credential?: string; error?: string } | null;
      if (!response.ok || !payload?.credential) {
        setError(payload?.error || "Credential could not be generated.");
        return;
      }
      setRevealedCredential({ key: externalInterface.key, value: payload.credential });
      setNotice("Copy the credential now. Prism will not show it again.");
      await refresh();
    });
  }

  function revokeCredential(externalInterface: ExternalInterface) {
    if (!window.confirm("Revoke this credential? Requests will fail until a new value is generated.")) return;
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const response = await fetch(`/admin/external-interfaces/${encodeURIComponent(externalInterface.key)}/credential`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error || "Credential could not be revoked.");
        return;
      }
      setRevealedCredential(null);
      setNotice(`${externalInterface.name} credential revoked.`);
      await refresh();
    });
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-4 w-4" /> External Interfaces
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Agent identity and access come from Agent Profile bindings. This view manages only interface exposure and inbound credentials.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={isLoading || isPending}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {!isLoading && interfaces.length === 0 ? (
        <div className="border border-dashed border-border p-5 text-sm text-muted-foreground">
          No external interfaces are configured. Ask Prism Console to create a disabled interaction profile and interface.
        </div>
      ) : null}

      <div className="grid border border-border/70">
        {interfaces.map((externalInterface) => {
          const resolved = profileByInterface.get(externalInterface.key);
          const profile = resolved?.profile;
          const revealed = revealedCredential?.key === externalInterface.key ? revealedCredential.value : null;
          return (
            <div key={externalInterface.key} className="grid gap-4 border-b border-border/70 p-4 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{externalInterface.name}</p>
                    <Badge variant={externalInterface.enabled ? "secondary" : "muted"}>{externalInterface.enabled ? "Enabled" : "Disabled"}</Badge>
                    <Badge variant="outline">{resolved?.binding.configuration.accessMode ?? "unbound"}</Badge>
                    <Badge variant={externalInterface.credential.configured ? "secondary" : "muted"}>
                      {externalInterface.credential.configured ? "Credential ready" : "No credential"}
                    </Badge>
                  </div>
                  <p className="mt-1 break-all text-sm text-muted-foreground">
                    POST {interactionSessionUrl(externalInterface.key)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Agent {profile?.name ?? "not migrated"} v{profile?.version ?? "?"}
                    {profile?.runtimeProfileKey ? ` · runtime ${profile.runtimeProfileKey}` : " · default runtime"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last used {formatDate(externalInterface.credential.lastUsedAt)}
                    {externalInterface.credential.prefix ? ` · ${externalInterface.credential.prefix}…` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={isPending || (!externalInterface.enabled && !externalInterface.credential.configured)} onClick={() => toggleInterface(externalInterface)}>
                    <Power className="h-4 w-4" /> {externalInterface.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button type="button" variant="outline" disabled={isPending} onClick={() => rotateCredential(externalInterface)}>
                    {externalInterface.credential.configured ? <RotateCw className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                    {externalInterface.credential.configured ? "Rotate" : "Generate"}
                  </Button>
                  {externalInterface.credential.configured ? (
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => revokeCredential(externalInterface)}>
                      <ShieldX className="h-4 w-4" /> Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
              {externalInterface.allowedOrigins.length > 0 ? (
                <p className="text-xs text-muted-foreground">Allowed origins: {externalInterface.allowedOrigins.join(", ")}</p>
              ) : null}
              {revealed ? (
                <div className="grid gap-2 border border-amber-300 bg-amber-50 p-3 text-amber-950">
                  <p className="text-sm font-medium">One-time credential</p>
                  <code className="break-all text-xs">{revealed}</code>
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void navigator.clipboard.writeText(revealed)}>
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {events.length > 0 ? (
        <div className="grid gap-2">
          <h4 className="text-sm font-semibold">Recent ingress activity</h4>
          <div className="grid border border-border/70 text-sm">
            {events.slice(0, 20).map((event) => (
              <div key={event.id} className="grid gap-1 border-b border-border/70 px-3 py-2 last:border-b-0 md:grid-cols-[10rem_8rem_1fr_auto] md:items-center">
                <span>{event.interfaceKey ?? "unknown"}</span>
                <Badge variant={event.outcome === "accepted" ? "secondary" : "muted"}>{event.outcome}</Badge>
                <span className="text-muted-foreground">{event.reason}</span>
                <span className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
