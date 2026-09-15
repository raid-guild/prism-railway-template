"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowUpCircle,
  Bot,
  Boxes,
  CheckCircle2,
  GitBranch,
  KeyRound,
  Pencil,
  Plus,
  Power,
  Save,
  ShieldAlert,
  UserPlus,
  Users,
  Palette,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GatewaySettings } from "@/components/admin/gateway-settings";
import { RuntimeSettings } from "@/components/admin/runtime-settings";
import { ExternalInterfaceSettings } from "@/components/admin/external-interface-settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdminSetupStatus,
  TargetAppRecord,
  TargetEnvironmentRecord,
} from "@/lib/admin";
import type { PrismUpdateStatus } from "@/lib/prism-version";
import type { Capability, RoleSlug } from "@/lib/role-access";

type AdminMember = {
  id: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  isBanned: boolean;
  isSeeded: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  pointsTotal: number;
  roleSlugs: RoleSlug[];
};

type AdminBranding = {
  brandName: string;
  logoUrl: string;
  logoAlt: string;
  workspaceLabel: string;
};

type SourceAdapterAccessMode = "off" | "readonly" | "run-approved" | "full";

type SourceAdapterPolicyRule = {
  mode?: SourceAdapterAccessMode;
  capabilities?: string[];
  rateLimit?: {
    windowSeconds?: number;
    maxRequests?: number;
  };
};

type SourceAdapterPlatformPolicy = {
  defaultMode: SourceAdapterAccessMode;
  defaultRateLimit: {
    windowSeconds: number;
    maxRequests: number;
  };
  targets: Record<string, SourceAdapterPolicyRule>;
  groups: Record<string, SourceAdapterPolicyRule>;
  users: Record<string, SourceAdapterPolicyRule>;
};

type SourceAdapterPolicySettings = {
  platforms: Record<string, SourceAdapterPlatformPolicy>;
};

type SettingsView = "status" | "config" | "interfaces" | "runtimes" | "gateway" | "docs";

type RepositoryTargetDraft = {
  name: string;
  repoUrl: string;
  defaultBranch: string;
  description: string;
  agentEnabled: boolean;
  defaultEnvironmentId: string;
};

const settingsViewOptions: Array<{
  value: SettingsView;
  label: string;
  title: string;
  description: string;
}> = [
  {
    value: "status",
    label: "Status",
    title: "Operational Status",
    description: "Runtime, memory, and target readiness for agent work.",
  },
  {
    value: "config",
    label: "Configuration",
    title: "Admin Configuration",
    description:
      "Instance identity, access policy, repository targets, and members.",
  },
  {
    value: "interfaces",
    label: "Interfaces",
    title: "External Interfaces",
    description: "Inbound interaction paths, credentials, policy profiles, and recent access activity.",
  },
  {
    value: "runtimes",
    label: "Runtimes",
    title: "Runtime Profiles",
    description: "Default routing, adapter health, and supported runtime features.",
  },
  {
    value: "gateway",
    label: "Gateway",
    title: "Gateway",
    description: "Encrypted credentials, reusable configuration, and audit history.",
  },
  {
    value: "docs",
    label: "Docs",
    title: "Documentation",
    description:
      "Environment setup notes for services that still require Railway variables.",
  },
];

function isSettingsView(value: string | null): value is SettingsView {
  return (
    value === "status" ||
    value === "config" ||
    value === "interfaces" ||
    value === "runtimes" ||
    value === "gateway" ||
    value === "docs"
  );
}

const managedRoleOptions: Array<{
  value: RoleSlug;
  label: string;
  description: string;
}> = [
  {
    value: "admin",
    label: "Admin",
    description: "Full instance ownership controls.",
  },
  {
    value: "moderator",
    label: "Moderator",
    description: "Operational workspace controls.",
  },
  {
    value: "member",
    label: "Member",
    description: "Read-mostly workspace access.",
  },
];

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusBadge(ok: boolean, label?: string) {
  return (
    <Badge
      variant={ok ? "secondary" : "muted"}
      className={
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : undefined
      }
    >
      {ok ? (label ?? "Ready") : (label ?? "Needs setup")}
    </Badge>
  );
}

function copyBlock(lines: string[]) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
      {lines.join("\n")}
    </pre>
  );
}

function SettingsSectionHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {icon}
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SettingsViewHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SetupStatus({
  setup,
  updateStatus,
}: {
  setup: AdminSetupStatus;
  updateStatus: PrismUpdateStatus;
}) {
  const targetsReady =
    setup.targets.targetAppCount > 0 &&
    setup.targets.targetEnvironmentCount > 0;

  return (
    <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          System Readiness
        </CardTitle>
        <CardDescription>
          Current health signals for the services that support agent work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-none border border-border/70 bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <ArrowUpCircle className="h-4 w-4" />
                  Prism Version
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {updateStatus.currentVersion}
                  {updateStatus.buildSha
                    ? ` · ${updateStatus.buildSha.slice(0, 7)}`
                    : ""}
                </p>
              </div>
              <Badge
                variant="secondary"
                className={
                  updateStatus.state === "update_available"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : updateStatus.state === "current"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : undefined
                }
              >
                {updateStatus.state === "update_available"
                  ? updateStatus.updateReason === "version"
                    ? `${updateStatus.latestVersion} available`
                    : "New build available"
                  : updateStatus.state === "current"
                    ? "Current"
                    : updateStatus.state === "newer"
                      ? "Development build"
                      : "Check unavailable"}
              </Badge>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {updateStatus.repository}@{updateStatus.branch}
            </p>
            {updateStatus.state === "update_available" ? (
              <a
                href={updateStatus.changesUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
              >
                Review changes before updating
              </a>
            ) : null}
          </div>

          <div className="rounded-none border border-border/70 bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <Activity className="h-4 w-4" />
                  Prism Memory
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Space: {setup.prismMemory.space ?? "unknown"}
                </p>
              </div>
              {statusBadge(setup.prismMemory.reachable)}
            </div>
            {setup.prismMemory.error ? (
              <p className="mt-3 text-sm text-destructive">
                {setup.prismMemory.error}
              </p>
            ) : null}
          </div>

          <div className="rounded-none border border-border/70 bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <Bot className="h-4 w-4" />
                  Codex Runtime
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Home: {setup.codexRuntime.codexHome ?? "not reported"}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {statusBadge(
                  setup.codexRuntime.reachable,
                  setup.codexRuntime.reachable ? "Reachable" : "Unreachable",
                )}
                {statusBadge(
                  setup.codexRuntime.codexAuthConfigured,
                  setup.codexRuntime.codexAuthConfigured
                    ? "Auth configured"
                    : "Auth needed",
                )}
              </div>
            </div>
          </div>

          <div className="rounded-none border border-border/70 bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <GitBranch className="h-4 w-4" />
                  Target Repos
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {setup.targets.targetAppCount} apps /{" "}
                  {setup.targets.targetEnvironmentCount} envs
                </p>
              </div>
              {statusBadge(targetsReady)}
            </div>
          </div>
        </div>

        {!setup.codexRuntime.codexAuthConfigured ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">
              Codex device auth setup command
            </p>
            {copyBlock([
              "railway ssh -s codex-runtime",
              "mkdir -p /data/codex",
              "export CODEX_HOME=/data/codex",
              'export PATH="/app/node_modules/.bin:$PATH"',
              "codex login --device-auth",
            ])}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EnvironmentInstructions() {
  const serviceLabel = (name: string) => (
    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      Railway service: {name}
    </p>
  );

  return (
    <section className="grid gap-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <KeyRound className="h-4 w-4" />
          Service Setup
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Copy reference values into the owning service environment when needed.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-1 xl:grid-cols-2">
        <div className="grid gap-3 rounded-none border border-border/60 p-4">
          <div>
            <h4 className="font-medium">Communication Adapter</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Telegram only needs a bot token for first setup. Discord needs
              bot, guild, and application credentials.
            </p>
          </div>
          <div>
            {serviceLabel("communication adapter")}
            {copyBlock([
              'TELEGRAM_BOT_TOKEN=""',
              'DISCORD_BOT_TOKEN=""',
              'DISCORD_GUILD_ID=""',
              'DISCORD_APPLICATION_ID=""',
            ])}
          </div>
        </div>

        <div className="grid gap-3 rounded-none border border-border/60 p-4">
          <div>
            <h4 className="font-medium">Discord Memory Buckets</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Inspect live Discord categories before enabling recurring sync.
            </p>
          </div>
          <div>
            {serviceLabel("communication adapter and prism-memory")}
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                Use the communication adapter inventory endpoint to inspect
                Discord categories, then map category IDs to Prism Memory
                buckets.
              </p>
              <p>
                If messages were collected before the mapping was corrected, run
                <code> /ops/memory/repair-discord-buckets</code> with
                <code> dry_run:true</code>, then rerun with
                <code> rebuild:true</code>.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-none border border-border/60 p-4 xl:col-span-2">
          <div>
            <h4 className="font-medium">Capture & Recording</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Browser capture, Discord native recording, transcription, and
              live recap need env on the service that performs the work.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              {serviceLabel("site")}
              <div className="mb-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>
                  Required for browser capture transcription. Required for
                  browser capture recap and summary generation when those
                  actions call the selected runtime profile.
                </p>
                <p>
                  External capture dispatch has a bounded timeout by default;
                  override it only for slow trusted receivers.
                </p>
              </div>
              {copyBlock([
                'VOICE_TRANSCRIPTION_BASE_URL="https://api.venice.ai/api/v1/audio/transcriptions"',
                'VOICE_TRANSCRIPTION_API_KEY=""',
                'VOICE_TRANSCRIPTION_MODEL="nvidia/parakeet-tdt-0.6b-v3"',
                'VOICE_TRANSCRIPTION_LANGUAGE="en"',
                'VOICE_TRANSCRIPTION_RESPONSE_FORMAT="json"',
                'VOICE_TRANSCRIPTION_TIMESTAMPS="true"',
                'CODEX_RUNTIME_BASE_URL=""',
                'CAPTURE_DISPATCH_EXTERNAL_TIMEOUT_MS="10000"',
              ])}
            </div>
            <div>
              {serviceLabel("communication adapter")}
              <div className="mb-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>
                  Required for Discord native recording transcription and
                  <code> /prism-recap</code>. The transcript-completed hook key
                  defaults to the built-in Prism hook when unset.
                </p>
                <p>
                  Summary generation and summary Memory promotion default on.
                  After summary generation succeeds, the hook sends summary
                  content and transcript references instead of the full body.
                </p>
              </div>
              {copyBlock([
                'VOICE_DAVE_ENCRYPTION="true"',
                'VOICE_RECORDING_WARNING_MINUTES="50"',
                'VOICE_RECORDING_MAX_MINUTES="60"',
                'VOICE_TRANSCRIPTION_BASE_URL="https://api.venice.ai/api/v1/audio/transcriptions"',
                'VOICE_TRANSCRIPTION_API_KEY=""',
                'VOICE_TRANSCRIPTION_MODEL="nvidia/parakeet-tdt-0.6b-v3"',
                'VOICE_TRANSCRIPTION_LANGUAGE="en"',
                'VOICE_TRANSCRIPTION_RESPONSE_FORMAT="json"',
                'VOICE_TRANSCRIPTION_TIMESTAMPS="true"',
                'DISCORD_RECORDING_COMPLETE_HOOK_KEY="recording-transcript-completed"',
                'DISCORD_RECORDING_COMPLETE_HOOK_ENABLED="true"',
              ])}
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-none border border-border/60 p-4">
          <div>
            <h4 className="font-medium">GitHub Push Access</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Only needed for private repositories or branch pushes.
            </p>
          </div>
          <div>
            {serviceLabel("codex-runtime")}
            {copyBlock(['TARGET_REPO_GITHUB_TOKEN=""'])}
          </div>
        </div>
      </div>
    </section>
  );
}

function BrandingSettings({
  branding,
  onBrandingChange,
}: {
  branding: AdminBranding;
  onBrandingChange: (branding: AdminBranding) => void;
}) {
  const [draft, setDraft] = useState(branding);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDraft(branding);
  }, [branding]);

  function saveBranding() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/admin/branding", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          branding?: AdminBranding;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not save branding");
        }
        if (payload.branding) {
          const nextBranding = {
            brandName: payload.branding.brandName,
            logoUrl: payload.branding.logoUrl,
            logoAlt: payload.branding.logoAlt,
            workspaceLabel: payload.branding.workspaceLabel,
          };
          setDraft(nextBranding);
          onBrandingChange(nextBranding);
        }
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save branding",
        );
      }
    });
  }

  return (
    <section className="grid gap-4">
      <SettingsSectionHeader
        icon={<Palette className="h-4 w-4" />}
        title="Instance Branding"
        description="Set the header name, workspace label, and logo for this instance."
      />
      {error ? (
        <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-none border border-border/70 bg-muted/40">
          {draft.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.logoUrl}
              alt={draft.logoAlt || "Logo preview"}
              className="h-full w-full object-contain p-1"
            />
          ) : (
            <Palette className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input
              id="brand-name"
              value={draft.brandName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  brandName: event.target.value,
                }))
              }
              placeholder="Prism Refactory"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-label">Workspace label</Label>
            <Input
              id="workspace-label"
              value={draft.workspaceLabel}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  workspaceLabel: event.target.value,
                }))
              }
              placeholder="Admin workspace"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="logo-url">Logo URL</Label>
            <Input
              id="logo-url"
              value={draft.logoUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  logoUrl: event.target.value,
                }))
              }
              placeholder="https://... or data:image/..."
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="logo-alt">Logo alt text</Label>
            <Input
              id="logo-alt"
              value={draft.logoAlt}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  logoAlt: event.target.value,
                }))
              }
              placeholder="Workspace logo"
            />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={saveBranding} disabled={isPending}>
          Save branding
        </Button>
      </div>
    </section>
  );
}

const accessModeOptions: Array<{
  value: SourceAdapterAccessMode;
  label: string;
  description: string;
}> = [
  { value: "off", label: "Off", description: "Do not answer in this surface." },
  {
    value: "readonly",
    label: "Readonly",
    description: "Answer questions and read context only.",
  },
  {
    value: "run-approved",
    label: "Run approved",
    description: "Run existing approved tasks and workflows.",
  },
  {
    value: "full",
    label: "Full",
    description: "Allow authoring and write actions through runtime policy.",
  },
];

const sourceAdapterPlatformProfiles: Record<
  string,
  {
    label: string;
    description: string;
    targetHelp: string;
    groupHelp: string;
    userHelp: string;
    promptHelp: string;
  }
> = {
  discord: {
    label: "Discord",
    description:
      "Controls who can use Prism through Discord mentions, slash-command chat, and channel/thread prompts.",
    targetHelp:
      "Discord channel or thread IDs. Use a channel for broad access, or a thread for narrower access.",
    groupHelp:
      "Discord role IDs. Role rules can grant moderators or trusted members higher access.",
    userHelp:
      "Discord user IDs. User rules override the default for specific operators.",
    promptHelp:
      "Discord responds when mentioned, used through configured slash commands, or invoked by workflow/task delivery.",
  },
  telegram: {
    label: "Telegram",
    description:
      "Controls who can use Prism through Telegram groups and channels discovered by the bot.",
    targetHelp:
      "Telegram chat, group, supergroup, or channel IDs. Groups usually look like negative IDs such as -1001234567890.",
    groupHelp:
      "Not used by Telegram yet. Keep this empty unless a future adapter adds group metadata.",
    userHelp:
      "Telegram user IDs. Use these for trusted operators when the group default is more limited.",
    promptHelp:
      "Telegram group chat responds to /prism, /superprism, or bot mentions. DMs are disabled by adapter config unless explicitly enabled.",
  },
};

function sourceAdapterPlatformProfile(platform: string) {
  return (
    sourceAdapterPlatformProfiles[platform] ?? {
      label: platform,
      description: "Controls source-adapter chat access for this platform.",
      targetHelp: "Conversation surface IDs for this platform.",
      groupHelp: "Platform group or role IDs when supported.",
      userHelp: "Platform user IDs.",
      promptHelp:
        "Prompt routing depends on the adapter implementation for this platform.",
    }
  );
}

function formatPolicyMap(value: Record<string, SourceAdapterPolicyRule>) {
  return JSON.stringify(value, null, 2);
}

function parsePolicyMap(
  value: string,
  label: string,
): Record<string, SourceAdapterPolicyRule> {
  const parsed = value.trim() ? JSON.parse(value) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, SourceAdapterPolicyRule>;
}

function SourceAdapterPolicySettings() {
  const [policy, setPolicy] = useState<SourceAdapterPolicySettings | null>(
    null,
  );
  const [targetsJson, setTargetsJson] = useState("{}");
  const [groupsJson, setGroupsJson] = useState("{}");
  const [usersJson, setUsersJson] = useState("{}");
  const [selectedPlatform, setSelectedPlatform] = useState("discord");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const platformPolicy = policy?.platforms[selectedPlatform];
  const platformOptions = Object.keys(policy?.platforms ?? {}).sort();
  const platformProfile = sourceAdapterPlatformProfile(selectedPlatform);

  useEffect(() => {
    let cancelled = false;
    async function loadPolicy() {
      try {
        const response = await fetch("/admin/source-adapter-policy", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          policy?: SourceAdapterPolicySettings;
          error?: string;
        };
        if (!response.ok || payload.ok === false || !payload.policy) {
          throw new Error(
            payload.error || "Could not load source adapter policy",
          );
        }
        if (cancelled) return;
        setPolicy(payload.policy);
        const platform = payload.policy.platforms.discord
          ? "discord"
          : (Object.keys(payload.policy.platforms)[0] ?? "discord");
        setSelectedPlatform(platform);
        const currentPlatform = payload.policy.platforms[platform];
        setTargetsJson(formatPolicyMap(currentPlatform?.targets ?? {}));
        setGroupsJson(formatPolicyMap(currentPlatform?.groups ?? {}));
        setUsersJson(formatPolicyMap(currentPlatform?.users ?? {}));
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load source adapter policy",
          );
        }
      }
    }
    void loadPolicy();
    return () => {
      cancelled = true;
    };
  }, []);

  function updatePlatformPolicy(
    updater: (
      current: SourceAdapterPlatformPolicy,
    ) => SourceAdapterPlatformPolicy,
  ) {
    setPolicy((current) => {
      if (!current?.platforms[selectedPlatform]) {
        return current;
      }
      return {
        ...current,
        platforms: {
          ...current.platforms,
          [selectedPlatform]: updater(current.platforms[selectedPlatform]),
        },
      };
    });
  }

  function savePolicy() {
    if (!policy?.platforms[selectedPlatform]) return;
    setError(null);
    startTransition(async () => {
      try {
        const nextPolicy: SourceAdapterPolicySettings = {
          ...policy,
          platforms: {
            ...policy.platforms,
            [selectedPlatform]: {
              ...policy.platforms[selectedPlatform],
              targets: parsePolicyMap(targetsJson, "Targets"),
              groups: parsePolicyMap(groupsJson, "Groups"),
              users: parsePolicyMap(usersJson, "Users"),
            },
          },
        };
        const response = await fetch("/admin/source-adapter-policy", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ policy: nextPolicy }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          policy?: SourceAdapterPolicySettings;
          error?: string;
        };
        if (!response.ok || payload.ok === false || !payload.policy) {
          throw new Error(
            payload.error || "Could not save source adapter policy",
          );
        }
        setPolicy(payload.policy);
        const savedPlatform = payload.policy.platforms[selectedPlatform];
        setTargetsJson(formatPolicyMap(savedPlatform?.targets ?? {}));
        setGroupsJson(formatPolicyMap(savedPlatform?.groups ?? {}));
        setUsersJson(formatPolicyMap(savedPlatform?.users ?? {}));
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save source adapter policy",
        );
      }
    });
  }

  return (
    <section className="grid gap-4 border-t border-border/60 pt-5">
      <SettingsSectionHeader
        icon={<ShieldAlert className="h-4 w-4" />}
        title="Source Adapter Access"
        description="Configure public chat access without changing environment variables or rebuilding services."
      />
      {error ? (
        <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {platformPolicy ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select
                value={selectedPlatform}
                onValueChange={(value) => {
                  setSelectedPlatform(value);
                  const nextPlatform = policy?.platforms[value];
                  setTargetsJson(formatPolicyMap(nextPlatform?.targets ?? {}));
                  setGroupsJson(formatPolicyMap(nextPlatform?.groups ?? {}));
                  setUsersJson(formatPolicyMap(nextPlatform?.users ?? {}));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {platformOptions.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {sourceAdapterPlatformProfile(platform).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {platformProfile.description}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Default mode</Label>
              <Select
                value={platformPolicy.defaultMode}
                onValueChange={(value) =>
                  updatePlatformPolicy((current) => ({
                    ...current,
                    defaultMode: value as SourceAdapterAccessMode,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accessModeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  accessModeOptions.find(
                    (option) => option.value === platformPolicy.defaultMode,
                  )?.description
                }
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-rate-window">Rate window seconds</Label>
              <Input
                id="source-rate-window"
                type="number"
                min={1}
                value={platformPolicy.defaultRateLimit.windowSeconds}
                onChange={(event) =>
                  updatePlatformPolicy((current) => ({
                    ...current,
                    defaultRateLimit: {
                      ...current.defaultRateLimit,
                      windowSeconds:
                        Number.parseInt(event.target.value, 10) ||
                        current.defaultRateLimit.windowSeconds,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-rate-max">Max requests</Label>
              <Input
                id="source-rate-max"
                type="number"
                min={1}
                value={platformPolicy.defaultRateLimit.maxRequests}
                onChange={(event) =>
                  updatePlatformPolicy((current) => ({
                    ...current,
                    defaultRateLimit: {
                      ...current.defaultRateLimit,
                      maxRequests:
                        Number.parseInt(event.target.value, 10) ||
                        current.defaultRateLimit.maxRequests,
                    },
                  }))
                }
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-none border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Default
              </div>
              <div className="mt-1 text-sm font-medium">
                {
                  accessModeOptions.find(
                    (option) => option.value === platformPolicy.defaultMode,
                  )?.label
                }
              </div>
            </div>
            <div className="rounded-none border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Target rules
              </div>
              <div className="mt-1 text-sm font-medium">
                {Object.keys(platformPolicy.targets).length}
              </div>
            </div>
            <div className="rounded-none border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Group rules
              </div>
              <div className="mt-1 text-sm font-medium">
                {Object.keys(platformPolicy.groups).length}
              </div>
            </div>
            <div className="rounded-none border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                User rules
              </div>
              <div className="mt-1 text-sm font-medium">
                {Object.keys(platformPolicy.users).length}
              </div>
            </div>
          </div>
          <div className="rounded-none border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
            {platformProfile.promptHelp}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="source-target-rules">Targets</Label>
              <Textarea
                id="source-target-rules"
                className="min-h-40 font-mono text-xs"
                value={targetsJson}
                onChange={(event) => setTargetsJson(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {platformProfile.targetHelp}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-group-rules">Groups</Label>
              <Textarea
                id="source-group-rules"
                className="min-h-40 font-mono text-xs"
                value={groupsJson}
                onChange={(event) => setGroupsJson(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {platformProfile.groupHelp}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-user-rules">Users</Label>
              <Textarea
                id="source-user-rules"
                className="min-h-40 font-mono text-xs"
                value={usersJson}
                onChange={(event) => setUsersJson(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {platformProfile.userHelp}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={savePolicy} disabled={isPending}>
              Save source policy
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-none border border-border/60 px-4 py-3 text-sm text-muted-foreground">
          Loading source adapter policy.
        </div>
      )}
    </section>
  );
}

function MembersAndRoles({ canManageUsers }: { canManageUsers: boolean }) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<AdminMember | null>(null);
  const [editingRoles, setEditingRoles] = useState<RoleSlug[]>([]);
  const [claimLink, setClaimLink] = useState<{
    label: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadMembers = useCallback(async () => {
    if (!canManageUsers) return;
    try {
      const response = await fetch("/admin/members", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        users?: AdminMember[];
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not load members");
      }
      setMembers(payload.users ?? []);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load members",
      );
    }
  }, [canManageUsers]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  function saveMemberRoles(member: AdminMember, roleSlugs: RoleSlug[]) {
    const normalizedRoles = roleSlugs.length ? roleSlugs : ["member" as const];
    startTransition(async () => {
      try {
        const response = await fetch("/admin/members", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: member.id,
            roleSlugs: normalizedRoles,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not update roles");
        }
        setEditingMember(null);
        await loadMembers();
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : "Could not update roles",
        );
      }
    });
  }

  function openEditRoles(member: AdminMember) {
    setError(null);
    setEditingMember(member);
    setEditingRoles(member.roleSlugs);
  }

  function toggleEditingRole(role: RoleSlug) {
    setEditingRoles((current) =>
      current.includes(role)
        ? current.filter((value) => value !== role)
        : [...current, role],
    );
  }

  function createMember() {
    const email = newEmail.trim();
    if (!email) {
      setError("Email is required");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/admin/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            displayName: newDisplayName.trim() || null,
            roleSlugs: ["member"],
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          invite?: { claimUrl?: string; expiresAt?: string };
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not create member");
        }
        setNewEmail("");
        setNewDisplayName("");
        setIsAddMemberOpen(false);
        if (payload.invite?.claimUrl) {
          setClaimLink({
            label: "Invite link",
            url: payload.invite.claimUrl,
            expiresAt: payload.invite.expiresAt ?? "",
          });
        }
        await loadMembers();
      } catch (createError) {
        setError(
          createError instanceof Error
            ? createError.message
            : "Could not create member",
        );
      }
    });
  }

  function createResetLink(member: AdminMember) {
    startTransition(async () => {
      try {
        const response = await fetch("/admin/member-invites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: member.id,
            kind: "reset",
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          invite?: { claimUrl?: string; expiresAt?: string };
          error?: string;
        };
        if (!response.ok || payload.ok === false || !payload.invite?.claimUrl) {
          throw new Error(payload.error || "Could not create reset link");
        }
        setClaimLink({
          label: `Reset link for ${member.email ?? member.displayName ?? member.id}`,
          url: payload.invite.claimUrl,
          expiresAt: payload.invite.expiresAt ?? "",
        });
      } catch (resetError) {
        setError(
          resetError instanceof Error
            ? resetError.message
            : "Could not create reset link",
        );
      }
    });
  }

  if (!canManageUsers) {
    return (
      <section className="grid gap-4 border-t border-border/60 pt-5">
        <SettingsSectionHeader
          icon={<Users className="h-4 w-4" />}
          title="Members & Roles"
          description="Only admins can manage member roles."
        />
      </section>
    );
  }

  return (
    <>
      <section className="grid gap-4 border-t border-border/60 pt-5">
        <SettingsSectionHeader
          icon={<Users className="h-4 w-4" />}
          title="Members & Roles"
          description="Manage app roles and account claim/reset links for workspace users."
          action={
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setIsAddMemberOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4" />
              Add member
            </Button>
          }
        />
        <div className="space-y-5">
          {error ? (
            <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {claimLink ? (
            <div className="space-y-3 rounded-none border border-primary/40 bg-primary/5 p-4">
              <div>
                <p className="font-medium">{claimLink.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Copy this link manually. It expires{" "}
                  {formatDate(claimLink.expiresAt)}.
                </p>
              </div>
              <Input
                readOnly
                value={claimLink.url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          ) : null}

          <div className="rounded-none border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.displayName ||
                        member.handle ||
                        member.email ||
                        member.id}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email ?? "No email"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {member.roleSlugs.map((role) => (
                          <Badge
                            key={role}
                            variant={role === "admin" ? "secondary" : "outline"}
                          >
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={member.claimedAt ? "secondary" : "outline"}
                      >
                        {member.claimedAt ? "Claimed" : "Unclaimed"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(member.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openEditRoles(member)}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => createResetLink(member)}
                          disabled={isPending}
                        >
                          <KeyRound className="h-4 w-4" />
                          Reset
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!members.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No members found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <Dialog open={isAddMemberOpen} onOpenChange={setIsAddMemberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Create a managed account and generate an invite link.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="member@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-display-name">Display name</Label>
              <Input
                id="member-display-name"
                value={newDisplayName}
                onChange={(event) => setNewDisplayName(event.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddMemberOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={createMember} disabled={isPending}>
              Add member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingMember)}
        onOpenChange={(open) => {
          if (!open) setEditingMember(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit roles</DialogTitle>
            <DialogDescription>
              {editingMember?.email ??
                editingMember?.displayName ??
                editingMember?.id}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="grid gap-2">
            {managedRoleOptions.map((role) => (
              <label
                key={role.value}
                className="flex cursor-pointer items-start gap-3 rounded-none border border-border/70 p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={editingRoles.includes(role.value)}
                  onChange={() => toggleEditingRole(role.value)}
                  disabled={isPending}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">{role.label}</span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {role.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingMember(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                editingMember
                  ? saveMemberRoles(editingMember, editingRoles)
                  : null
              }
              disabled={isPending || !editingMember}
            >
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RepositorySetup({
  targetApps,
  targetEnvironments,
}: {
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [savingTargetId, setSavingTargetId] = useState<string | null>(null);
  const [isAddTargetOpen, setIsAddTargetOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<TargetAppRecord | null>(
    null,
  );
  const [editingDraft, setEditingDraft] =
    useState<RepositoryTargetDraft | null>(null);
  const [isPending, startTransition] = useTransition();

  function buildTargetDraft(targetApp: TargetAppRecord): RepositoryTargetDraft {
    const environments = targetEnvironments.filter(
      (environment) => environment.targetAppId === targetApp.id,
    );
    const defaultEnvironment =
      environments.find((environment) => environment.isDefaultForAgent) ??
      environments[0];

    return {
      name: targetApp.name,
      repoUrl: targetApp.repoUrl ?? "",
      defaultBranch:
        defaultEnvironment?.branch ?? targetApp.defaultBranch ?? "main",
      description: targetApp.description ?? "",
      agentEnabled: targetApp.agentEnabled,
      defaultEnvironmentId: defaultEnvironment?.id ?? "",
    };
  }

  function updateEditingDraft(patch: Partial<RepositoryTargetDraft>) {
    setEditingDraft((current) =>
      current
        ? {
            ...current,
            ...patch,
          }
        : current,
    );
  }

  function closeEditTarget() {
    setEditingTarget(null);
    setEditingDraft(null);
  }

  function saveTarget(targetApp: TargetAppRecord) {
    const draft = editingDraft;
    if (!draft) return;
    const name = draft.name.trim();
    const defaultBranch = draft.defaultBranch.trim();

    if (!name || !defaultBranch) {
      setError("Name and target branch are required.");
      return;
    }

    setError(null);
    setSavingTargetId(targetApp.id);
    startTransition(async () => {
      try {
        const targetResponse = await fetch(
          `/admin/target-apps/${targetApp.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              repoUrl: draft.repoUrl.trim() || null,
              defaultBranch,
              description: draft.description.trim() || null,
              agentEnabled: draft.agentEnabled,
            }),
          },
        );
        const targetPayload = (await targetResponse
          .json()
          .catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!targetResponse.ok || targetPayload.ok === false) {
          throw new Error(targetPayload.error || "Could not save target");
        }

        if (draft.defaultEnvironmentId) {
          const environmentResponse = await fetch(
            `/admin/target-environments/${draft.defaultEnvironmentId}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                branch: defaultBranch,
                isDefaultForAgent: true,
              }),
            },
          );
          const environmentPayload = (await environmentResponse
            .json()
            .catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
          };
          if (!environmentResponse.ok || environmentPayload.ok === false) {
            throw new Error(
              environmentPayload.error ||
                "Saved target, but could not update target branch",
            );
          }
        }

        window.location.reload();
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save target",
        );
        setSavingTargetId(null);
      }
    });
  }

  function openEditTarget(targetApp: TargetAppRecord) {
    setError(null);
    setSavingTargetId(null);
    setEditingDraft(buildTargetDraft(targetApp));
    setEditingTarget(targetApp);
  }

  return (
    <>
      <section className="grid gap-4 border-t border-border/60 pt-5">
        <SettingsSectionHeader
          icon={<GitBranch className="h-4 w-4" />}
          title="Repository Targets"
          description="Repositories and default environments available to change requests."
          action={
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setIsAddTargetOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add target
            </Button>
          }
        />
        {error ? (
          <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="rounded-none border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>Repo</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Environments</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targetApps.map((targetApp) => {
                const environments = targetEnvironments.filter(
                  (environment) => environment.targetAppId === targetApp.id,
                );
                const defaultEnvironment =
                  environments.find(
                    (environment) => environment.isDefaultForAgent,
                  ) ?? environments[0];
                const writableCount = environments.filter(
                  (environment) => environment.agentWritable,
                ).length;

                return (
                  <TableRow key={targetApp.id}>
                    <TableCell>
                      <div className="font-medium">{targetApp.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {targetApp.slug}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">
                      {targetApp.repoUrl ?? "No repo URL"}
                    </TableCell>
                    <TableCell>
                      {defaultEnvironment?.branch ??
                        targetApp.defaultBranch ??
                        "main"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          <Boxes className="mr-1 h-3 w-3" />
                          {environments.length}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {writableCount ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
                          )}
                          {writableCount} writable
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={targetApp.agentEnabled ? "secondary" : "muted"}
                      >
                        {targetApp.agentEnabled ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openEditTarget(targetApp)}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!targetApps.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No repository targets configured.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={isAddTargetOpen} onOpenChange={setIsAddTargetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add repository target</DialogTitle>
            <DialogDescription>
              Create one Codex target. Change request branches start from the
              target branch.
            </DialogDescription>
          </DialogHeader>
          <form
            action="/admin/target-apps"
            method="post"
            className="grid gap-4"
          >
            <div className="space-y-2">
              <Label htmlFor="new-target-name">Name</Label>
              <Input
                id="new-target-name"
                name="name"
                placeholder="DAOhaus Admin"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-target-repo">GitHub Repo URL</Label>
              <Input
                id="new-target-repo"
                name="repoUrl"
                placeholder="https://github.com/HausDAO/daohaus-admin.git"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-target-branch">Target Branch</Label>
              <Input
                id="new-target-branch"
                name="defaultBranch"
                defaultValue="main"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-target-description">Description</Label>
              <Textarea
                id="new-target-description"
                name="description"
                placeholder="What this target repo represents."
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddTargetOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                <Plus className="h-4 w-4" />
                Create target
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingTarget)}
        onOpenChange={(open) => {
          if (!open) closeEditTarget();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit repository target</DialogTitle>
            <DialogDescription>
              {editingTarget?.name ?? "Repository target"}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {editingTarget && editingDraft ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`target-name-${editingTarget.id}`}>
                    Name
                  </Label>
                  <Input
                    id={`target-name-${editingTarget.id}`}
                    value={editingDraft.name}
                    onChange={(event) =>
                      updateEditingDraft({
                        name: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`target-branch-${editingTarget.id}`}>
                    Target Branch
                  </Label>
                  <Input
                    id={`target-branch-${editingTarget.id}`}
                    value={editingDraft.defaultBranch}
                    onChange={(event) =>
                      updateEditingDraft({
                        defaultBranch: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`target-repo-${editingTarget.id}`}>
                    GitHub Repo URL
                  </Label>
                  <Input
                    id={`target-repo-${editingTarget.id}`}
                    value={editingDraft.repoUrl}
                    onChange={(event) =>
                      updateEditingDraft({
                        repoUrl: event.target.value,
                      })
                    }
                    placeholder="https://github.com/org/repo.git"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`target-description-${editingTarget.id}`}>
                    Description
                  </Label>
                  <Textarea
                    id={`target-description-${editingTarget.id}`}
                    value={editingDraft.description}
                    onChange={(event) =>
                      updateEditingDraft({
                        description: event.target.value,
                      })
                    }
                    placeholder="What this target repo represents."
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={editingDraft.agentEnabled}
                  onChange={(event) =>
                    updateEditingDraft({
                      agentEnabled: event.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-primary"
                />
                Available for new requests
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeEditTarget}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => (editingTarget ? saveTarget(editingTarget) : null)}
              disabled={
                !editingTarget ||
                !editingDraft ||
                (isPending && savingTargetId === editingTarget.id)
              }
            >
              {editingDraft?.agentEnabled ? (
                <Save className="h-4 w-4" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              Save target
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminSettingsWorkspace({
  setup,
  updateStatus,
  branding,
  onBrandingChange,
  targetApps,
  targetEnvironments,
  session,
}: {
  setup: AdminSetupStatus;
  updateStatus: PrismUpdateStatus;
  branding: AdminBranding;
  onBrandingChange: (branding: AdminBranding) => void;
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
  session: {
    capabilities: Capability[];
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManageUsers = session.capabilities.includes("canManageUsers");
  const settingsParam = searchParams.get("settings");
  const [activeView, setActiveView] = useState<SettingsView>(() =>
    isSettingsView(settingsParam) ? settingsParam : "status",
  );
  const activeViewMeta =
    settingsViewOptions.find((option) => option.value === activeView) ??
    settingsViewOptions[0];

  useEffect(() => {
    if (isSettingsView(settingsParam) && settingsParam !== activeView) {
      setActiveView(settingsParam);
    } else if (!settingsParam && activeView !== "status") {
      setActiveView("status");
    }
  }, [activeView, settingsParam]);

  function selectSettingsView(view: SettingsView) {
    setActiveView(view);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "settings");
    params.set("settings", view);
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="grid">
      <div className="border-b border-border/60 px-5 py-3 md:px-6">
        <div className="inline-flex h-auto flex-wrap bg-transparent p-0">
          {settingsViewOptions.map((option) => {
            const isActive = option.value === activeView;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => selectSettingsView(option.value)}
                className={[
                  "rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-border/70 bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <section className="grid gap-5 px-5 py-5 md:px-6">
        <SettingsViewHeader
          title={activeViewMeta.title}
          description={activeViewMeta.description}
        />

        {activeView === "status" ? (
          <SetupStatus setup={setup} updateStatus={updateStatus} />
        ) : null}

        {activeView === "config" ? (
          <div className="grid gap-5">
            <BrandingSettings
              branding={branding}
              onBrandingChange={onBrandingChange}
            />
            <MembersAndRoles canManageUsers={canManageUsers} />
            <RepositorySetup
              targetApps={targetApps}
              targetEnvironments={targetEnvironments}
            />
            <section className="grid gap-3 border-t border-border/60 pt-5">
              <SettingsSectionHeader icon={<ShieldAlert className="h-4 w-4" />} title="Communication access" description="Channel identity and access are now configured once on Site-owned Agent Profile bindings." />
              <div className="border border-primary/30 bg-primary/5 p-4 text-sm"><p>Discord, Buzz, and Telegram access is managed under Agents. Existing source-policy records are available only for one-time migration and rollback compatibility.</p><Button asChild variant="outline" size="sm" className="mt-3"><Link href="/admin/lab/agents">Open Agent Profiles</Link></Button></div>
            </section>
          </div>
        ) : null}

        {activeView === "gateway" ? <GatewaySettings /> : null}

        {activeView === "interfaces" ? <ExternalInterfaceSettings /> : null}

        {activeView === "runtimes" ? <RuntimeSettings /> : null}

        {activeView === "docs" ? <EnvironmentInstructions /> : null}
      </section>
    </div>
  );
}
