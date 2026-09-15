"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Activity, Check, Power, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type RuntimeProfile = {
  key: string;
  name: string;
  adapter: string;
  enabled: boolean;
  isDefault: boolean;
  contractVersion: string | null;
  features: string[];
  health: { reachable: boolean; status: number | null };
};

export function RuntimeSettings() {
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/admin/runtime-profiles", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as {
        profiles?: RuntimeProfile[];
        error?: string;
      } | null;
      if (!response.ok || !Array.isArray(payload?.profiles)) {
        throw new Error(payload?.error || "Runtime profiles could not be loaded.");
      }
      setProfiles(payload.profiles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Runtime profiles could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function updateProfile(profile: RuntimeProfile, changes: { enabled?: boolean; isDefault?: boolean }) {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/admin/runtime-profiles/${encodeURIComponent(profile.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error || "Runtime profile could not be updated.");
        return;
      }
      await refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4" />
            Runtime Profiles
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Prism uses the default profile for chat, tasks, and workflows unless they are explicitly pinned.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={isLoading || isPending}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!isLoading && profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runtime profiles are registered.</p>
      ) : null}

      <div className="grid border border-border/70">
        {profiles.map((profile) => (
          <div
            key={profile.key}
            className="grid gap-4 border-b border-border/70 p-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{profile.name}</p>
                {profile.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                <Badge variant={profile.health.reachable ? "secondary" : "muted"}>
                  {profile.health.reachable ? "Reachable" : "Unreachable"}
                </Badge>
                {!profile.enabled ? <Badge variant="muted">Disabled</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {profile.key} / {profile.adapter}
                {profile.contractVersion ? ` / contract ${profile.contractVersion}` : ""}
              </p>
              {profile.features.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {profile.features.map((feature) => (
                    <Badge key={feature} variant="outline">{feature}</Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {!profile.isDefault ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending || !profile.enabled || !profile.health.reachable}
                  onClick={() => updateProfile(profile, { isDefault: true })}
                >
                  <Check className="h-4 w-4" />
                  Make default
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={isPending || profile.isDefault}
                onClick={() => updateProfile(profile, { enabled: !profile.enabled })}
              >
                <Power className="h-4 w-4" />
                {profile.enabled ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
