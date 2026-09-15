"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AudioLines,
  Cable,
  Loader2,
  MessageSquareText,
  PanelRight,
  Save,
  Settings2,
  X,
} from "lucide-react";

import { CaptureWorkspace } from "@/components/admin/capture-workspace";
import { CodexConsole } from "@/components/admin/codex-console";
import { AgentAvatar } from "@/components/prism-lab/agent-avatar";
import { agentAccentPalette } from "@/lib/agent-profile-colors";
import { AgentBindingForm, AgentBindingToggle } from "@/components/prism-lab/agent-binding-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentProfileActivityItem,
  AgentProfileRecord,
  AgentProfileSessionSummary,
} from "@/lib/app-core";

type Mode = "console" | "capture";

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AgentConsoleWorkspace({
  profile: initialProfile,
  activity,
  sessions,
  canManageSettings,
  canRunAgent,
  memorySessionId = null,
}: {
  profile: AgentProfileRecord;
  activity: AgentProfileActivityItem[];
  sessions: AgentProfileSessionSummary[];
  canManageSettings: boolean;
  canRunAgent: boolean;
  memorySessionId?: string | null;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [mode, setMode] = useState<Mode>("console");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setProfile(initialProfile);
  }, [initialProfile]);

  useEffect(() => {
    if (!inspectorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectorOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [inspectorOpen]);

  async function saveProfile(formData: FormData) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/admin/agent-profiles/${encodeURIComponent(profile.key)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: String(formData.get("name") ?? ""),
            description: String(formData.get("description") ?? ""),
            avatarUrl: String(formData.get("avatarUrl") ?? ""),
            accentColor: String(formData.get("accentColor") ?? ""),
            personaInstructions: String(
              formData.get("personaInstructions") ?? "",
            ),
            runtimeProfileKey: String(formData.get("runtimeProfileKey") ?? ""),
            modelTier: String(formData.get("modelTier") ?? ""),
            skills: String(formData.get("skills") ?? ""),
            memoryScope: {
              scope: String(formData.get("memoryScopeMode") ?? ""),
              buckets: String(formData.get("memoryBuckets") ?? ""),
              knowledgeSourceIds: String(formData.get("memorySources") ?? ""),
              kinds: String(formData.get("memoryKinds") ?? ""),
              tags: String(formData.get("memoryTags") ?? ""),
              entities: String(formData.get("memoryEntities") ?? ""),
              audiences: String(formData.get("memoryAudiences") ?? ""),
              stabilities: String(formData.get("memoryStabilities") ?? ""),
              instructions: String(formData.get("memoryInstructions") ?? ""),
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        profile?: AgentProfileRecord;
        error?: string;
      } | null;
      if (!response.ok || !payload?.profile)
        throw new Error(payload?.error || "Could not update Agent Profile");
      setProfile(payload.profile);
      setNotice(
        `Saved as profile version ${payload.profile.version}. Existing sessions retain their recorded version.`,
      );
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not update Agent Profile",
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) return;
    setUploadingAvatar(true);
    setNotice(null);
    try {
      const payloadBody = new FormData();
      payloadBody.set("file", file);
      const response = await fetch(
        `/admin/agent-profiles/${encodeURIComponent(profile.key)}/avatar`,
        { method: "POST", body: payloadBody },
      );
      const payload = (await response.json().catch(() => null)) as {
        profile?: AgentProfileRecord;
        error?: string;
      } | null;
      if (!response.ok || !payload?.profile)
        throw new Error(payload?.error || "Could not upload agent avatar");
      setProfile(payload.profile);
      setNotice(
        `Avatar uploaded and saved as profile version ${payload.profile.version}.`,
      );
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not upload agent avatar",
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (memorySessionId) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
          <AgentAvatar
            name={profile.name}
            avatarUrl={profile.avatarUrl}
            accentColor={profile.accentColor}
            className="h-10 w-10"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1
                className="truncate font-semibold"
                style={{ color: `color-mix(in oklab, ${profile.accentColor} 72%, var(--foreground))` }}
              >
                {profile.name}
              </h1>
              <Badge variant="outline">Memory read-only</Badge>
              <Badge variant="outline">v{profile.version}</Badge>
              {profile.modelTier ? <Badge variant="outline">{profile.modelTier}</Badge> : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              Selected Memory context · observable agent session
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/lab/memory">Back to Memory</Link>
          </Button>
        </header>
        <section aria-label={`${profile.name} Memory conversation`}>
          <CodexConsole
            key={`${profile.key}:${memorySessionId}`}
            isActive
            agentProfileKey={profile.key}
            executionMode="worker"
            configuredRuntimeKey={profile.runtimeProfileKey}
            configuredProfileVersion={profile.version}
            consoleFirstLayout
            initialSessionId={memorySessionId}
            readOnlyMemory
          />
        </section>
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)]">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
        <AgentAvatar
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          accentColor={profile.accentColor}
          className="h-10 w-10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1
              className="truncate text-base font-semibold sm:text-lg"
              style={{ color: `color-mix(in oklab, ${profile.accentColor} 72%, var(--foreground))` }}
            >
              {profile.name}
            </h1>
            {profile.systemKey === "admin-agent" ? <Badge>Admin</Badge> : null}
            <Badge variant="outline">v{profile.version}</Badge>
            {profile.modelTier ? <Badge variant="outline">{profile.modelTier}</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {profile.description || "No agent mandate recorded"}
          </p>
        </div>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Agent workspace mode"
        >
          <Button
            type="button"
            size="sm"
            variant={mode === "console" ? "secondary" : "ghost"}
            onClick={() => setMode("console")}
          >
            <MessageSquareText />
            Console
          </Button>
          {canRunAgent ? (
            <Button
              type="button"
              size="sm"
              variant={mode === "capture" ? "secondary" : "ghost"}
              onClick={() => setMode("capture")}
            >
              <AudioLines />
              Capture
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setInspectorOpen(true)}
          aria-expanded={inspectorOpen}
          aria-controls="agent-inspector"
          aria-label="Open agent inspector"
        >
          <PanelRight />
        </Button>
      </header>

      {mode === "console" ? (
        <section
          aria-label={`${profile.name} console`}
          className="min-h-[calc(100vh-7.5rem)]"
        >
          {canRunAgent ? (
            <CodexConsole
              key={profile.key}
              isActive
              agentProfileKey={profile.key}
              executionMode={
                profile.systemKey === "admin-agent"
                  ? "orchestrator"
                  : profile.systemKey === "code-review-agent"
                    ? "reviewer"
                    : profile.systemKey === "verification-agent"
                      ? "verifier"
                      : "worker"
              }
              configuredRuntimeKey={profile.runtimeProfileKey}
              configuredProfileVersion={profile.version}
              consoleFirstLayout
            />
          ) : (
            <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center p-6 text-center">
              <MessageSquareText className="h-8 w-8 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">
                Read-only agent conversations
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Select Memory or knowledge in the Memory Explorer, then choose
                this agent. Operational Console execution requires additional
                permission.
              </p>
              <Button asChild className="mt-5">
                <Link href="/admin/lab/memory">Open Memory Explorer</Link>
              </Button>
            </div>
          )}
        </section>
      ) : (
        <section
          aria-label={`${profile.name} capture workspace`}
          className="p-4 sm:p-6"
        >
          <div className="mb-4">
            <h2 className="font-semibold">
              Capture context for {profile.name}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Record and transcribe workspace context, then bring the durable
              result into this agent’s console.
            </p>
          </div>
          <CaptureWorkspace />
        </section>
      )}

      {inspectorOpen ? (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setInspectorOpen(false)}
            aria-label="Close agent inspector"
          />
          <aside
            id="agent-inspector"
            aria-label={`${profile.name} inspector`}
            className="absolute inset-y-0 right-0 flex w-[30rem] max-w-[94vw] flex-col border-l border-border bg-background shadow-2xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-border/60 px-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Agent inspector</h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setInspectorOpen(false)}
                aria-label="Close agent inspector"
              >
                <X />
              </Button>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto p-4">
              <section>
                <div className="flex items-center gap-2">
                  <AgentAvatar
                    name={profile.name}
                    avatarUrl={profile.avatarUrl}
                    accentColor={profile.accentColor}
                  />
                  <div>
                    <div className="font-medium">{profile.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {profile.key} · version {profile.version}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="border border-border/60 p-2">
                    <span className="text-muted-foreground">Sessions</span>
                    <div className="mt-1 text-sm font-medium">
                      {sessions.length}
                    </div>
                  </div>
                  <div className="border border-border/60 p-2">
                    <span className="text-muted-foreground">Activity</span>
                    <div className="mt-1 text-sm font-medium">
                      {activity.length}
                    </div>
                  </div>
                </div>
              </section>
              <section>
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  <h3 className="text-sm font-semibold">Profile and persona</h3>
                </div>
                {canManageSettings ? (
                  <div className="mt-3 space-y-4">
                    <form
                      action={uploadAvatar}
                      className="space-y-2 border border-border/60 p-3"
                    >
                      <Label htmlFor="agent-avatar-file">Upload avatar</Label>
                      <Input
                        id="agent-avatar-file"
                        name="file"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        required
                      />
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[0.68rem] text-muted-foreground">
                          PNG, JPEG, WebP, or GIF · 5 MB maximum
                        </p>
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          disabled={uploadingAvatar}
                        >
                          {uploadingAvatar ? (
                            <Loader2 className="animate-spin" />
                          ) : null}
                          {uploadingAvatar ? "Uploading" : "Upload"}
                        </Button>
                      </div>
                    </form>
                    <form action={saveProfile} className="space-y-3">
                      <div>
                        <Label htmlFor="agent-name">Name</Label>
                        <Input
                          id="agent-name"
                          name="name"
                          defaultValue={profile.name}
                          required
                          maxLength={160}
                        />
                      </div>
                      <div>
                        <Label htmlFor="agent-avatar">Avatar URL</Label>
                        <Input
                          id="agent-avatar"
                          name="avatarUrl"
                          defaultValue={profile.avatarUrl ?? ""}
                          placeholder="Or use an HTTPS or Site-relative URL"
                        />
                      </div>
                      <fieldset>
                        <legend className="text-sm font-medium">
                          Agent color
                        </legend>
                        <div
                          className="mt-2 grid grid-cols-4 gap-2"
                          role="radiogroup"
                          aria-label="Agent color"
                        >
                          {agentAccentPalette.map((color) => (
                            <label key={color.value} className="cursor-pointer">
                              <input
                                type="radio"
                                name="accentColor"
                                value={color.value}
                                defaultChecked={
                                  profile.accentColor === color.value
                                }
                                className="peer sr-only"
                              />
                              <span
                                className="flex min-h-10 items-center justify-center rounded-md border border-border/70 text-[0.65rem] font-semibold peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-checked:ring-2"
                                style={{
                                  color: color.value,
                                  backgroundColor: `${color.value}14`,
                                  borderColor: color.value,
                                }}
                              >
                                {color.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <div>
                        <Label htmlFor="agent-description">Mandate</Label>
                        <Textarea
                          id="agent-description"
                          name="description"
                          defaultValue={profile.description ?? ""}
                          rows={3}
                          maxLength={2000}
                        />
                      </div>
                      <div>
                        <Label htmlFor="agent-persona">
                          Persona instructions
                        </Label>
                        <Textarea
                          id="agent-persona"
                          name="personaInstructions"
                          defaultValue={
                            typeof profile.persona.instructions === "string"
                              ? profile.persona.instructions
                              : ""
                          }
                          rows={7}
                          maxLength={20000}
                        />
                      </div>
                      <div>
                        <Label htmlFor="agent-runtime">
                          Runtime profile key
                        </Label>
                        <Input
                          id="agent-runtime"
                          name="runtimeProfileKey"
                          defaultValue={profile.runtimeProfileKey ?? ""}
                          placeholder="Default runtime"
                        />
                      </div>
                      <div>
                        <Label htmlFor="agent-model-tier">Default model tier</Label>
                        <select
                          id="agent-model-tier"
                          name="modelTier"
                          defaultValue={profile.modelTier ?? ""}
                          className="flex h-10 w-full border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Site default</option>
                          <option value="economy">Economy</option>
                          <option value="standard">Standard</option>
                          <option value="deep">Deep</option>
                        </select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          A workflow step or scheduled task can explicitly override this tier.
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="agent-skills">Skills</Label>
                        <Input
                          id="agent-skills"
                          name="skills"
                          defaultValue={profile.skills.join(", ")}
                          placeholder="skill-one, skill-two"
                        />
                      </div>
                      <fieldset className="space-y-3 border border-border/60 p-3">
                        <legend className="px-1 text-xs font-semibold">
                          Memory scope
                        </legend>
                        <div>
                          <Label htmlFor="agent-memory-mode">Scope mode</Label>
                          <Input
                            id="agent-memory-mode"
                            name="memoryScopeMode"
                            defaultValue={
                              typeof profile.memoryScope.scope === "string"
                                ? profile.memoryScope.scope
                                : ""
                            }
                            placeholder="Scoped by default; workspace-read for governed all-memory access"
                          />
                        </div>
                        <div>
                          <Label htmlFor="agent-memory-buckets">
                            Rolling buckets
                          </Label>
                          <Input
                            id="agent-memory-buckets"
                            name="memoryBuckets"
                            defaultValue={
                              Array.isArray(profile.memoryScope.buckets)
                                ? profile.memoryScope.buckets.join(", ")
                                : ""
                            }
                            placeholder="meetings, ops, projects"
                          />
                        </div>
                        <div>
                          <Label htmlFor="agent-memory-sources">
                            Knowledge source IDs
                          </Label>
                          <Input
                            id="agent-memory-sources"
                            name="memorySources"
                            defaultValue={
                              Array.isArray(
                                profile.memoryScope.knowledgeSourceIds,
                              )
                                ? profile.memoryScope.knowledgeSourceIds.join(
                                    ", ",
                                  )
                                : ""
                            }
                            placeholder="handbook, product-docs"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            ["Kinds", "memoryKinds", "kinds"],
                            ["Tags", "memoryTags", "tags"],
                            ["Entities", "memoryEntities", "entities"],
                            ["Audiences", "memoryAudiences", "audiences"],
                            ["Stability", "memoryStabilities", "stabilities"],
                          ].map(([label, name, key]) => (
                            <div key={name}>
                              <Label htmlFor={`agent-${name}`}>{label}</Label>
                              <Input
                                id={`agent-${name}`}
                                name={name}
                                defaultValue={
                                  Array.isArray(profile.memoryScope[key])
                                    ? (profile.memoryScope[key] as unknown[])
                                        .filter(
                                          (value): value is string =>
                                            typeof value === "string",
                                        )
                                        .join(", ")
                                    : ""
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <div>
                          <Label htmlFor="agent-memory-instructions">
                            Retrieval instructions
                          </Label>
                          <Textarea
                            id="agent-memory-instructions"
                            name="memoryInstructions"
                            defaultValue={
                              typeof profile.memoryScope.instructions ===
                              "string"
                                ? profile.memoryScope.instructions
                                : ""
                            }
                            rows={3}
                            maxLength={10000}
                          />
                        </div>
                        <p className="text-[0.68rem] text-muted-foreground">
                          Empty or malformed scopes fail closed. Workspace-wide
                          scope should be reserved for governed agents.
                        </p>
                      </fieldset>
                      {notice ? (
                        <p
                          className="text-xs text-muted-foreground"
                          role="status"
                        >
                          {notice}
                        </p>
                      ) : null}
                      <Button type="submit" size="sm" disabled={saving}>
                        {saving ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Save />
                        )}
                        {saving ? "Saving" : "Save profile"}
                      </Button>
                    </form>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    You can inspect this profile but need settings permission to
                    edit it.
                  </p>
                )}
              </section>
              <section id="bindings">
                <div className="flex items-center gap-2">
                  <Cable className="h-4 w-4" />
                  <h3 className="text-sm font-semibold">Surfaces</h3>
                </div>
                <div className="mt-2 divide-y divide-border/60 border border-border/60">
                  <div className="p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="font-medium">Prism Console</span>
                      <Badge>full</Badge>
                    </div>
                  </div>
                  {profile.bindings.map((binding) => (
                    <div key={binding.id} className="p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {binding.label || binding.surfaceKey}
                        </span>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{binding.surfaceType}</Badge>
                          <Badge variant={binding.enabled ? "default" : "outline"}>{binding.enabled ? "active" : "disabled"}</Badge>
                        </div>
                      </div>
                      <div className="mt-1 truncate font-mono text-muted-foreground">
                        {binding.surfaceKey}
                      </div>
                      {canManageSettings ? <AgentBindingToggle profileKey={profile.key} bindingId={binding.id} enabled={binding.enabled} /> : null}
                    </div>
                  ))}
                </div>
                {canManageSettings ? (
                  <div className="mt-3">
                    <AgentBindingForm profileKey={profile.key} />
                  </div>
                ) : null}
              </section>
              <section>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  <h3 className="text-sm font-semibold">Recent activity</h3>
                </div>
                <div className="mt-2 divide-y divide-border/60 border border-border/60">
                  {activity.slice(0, 12).map((item) => (
                    <div key={item.id} className="p-3 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{item.title}</span>
                        <Badge variant="outline">{item.status}</Badge>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {item.description} · {formatDate(item.occurredAt)}
                      </div>
                      {item.sessionId ? (
                        <Link
                          className="mt-1 inline-block underline"
                          href={`/admin/lab/agents/${encodeURIComponent(profile.key)}/sessions/${encodeURIComponent(item.sessionId)}`}
                        >
                          Open transcript
                        </Link>
                      ) : null}
                    </div>
                  ))}
                  {activity.length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">
                      No attributed activity yet.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
