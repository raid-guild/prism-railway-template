"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Activity, ChevronDown, KeyRound, Plus, RefreshCw, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  gatewayImportableEnvNames,
  parseEnvText,
  protectedGatewayEnvNames,
} from "@/lib/gateway-env-import";

type GatewayCredential = {
  id: string;
  key: string;
  provider: string;
  label: string;
  authType: string;
  configuration: Record<string, string>;
  envBindings: Record<string, string>;
  status: string;
  secretNames: string[];
  lastUsedAt: string | null;
};

type GatewayAuditEvent = {
  id: string;
  traceId: string;
  credentialKey: string;
  authenticatedCallerId: string;
  status: string;
  policyDecision: string;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
};

type GatewayOverview = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  health?: { database?: { ok?: boolean; migrations?: number } };
  connections?: GatewayCredential[];
  auditEvents?: GatewayAuditEvent[];
};

type SecretField = { envName: string; secretName: string; value: string };
type ConfigurationField = { id: number; name: string; value: string };
type CredentialDraft = {
  label: string;
  authType: string;
  secrets: SecretField[];
  configuration: ConfigurationField[];
};

let nextConfigurationFieldId = 0;

function configurationField(name = "", value = ""): ConfigurationField {
  nextConfigurationFieldId += 1;
  return { id: nextConfigurationFieldId, name, value };
}

function secretTemplate(authType: string): SecretField[] {
  const names = authType === "basic"
    ? ["username", "password"]
    : authType === "key-pair"
      ? ["accessKey", "secretKey"]
      : authType === "oauth-1a"
        ? ["apiKey", "apiSecret", "accessToken", "accessTokenSecret"]
        : authType === "bearer"
          ? ["token"]
          : authType === "api-key"
            ? ["apiKey"]
            : ["secret"];
  return names.map((secretName) => ({ envName: "", secretName, value: "" }));
}

function secretPlaceholder(secretName: string) {
  return `SERVICE_${secretName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase()}`;
}

const credentialTypes = [
  ["api-key", "API key"],
  ["bearer", "Bearer token"],
  ["basic", "Username and password"],
  ["key-pair", "Key pair"],
  ["oauth-1a", "OAuth 1.0a"],
  ["custom", "Custom fields"],
] as const;

function emptyCredentialDraft(): CredentialDraft {
  return {
    label: "",
    authType: "api-key",
    secrets: secretTemplate("api-key"),
    configuration: [],
  };
}

function formatDate(value: string | null | undefined) {
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

function statusVariant(status: string) {
  if (["leased", "succeeded"].includes(status)) return "secondary" as const;
  if (status === "failed") return "destructive" as const;
  return "outline" as const;
}

function statusLabel(status: string) {
  if (status === "leased") return "Used";
  if (status === "untested") return "Not used";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function adminRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.ok === false) {
    throw new Error(typeof body.error === "string" ? body.error : "Gateway request failed");
  }
  return body;
}

function secretFieldsForCredential(credential: GatewayCredential): SecretField[] {
  const secretNames = Array.from(new Set([
    ...credential.secretNames,
    ...Object.values(credential.envBindings),
  ]));
  return secretNames.map((secretName) => ({
    secretName,
    envName: Object.entries(credential.envBindings).find(([, value]) => value === secretName)?.[0]
      ?? (/^[A-Z_][A-Z0-9_]*$/.test(secretName) ? secretName : ""),
    value: "",
  }));
}

function configurationRecord(fields: ConfigurationField[]) {
  return Object.fromEntries(
    fields
      .map((field) => [field.name.trim(), field.value] as const)
      .filter(([name]) => name.length > 0),
  );
}

export function GatewaySettings() {
  const [overview, setOverview] = useState<GatewayOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<CredentialDraft>(emptyCredentialDraft);
  const [editing, setEditing] = useState<GatewayCredential | null>(null);
  const [editSecrets, setEditSecrets] = useState<SecretField[]>([]);
  const [editConfiguration, setEditConfiguration] = useState<ConfigurationField[]>([]);
  const [revoking, setRevoking] = useState<GatewayCredential | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [selectedImportNames, setSelectedImportNames] = useState<string[]>([]);
  const handledCredentialLink = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const payload = (await adminRequest("/admin/gateway")) as { gateway?: GatewayOverview };
      setOverview(payload.gateway ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Gateway");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const credentials = useMemo(
    () => (overview?.connections ?? [])
      .filter((credential) => credential.status !== "revoked")
      .map((credential) => ({
        ...credential,
        key: credential.key || credential.provider || credential.id,
        configuration: credential.configuration ?? {},
        envBindings: credential.envBindings ?? {},
        secretNames: credential.secretNames ?? [],
      })),
    [overview?.connections],
  );
  const parsedImport = useMemo(() => parseEnvText(importText), [importText]);
  const importableNames = useMemo(() => gatewayImportableEnvNames(parsedImport), [parsedImport]);
  const selectedNames = selectedImportNames.filter((name) => importableNames.includes(name));
  const protectedNames = protectedGatewayEnvNames(parsedImport);

  useEffect(() => {
    if (handledCredentialLink.current || !credentials.length) return;
    const connectionId = new URLSearchParams(window.location.search).get("connection");
    if (!connectionId) return;
    const credential = credentials.find((entry) => entry.id === connectionId);
    if (!credential) return;
    handledCredentialLink.current = true;
    openEdit(credential);
  }, [credentials]);

  function mutate(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        await load();
      } catch (mutationError) {
        setError(mutationError instanceof Error ? mutationError.message : "Gateway update failed");
      }
    });
  }

  function createCredential() {
    mutate(async () => {
      const credentials = Object.fromEntries(draft.secrets.map((field) => [field.secretName, field.value]));
      const envBindings = Object.fromEntries(draft.secrets.map((field) => [field.envName, field.secretName]));
      const configuration = configurationRecord(draft.configuration);
      await adminRequest("/admin/gateway/connections", {
        method: "POST",
        body: JSON.stringify({
          provider: "custom",
          label: draft.label.trim(),
          authType: draft.authType,
          credentials,
          envBindings,
          configuration,
        }),
      });
      setCreateOpen(false);
      setDraft(emptyCredentialDraft());
    });
  }

  function openEdit(credential: GatewayCredential) {
    setEditing(credential);
    setEditSecrets(secretFieldsForCredential(credential));
    setEditConfiguration(Object.entries(credential.configuration).map(([name, value]) => configurationField(name, value)));
  }

  function updateCredential() {
    if (!editing) return;
    mutate(async () => {
      const credentials = Object.fromEntries(editSecrets.map((field) => [field.secretName, field.value]));
      const envBindings = Object.fromEntries(editSecrets.map((field) => [field.envName, field.secretName]));
      const configuration = configurationRecord(editConfiguration);
      await adminRequest(`/admin/gateway/connections/${encodeURIComponent(editing.id)}`, {
        method: "PUT",
        body: JSON.stringify({ credentials }),
      });
      await adminRequest(`/admin/gateway/connections/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ configuration, envBindings }),
      });
      setEditing(null);
      setEditSecrets([]);
      setEditConfiguration([]);
    });
  }

  function revokeCredential() {
    if (!revoking) return;
    mutate(async () => {
      await adminRequest(`/admin/gateway/connections/${encodeURIComponent(revoking.id)}`, { method: "DELETE" });
      setRevoking(null);
    });
  }

  function importEnvironment() {
    mutate(async () => {
      await adminRequest("/admin/gateway/credentials/import", {
        method: "POST",
        body: JSON.stringify({
          credentials: Object.fromEntries(selectedNames.map((name) => [name, parsedImport[name]])),
        }),
      });
      setImportOpen(false);
      setImportText("");
      setSelectedImportNames([]);
    });
  }

  const draftValid = Boolean(
    draft.label.trim()
    && draft.secrets.length
    && draft.secrets.every((field) => field.envName.trim() && field.secretName.trim() && field.value),
  );
  const editValid = Boolean(
    editing
    && editSecrets.length
    && editSecrets.every((field) => field.envName.trim() && field.secretName.trim() && field.value),
  );

  if (!overview && !error) {
    return <div className="h-32 animate-pulse border border-border/60 bg-muted/20" />;
  }

  return (
    <div className="grid gap-6">
      {error ? (
        <div className="border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}

      <section className="border-y border-border/60 py-4">
        <p className="text-sm text-muted-foreground">
          Store secrets and reusable service configuration here. Prism Console can prepare credential
          entries and job assignments, but secret values are entered only on this page.
        </p>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" />Credentials</h4>
          <div className="flex items-center gap-2">
            <Badge variant={overview?.reachable ? "secondary" : "destructive"}>
              {overview?.reachable ? "Online" : overview?.enabled ? "Unavailable" : "Disabled"}
            </Badge>
            <Button type="button" variant="outline" size="icon" onClick={() => void load()} disabled={isPending} title="Refresh credentials">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!overview?.reachable}>
              <Plus className="h-4 w-4" />Add credential
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Credential</TableHead><TableHead>Type</TableHead><TableHead>Variables</TableHead>
              <TableHead>Available to</TableHead><TableHead>Last used</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {credentials.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell><div className="font-medium">{credential.label}</div><div className="font-mono text-xs text-muted-foreground">{credential.key}</div></TableCell>
                  <TableCell>{credentialTypes.find(([value]) => value === credential.authType)?.[1] ?? credential.authType}</TableCell>
                  <TableCell><div className="max-w-[360px] font-mono text-xs text-muted-foreground">{[...Object.keys(credential.envBindings), ...Object.keys(credential.configuration)].join(", ") || "None"}</div></TableCell>
                  <TableCell>Trusted runs</TableCell>
                  <TableCell>{formatDate(credential.lastUsedAt)}</TableCell>
                  <TableCell><Badge variant={statusVariant(credential.status)}>{statusLabel(credential.status)}</Badge></TableCell>
                  <TableCell><div className="flex justify-end gap-2">
                    <Button size="icon" variant="outline" title="Replace credential" onClick={() => openEdit(credential)}><KeyRound className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" title="Revoke credential" onClick={() => setRevoking(credential)}><Trash2 className="h-4 w-4" /></Button>
                  </div></TableCell>
                </TableRow>
              ))}
              {!credentials.length ? <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No credentials stored.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <details className="group border-t border-border/60 pt-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
          <span className="flex items-center gap-2"><Activity className="h-4 w-4" />Advanced</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-5 grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium">Environment migration</p><p className="text-sm text-muted-foreground">Import existing variables into a migration pool, then use Prism Console to organize and bind them without exposing values in chat.</p></div>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={!overview?.reachable}><Upload className="h-4 w-4" />Import environment</Button>
          </div>
          <div className="grid gap-3">
            <p className="font-medium">Audit history</p>
            <div className="max-h-[420px] overflow-auto border border-border/70">
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Credential</TableHead><TableHead>Caller</TableHead><TableHead>Status</TableHead><TableHead>Decision</TableHead><TableHead>Latency</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(overview?.auditEvents ?? []).map((event) => <TableRow key={event.id}>
                    <TableCell>{formatDate(event.createdAt)}</TableCell><TableCell className="font-mono text-xs">{event.credentialKey}</TableCell>
                    <TableCell>{event.authenticatedCallerId}</TableCell><TableCell><Badge variant={statusVariant(event.status)}>{event.status}</Badge></TableCell>
                    <TableCell>{event.errorCode ?? event.policyDecision}</TableCell><TableCell>{event.latencyMs === null ? "-" : `${event.latencyMs} ms`}</TableCell>
                  </TableRow>)}
                  {!overview?.auditEvents?.length ? <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No audit events.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </details>

      <CredentialDialog open={createOpen} onOpenChange={setCreateOpen} title="Add credential" description="Store encrypted secrets and non-secret instance configuration." draft={draft} onDraftChange={setDraft} onSubmit={createCredential} submitLabel="Add credential" valid={draftValid} pending={isPending} />

      <CredentialDialog
        open={Boolean(editing)}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        title={editing ? `Replace ${editing.label}` : "Replace credential"}
        description="Enter all secret values when rotating a credential. Existing values are never displayed."
        draft={{ label: editing?.label ?? "", authType: editing?.authType ?? "custom", secrets: editSecrets, configuration: editConfiguration }}
        onDraftChange={(next) => { setEditSecrets(next.secrets); setEditConfiguration(next.configuration); }}
        onSubmit={updateCredential}
        submitLabel="Replace credential"
        valid={editValid}
        pending={isPending}
        lockIdentity
      />

      <Dialog open={Boolean(revoking)} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Revoke credential</DialogTitle><DialogDescription>This removes encrypted values for {revoking?.label}. Jobs using it will stop working.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRevoking(null)}>Cancel</Button><Button variant="destructive" onClick={revokeCredential} disabled={isPending}>Revoke</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Import environment</DialogTitle><DialogDescription>Migration utility for existing instance variables. Platform and Prism service secrets are ignored.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="gateway-env-import">Environment variables</Label><Textarea id="gateway-env-import" className="min-h-52 font-mono text-xs" value={importText} onChange={(event) => { setImportText(event.target.value); setSelectedImportNames(gatewayImportableEnvNames(parseEnvText(event.target.value))); }} placeholder="SERVICE_API_KEY=..." /></div>
            {importableNames.length ? <div className="max-h-44 overflow-auto border border-border/70 p-3">{importableNames.map((name) => <label key={name} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={selectedNames.includes(name)} onCheckedChange={(checked) => setSelectedImportNames((current) => checked ? [...new Set([...current, name])] : current.filter((item) => item !== name))} /><code>{name}</code></label>)}</div> : null}
            {protectedNames.length ? <p className="text-xs text-muted-foreground">Ignored platform variables: {protectedNames.join(", ")}</p> : null}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button><Button onClick={importEnvironment} disabled={isPending || !selectedNames.length}>Import selected</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CredentialDialog({
  open,
  onOpenChange,
  title,
  description,
  draft,
  onDraftChange,
  onSubmit,
  submitLabel,
  valid,
  pending,
  lockIdentity = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  draft: CredentialDraft;
  onDraftChange: (draft: CredentialDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  valid: boolean;
  pending: boolean;
  lockIdentity?: boolean;
}) {
  const updateSecret = (index: number, patch: Partial<SecretField>) => onDraftChange({ ...draft, secrets: draft.secrets.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) });
  const updateConfiguration = (index: number, patch: Partial<ConfigurationField>) => onDraftChange({ ...draft, configuration: draft.configuration.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    <div className="grid max-h-[65vh] gap-5 overflow-y-auto py-2">
      <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor={`${title}-label`}>Name</Label><Input id={`${title}-label`} value={draft.label} disabled={lockIdentity} onChange={(event) => onDraftChange({ ...draft, label: event.target.value })} placeholder="Analytics production" /></div>
        <div className="grid gap-2"><Label>Type</Label><Select value={draft.authType} disabled={lockIdentity} onValueChange={(authType) => onDraftChange({
          ...draft,
          authType,
          secrets: draft.secrets.every((field) => !field.envName && !field.value)
            ? secretTemplate(authType)
            : draft.secrets,
        })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{credentialTypes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></div>

      <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">Secret variables</p><p className="text-xs text-muted-foreground">Injected only into assigned trusted jobs.</p></div><Button type="button" size="sm" variant="outline" onClick={() => onDraftChange({ ...draft, secrets: [...draft.secrets, { envName: "", secretName: `secret${draft.secrets.length + 1}`, value: "" }] })}><Plus className="h-4 w-4" />Add</Button></div>
        {draft.secrets.map((field, index) => <div key={`${field.secretName}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input aria-label="Environment variable" value={field.envName} onChange={(event) => updateSecret(index, { envName: event.target.value.toUpperCase() })} placeholder={secretPlaceholder(field.secretName)} /><Input aria-label="Secret value" type="password" value={field.value} onChange={(event) => updateSecret(index, { value: event.target.value })} placeholder="Credential value" /><Button type="button" size="icon" variant="outline" title="Remove secret variable" disabled={draft.secrets.length === 1} onClick={() => onDraftChange({ ...draft, secrets: draft.secrets.filter((_, fieldIndex) => fieldIndex !== index) })}><Trash2 className="h-4 w-4" /></Button></div>)}
      </div>

      <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">Configuration variables</p><p className="text-xs text-muted-foreground">Base URLs, site IDs, buckets, regions, and other non-secret values.</p></div><Button type="button" size="sm" variant="outline" onClick={() => onDraftChange({ ...draft, configuration: [...draft.configuration, configurationField()] })}><Plus className="h-4 w-4" />Add</Button></div>
        {draft.configuration.map((field, index) => <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input aria-label="Configuration variable" value={field.name} onChange={(event) => updateConfiguration(index, { name: event.target.value.toUpperCase() })} placeholder="SERVICE_BASE_URL" /><Input aria-label="Configuration value" value={field.value} onChange={(event) => updateConfiguration(index, { value: event.target.value })} placeholder="https://service.example.org" /><Button type="button" size="icon" variant="outline" title="Remove configuration variable" onClick={() => onDraftChange({ ...draft, configuration: draft.configuration.filter((_, fieldIndex) => fieldIndex !== index) })}><Trash2 className="h-4 w-4" /></Button></div>)}
      </div>
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSubmit} disabled={pending || !valid}>{submitLabel}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
