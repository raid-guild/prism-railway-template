"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bot,
  ExternalLink,
  FileSearch,
  Loader2,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Route,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ChatMessageTimestamp } from "@/components/chat-message-timestamp";
import { MemoryDocumentUploadButton } from "@/components/admin/memory-document-upload-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdminSetupStatus,
} from "@/lib/admin";
import type {
  PrismArtifactDetail,
  PrismArtifactSummary,
  PrismKnowledgeSource,
  PrismStateObjective,
  PrismStateSignal,
  PrismStateThroughline,
} from "@/lib/prism-memory";

type ArtifactsPayload = {
  artifacts: PrismArtifactSummary[];
  total: number;
  limit: number;
};

type SourcesPayload = {
  sources: PrismKnowledgeSource[];
  total: number;
};

type ObjectivesPayload = {
  objectives: PrismStateObjective[];
  total?: number;
};

type SignalsPayload = {
  signals: PrismStateSignal[];
  total?: number;
};

type ThroughlinesPayload = {
  throughlines: PrismStateThroughline[];
  total?: number;
};

type SortValue =
  | "created-desc"
  | "created-asc"
  | "source-asc"
  | "type-asc"
  | "length-desc";

const artifactStatuses = ["all", "incoming", "processed", "rejected"];
const artifactCategories = ["all", "memory", "knowledge"];
const artifactLimits = ["25", "50", "100", "200"];
const objectiveStatuses = ["active", "watching", "inactive", "archived", "all"];
const sortOptions: Array<{ value: SortValue; label: string }> = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "source-asc", label: "Source" },
  { value: "type-asc", label: "Type" },
  { value: "length-desc", label: "Largest" },
];

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function compactHash(value?: string | null) {
  if (!value) return "None";
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function formatScore(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0.00";
  return value.toFixed(2);
}

function evidenceText(signal: PrismStateSignal) {
  const evidence = signal.evidence ?? {};
  const text = evidence.text;
  if (typeof text === "string" && text.trim()) return text;
  const url = evidence.url;
  if (typeof url === "string" && url.trim()) return url;
  return signal.anchor;
}

function statusVariant(status?: string | null) {
  if (status === "synced" || status === "processed" || status === "active") {
    return "secondary" as const;
  }
  if (status === "error" || status === "rejected") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function jsonPreview(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function extractErrorMessage(payload: unknown, response: Response) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error
    }
    if (record.error && typeof record.error === "object") {
      const errorRecord = record.error as Record<string, unknown>
      if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
        return errorRecord.message
      }
      if (typeof errorRecord.code === "string" && errorRecord.code.trim()) {
        return errorRecord.code
      }
    }
    if (typeof record.detail === "string" && record.detail.trim()) {
      return record.detail
    }
    if (record.detail && typeof record.detail === "object") {
      const detailRecord = record.detail as Record<string, unknown>
      if (typeof detailRecord.message === "string" && detailRecord.message.trim()) {
        return detailRecord.message
      }
      if (typeof detailRecord.error === "string" && detailRecord.error.trim()) {
        return detailRecord.error
      }
    }
  }
  return `Request failed with ${response.status}`
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response));
  }

  return payload as T;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-border/70 bg-card/30 px-6 py-10 text-center">
      <FileSearch className="h-8 w-8 text-muted-foreground" />
      <p className="mt-4 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function DetailShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="border-t border-border/60 bg-card/30 xl:border-l xl:border-t-0">
      <div className="border-b border-border/60 px-5 py-4">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle ? (
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="max-h-[calc(100vh-230px)] overflow-auto p-5">
        {children}
      </div>
    </aside>
  );
}

type MemoryChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type StoredMemoryChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
  created_at?: string;
};

const memoryChatSessionStorageKey = "prism-memory-chat-session-id";

function randomMessageId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function artifactContextBlock(artifacts: PrismArtifactSummary[]) {
  if (!artifacts.length) return "";
  const rows = artifacts.map((artifact) =>
    [
      `- id: ${artifact.id}`,
      `  filename: ${artifact.filename}`,
      `  type: ${artifact.type ?? "unknown"}`,
      `  source: ${artifact.source ?? "unknown"}`,
      `  status: ${artifact.status}`,
      artifact.url ? `  source_url: ${artifact.url}` : null,
      `  preview: ${artifact.preview || artifact.path}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "Selected Prism Memory artifacts:",
    ...rows,
    "",
    "Use these artifact IDs as citations when answering. If more detail is needed, use Prism Memory reader access to fetch the specific artifacts instead of guessing from previews.",
  ].join("\n");
}

function displayMemoryChatContent(role: string, content: string) {
  if (role !== "user") return content;
  const marker = "\n\nAdmin question:\n";
  const markerIndex = content.lastIndexOf(marker);
  return markerIndex >= 0 ? content.slice(markerIndex + marker.length).trim() : content;
}

function MemoryChat({
  selectedArtifacts,
  onRemoveArtifact,
  onClearArtifacts,
}: {
  selectedArtifacts: PrismArtifactSummary[];
  onRemoveArtifact: (id: string) => void;
  onClearArtifacts: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MemoryChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(memoryChatSessionStorageKey);
    if (!storedSessionId) return;

    setIsLoadingHistory(true);
    fetch(`/admin/responses?session_id=${encodeURIComponent(storedSessionId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          messages?: StoredMemoryChatMessage[];
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not load memory chat history");
        }
        const restoredMessages = Array.isArray(payload.messages)
          ? payload.messages
              .filter((message) => message.role === "user" || message.role === "assistant")
              .map((message) => ({
                id: message.id,
                role: message.role as "user" | "assistant",
                content: displayMemoryChatContent(message.role, message.content),
                createdAt: message.createdAt ?? message.created_at ?? "",
              }))
          : [];
        setSessionId(storedSessionId);
        setMessages(restoredMessages);
      })
      .catch(() => {
        window.localStorage.removeItem(memoryChatSessionStorageKey);
      })
      .finally(() => setIsLoadingHistory(false));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isPending) return;

    const context = artifactContextBlock(selectedArtifacts);
    const runtimePrompt = [
      "You are answering inside the Prism Memory Explorer.",
      "Answer questions about Prism Memory and cite artifact IDs, doc slugs, or source URLs when available.",
      "If the admin asks you to create content for the knowledge base, draft it first and explain that writing it back should use the Prism Memory write path or knowledge inbox with explicit approval.",
      context || "No artifacts are currently attached by the admin.",
      "",
      `Admin question:\n${prompt}`,
    ].join("\n\n");

    setDraft("");
    setError(null);
    setMessages((current) => [
      ...current,
      {
        id: randomMessageId("user"),
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
      },
    ]);
    setIsPending(true);

    try {
      const response = await fetch("/admin/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: [{ role: "user", content: runtimePrompt }],
          session_id: sessionId,
          requested_skills: ["prism-api-reader"],
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        output_text?: string;
        session_id?: string;
      };

      if (!response.ok || !payload.output_text) {
        throw new Error(payload.error || "The response endpoint did not return output_text");
      }

      const nextSessionId = payload.session_id ?? sessionId;
      setSessionId(nextSessionId);
      if (nextSessionId) {
        window.localStorage.setItem(memoryChatSessionStorageKey, nextSessionId);
      }
      setMessages((current) => [
        ...current,
        {
          id: randomMessageId("assistant"),
          role: "assistant",
          content: payload.output_text!,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unknown memory chat error");
    } finally {
      setIsPending(false);
    }
  }

  function startNewSession() {
    window.localStorage.removeItem(memoryChatSessionStorageKey);
    setSessionId(null);
    setMessages([]);
    setError(null);
  }

  return (
    <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-h-[calc(100vh-186px)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-4 w-4" />
            <span>{sessionId ? "Session live" : "New session"}</span>
          </div>
          {sessionId ? (
            <Button type="button" variant="outline" size="sm" onClick={startNewSession}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
          {isLoadingHistory ? (
            <EmptyState title="Loading memory chat" body="Restoring the latest Memory Chat session for this browser." />
          ) : messages.length ? (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`px-4 py-3 text-sm leading-6 ${
                    message.role === "assistant"
                      ? "border-l-2 border-border bg-muted/20 text-foreground"
                      : "ml-auto max-w-3xl border-l-2 border-primary/60 bg-primary/12 text-foreground"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em]">
                    <Badge variant={message.role === "assistant" ? "outline" : "secondary"}>
                      {message.role}
                    </Badge>
                    {message.createdAt ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <ChatMessageTimestamp value={message.createdAt} />
                      </>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Ask about memory"
              body="Attach artifacts from the Artifacts tab or ask a broader question about the knowledge base."
            />
          )}
        </div>
        <form onSubmit={handleSubmit} className="border-t border-border/60 px-5 py-4 md:px-6">
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about selected artifacts, summaries, provenance, or what should become knowledge."
              className="min-h-28 rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0"
              required
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Reader access is requested automatically; write-back should be explicitly approved.
              </p>
              <Button type="submit" disabled={isPending || !draft.trim()}>
                {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                {isPending ? "Running" : "Send"}
              </Button>
            </div>
          </div>
        </form>
      </div>
      <aside className="border-t border-border/60 bg-card/30 xl:border-l xl:border-t-0">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="h-4 w-4" />
            Attached
            <Badge variant="outline">{selectedArtifacts.length}</Badge>
          </div>
          {selectedArtifacts.length ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClearArtifacts}>
              Clear
            </Button>
          ) : null}
        </div>
        <div className="max-h-[calc(100vh-230px)] overflow-auto p-5">
          {selectedArtifacts.length ? (
            <div className="space-y-3">
              {selectedArtifacts.map((artifact) => (
                <div key={artifact.id} className="border border-border bg-background/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{artifact.filename}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{artifact.type ?? "unknown"}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveArtifact(artifact.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                    {artifact.preview || artifact.path}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No attachments" body="Use checkboxes in Artifacts to add files to this chat." />
          )}
        </div>
      </aside>
    </section>
  );
}

export function MemoryExplorerWorkspace({
  setup,
}: {
  setup: AdminSetupStatus;
}) {
  const [activeTab, setActiveTab] = useState("artifacts");
  const [artifacts, setArtifacts] = useState<PrismArtifactSummary[]>([]);
  const [artifactTotal, setArtifactTotal] = useState(0);
  const [selectedArtifact, setSelectedArtifact] =
    useState<PrismArtifactDetail | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("");
  const [type, setType] = useState("");
  const [artifactSearch, setArtifactSearch] = useState("");
  const [limit, setLimit] = useState("50");
  const [sortValue, setSortValue] = useState<SortValue>("created-desc");
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [selectedArtifactSnapshots, setSelectedArtifactSnapshots] = useState<
    Record<string, PrismArtifactSummary>
  >({});

  const [sources, setSources] = useState<PrismKnowledgeSource[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [objectives, setObjectives] = useState<PrismStateObjective[]>([]);
  const [objectiveTotal, setObjectiveTotal] = useState(0);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const [objectiveStatus, setObjectiveStatus] = useState("active");
  const [objectiveSource, setObjectiveSource] = useState("");
  const [objectiveExternalSystem, setObjectiveExternalSystem] = useState("");
  const [objectiveSearch, setObjectiveSearch] = useState("");
  const [selectedObjectiveKey, setSelectedObjectiveKey] = useState<string | null>(null);
  const [signals, setSignals] = useState<PrismStateSignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [throughlines, setThroughlines] = useState<PrismStateThroughline[]>([]);
  const [throughlineLoading, setThroughlineLoading] = useState(false);
  const [selectedThroughlineKey, setSelectedThroughlineKey] = useState<string | null>(null);

  const selectedArtifactsForChat = useMemo(
    () => selectedArtifactIds
      .map((id) => selectedArtifactSnapshots[id] ?? artifacts.find((artifact) => artifact.id === id))
      .filter((artifact): artifact is PrismArtifactSummary => Boolean(artifact)),
    [artifacts, selectedArtifactIds, selectedArtifactSnapshots],
  );

  const selectedSource = useMemo(
    () => sources.find((item) => item.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  );

  const selectedObjective = useMemo(
    () => objectives.find((item) => item.objective_key === selectedObjectiveKey) ?? null,
    [objectives, selectedObjectiveKey],
  );

  const selectedThroughline = useMemo(
    () => throughlines.find((item) => item.throughline_key === selectedThroughlineKey) ?? null,
    [selectedThroughlineKey, throughlines],
  );

  const objectiveSignals = useMemo(() => {
    if (!selectedObjective) return signals;
    const signalIds = new Set(selectedObjective.signal_ids ?? []);
    return signals.filter((signal) => signalIds.has(signal.signal_id));
  }, [selectedObjective, signals]);

  const visibleObjectives = useMemo(() => {
    const search = objectiveSearch.trim().toLowerCase();
    const throughlineObjectiveKeys = selectedThroughline
      ? new Set(selectedThroughline.objective_keys ?? [])
      : null;
    return objectives.filter((objective) => {
      if (throughlineObjectiveKeys && !throughlineObjectiveKeys.has(objective.objective_key)) {
        return false;
      }
      if (!search) return true;
      const haystack = [
        objective.objective_key,
        objective.title,
        objective.status,
        objective.summary,
        ...(objective.anchors ?? []),
        ...(objective.sources ?? []),
        ...(objective.score_reasons ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [objectiveSearch, objectives, selectedThroughline]);

  const sourceOptions = useMemo(
    () =>
      Array.from(
        new Set(artifacts.map((artifact) => artifact.source).filter(Boolean)),
      ).sort() as string[],
    [artifacts],
  );

  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(artifacts.map((artifact) => artifact.type).filter(Boolean)),
      ).sort() as string[],
    [artifacts],
  );

  const objectiveSourceOptions = useMemo(
    () =>
      Array.from(
        new Set(objectives.flatMap((objective) => objective.sources ?? []).filter(Boolean)),
      ).sort(),
    [objectives],
  );

  const visibleArtifacts = useMemo(() => {
    const search = artifactSearch.trim().toLowerCase();
    return artifacts
      .filter((artifact) => {
        if (search) {
          const haystack = [
            artifact.preview,
            artifact.filename,
            artifact.path,
            artifact.source,
            artifact.type,
            artifact.bucket,
            artifact.author,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (sortValue === "created-asc") {
          return left.created_at.localeCompare(right.created_at);
        }
        if (sortValue === "source-asc") {
          return (left.source ?? "").localeCompare(right.source ?? "");
        }
        if (sortValue === "type-asc") {
          return (left.type ?? "").localeCompare(right.type ?? "");
        }
        if (sortValue === "length-desc") {
          return right.content_length - left.content_length;
        }
        return right.created_at.localeCompare(left.created_at);
      });
  }, [artifactSearch, artifacts, sortValue]);

  async function loadArtifacts() {
    setArtifactLoading(true);
    setArtifactError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit);
      if (category !== "all") params.set("category", category);
      if (status !== "all") params.set("status", status);
      if (source.trim()) params.set("source", source.trim());
      if (type.trim()) params.set("type", type.trim());

      const payload = await fetchJson<ArtifactsPayload>(
        `/admin/memory/api/artifacts?${params.toString()}`,
      );
      setArtifacts(payload.artifacts ?? []);
      setArtifactTotal(payload.total ?? 0);
      setSelectedArtifact(null);
    } catch (error) {
      setArtifactError(
        error instanceof Error ? error.message : "Could not load artifacts",
      );
    } finally {
      setArtifactLoading(false);
    }
  }

  async function loadArtifactDetail(id: string) {
    setDetailLoading(true);
    setArtifactError(null);
    try {
      const payload = await fetchJson<PrismArtifactDetail>(
        `/admin/memory/api/artifacts/${encodeURIComponent(id)}`,
      );
      setSelectedArtifact(payload);
    } catch (error) {
      setArtifactError(
        error instanceof Error ? error.message : "Could not load artifact",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadSources() {
    setSourceLoading(true);
    setSourceError(null);
    try {
      const payload = await fetchJson<SourcesPayload>(
        "/admin/memory/api/knowledge/sources",
      );
      setSources(payload.sources ?? []);
      setSelectedSourceId((current) => current ?? payload.sources?.[0]?.id ?? null);
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Could not load sources",
      );
    } finally {
      setSourceLoading(false);
    }
  }

  async function loadObjectives() {
    setObjectiveLoading(true);
    setObjectiveError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "250");
      if (objectiveStatus !== "all") params.set("status", objectiveStatus);
      if (objectiveSource.trim()) params.set("source", objectiveSource.trim());
      if (objectiveExternalSystem.trim()) {
        params.set("externalSystem", objectiveExternalSystem.trim());
      }
      const payload = await fetchJson<ObjectivesPayload>(
        `/admin/memory/api/state/objectives?${params.toString()}`,
      );
      const nextObjectives = payload.objectives ?? [];
      setObjectives(nextObjectives);
      setObjectiveTotal(payload.total ?? nextObjectives.length);
      setSelectedObjectiveKey((current) =>
        current && nextObjectives.some((objective) => objective.objective_key === current)
          ? current
          : nextObjectives[0]?.objective_key ?? null,
      );
    } catch (error) {
      setObjectiveError(
        error instanceof Error ? error.message : "Could not load objectives",
      );
    } finally {
      setObjectiveLoading(false);
    }
  }

  async function loadThroughlines() {
    setThroughlineLoading(true);
    try {
      const payload = await fetchJson<ThroughlinesPayload>(
        "/admin/memory/api/state/throughlines?limit=100",
      );
      const nextThroughlines = (payload.throughlines ?? []).filter(
        (throughline) => throughline.status !== "inactive" && throughline.status !== "archived",
      );
      setThroughlines(nextThroughlines);
      setSelectedThroughlineKey((current) =>
        current && nextThroughlines.some((throughline) => throughline.throughline_key === current)
          ? current
          : null,
      );
    } catch (error) {
      setObjectiveError(
        error instanceof Error ? error.message : "Could not load throughlines",
      );
    } finally {
      setThroughlineLoading(false);
    }
  }

  async function loadSignals(objectiveKey?: string | null) {
    setSignalsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "250");
      if (objectiveKey) params.set("objective_key", objectiveKey);
      const payload = await fetchJson<SignalsPayload>(
        `/admin/memory/api/state/signals?${params.toString()}`,
      );
      setSignals(payload.signals ?? []);
    } catch (error) {
      setObjectiveError(
        error instanceof Error ? error.message : "Could not load signals",
      );
    } finally {
      setSignalsLoading(false);
    }
  }

  useEffect(() => {
    loadArtifacts();
    loadSources();
    loadObjectives();
    loadThroughlines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, source, type, limit]);

  useEffect(() => {
    loadObjectives();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectiveStatus, objectiveSource, objectiveExternalSystem]);

  useEffect(() => {
    loadSignals(selectedObjectiveKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObjectiveKey]);

  function setArtifactChatSelection(artifact: PrismArtifactSummary, selected: boolean) {
    setSelectedArtifactIds((current) => {
      if (selected) {
        return current.includes(artifact.id) ? current : [...current, artifact.id];
      }
      return current.filter((id) => id !== artifact.id);
    });
    setSelectedArtifactSnapshots((current) => {
      if (!selected) {
        const next = { ...current };
        delete next[artifact.id];
        return next;
      }
      return {
        ...current,
        [artifact.id]: artifact,
      };
    });
  }

  return (
    <div className="flex min-h-[calc(100vh-65px)] flex-col">
      <div className="border-b border-border/60 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Prism Memory
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Memory Explorer
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Browse artifacts, inspect knowledge sources, and ask scoped
              memory questions without exposing Prism keys to the browser.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={setup.prismMemory.reachable ? "secondary" : "destructive"}>
              {setup.prismMemory.reachable ? "Memory reachable" : "Memory offline"}
            </Badge>
            <Badge variant="outline">
              Space {setup.prismMemory.space ?? "unknown"}
            </Badge>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col">
        <div className="sticky top-16 z-20 border-b border-border/60 bg-background/95 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-6">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-transparent p-0">
              <TabsTrigger
                value="artifacts"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Artifacts
                <Badge variant="outline" className="ml-2">
                  {artifactTotal}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="sources"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Sources
                <Badge variant="outline" className="ml-2">
                  {sources.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="objectives"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Objectives
                <Badge variant="outline" className="ml-2">
                  {objectiveTotal}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="chat"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Chat
                <Badge variant="outline" className="ml-2">
                  {selectedArtifactsForChat.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
            {activeTab === "artifacts" ? (
              <MemoryDocumentUploadButton
                disabled={!setup.prismMemory.reachable}
                onUploaded={async (artifact) => {
                  await loadArtifacts();
                  await loadArtifactDetail(artifact.id);
                }}
              />
            ) : null}
          </div>
        </div>

        <TabsContent value="artifacts" className="mt-0 flex-1">
          <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0">
              <div className="grid gap-3 border-b border-border/60 px-5 py-4 md:px-6 lg:grid-cols-[1.5fr_repeat(5,minmax(120px,160px))_auto]">
                <div className="space-y-2">
                  <Label>Search returned files</Label>
                  <Input
                    value={artifactSearch}
                    onChange={(event) => setArtifactSearch(event.target.value)}
                    placeholder="Search preview, filename, author..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artifactCategories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artifactStatuses.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Select value={source || "all"} onValueChange={(value) => setSource(value === "all" ? "" : value)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      {sourceOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type || "all"} onValueChange={(value) => setType(value === "all" ? "" : value)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      {typeOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sort</Label>
                  <Select value={sortValue} onValueChange={(value) => setSortValue(value as SortValue)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Select value={limit} onValueChange={setLimit}>
                    <SelectTrigger className="w-24 border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artifactLimits.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadArtifacts}
                    disabled={artifactLoading}
                  >
                    {artifactLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {artifactError ? (
                <div className="border-b border-border/60 px-5 py-3 text-sm text-destructive md:px-6">
                  {artifactError}
                </div>
              ) : null}

              {visibleArtifacts.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Chat</TableHead>
                      <TableHead className="w-40">Created</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead className="w-32">Source</TableHead>
                      <TableHead className="w-36">Type</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-24 text-right">Chars</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleArtifacts.map((artifact) => (
                      <TableRow
                        key={artifact.id}
                        className="cursor-pointer"
                        data-state={selectedArtifact?.id === artifact.id ? "selected" : undefined}
                        onClick={() => loadArtifactDetail(artifact.id)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedArtifactIds.includes(artifact.id)}
                            onCheckedChange={(checked) => setArtifactChatSelection(artifact, checked === true)}
                            aria-label={`Attach ${artifact.filename} to chat`}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(artifact.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {artifact.filename}
                            </p>
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {artifact.preview || artifact.path}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{artifact.source ?? "unknown"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {artifact.type ?? "unknown"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(artifact.status)}>
                            {artifact.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {artifact.content_length.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-5 md:p-6">
                  <EmptyState
                    title={artifactLoading ? "Loading artifacts" : "No artifacts found"}
                    body="Try a wider filter set or confirm Prism Memory has inbox or knowledge artifacts."
                  />
                </div>
              )}
            </div>

            <DetailShell
              title={selectedArtifact?.filename ?? "Artifact Detail"}
              subtitle={selectedArtifact?.path}
            >
              {detailLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading artifact...
                </div>
              ) : selectedArtifact ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant(selectedArtifact.status)}>
                      {selectedArtifact.status}
                    </Badge>
                    <Badge variant="outline">{selectedArtifact.category}</Badge>
                    <Badge variant="outline">{selectedArtifact.source ?? "unknown"}</Badge>
                  </div>
                  {selectedArtifact.view_url || selectedArtifact.url ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedArtifact.view_url ? (
                        <Button asChild variant="outline">
                          <a href={selectedArtifact.view_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            Memory View
                          </a>
                        </Button>
                      ) : null}
                      {selectedArtifact.url ? (
                        <Button asChild variant="outline">
                          <a href={selectedArtifact.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            Source
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Content
                    </p>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap border border-border bg-background/70 p-3 text-xs leading-5">
                      {selectedArtifact.content || selectedArtifact.preview}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Raw Payload
                    </p>
                    <pre className="max-h-96 overflow-auto border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
                      {jsonPreview(selectedArtifact.payload)}
                    </pre>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Select an artifact"
                  body="Choose a row to inspect content, provenance, and the raw JSON payload."
                />
              )}
            </DetailShell>
          </section>
        </TabsContent>

        <TabsContent value="sources" className="mt-0 flex-1">
          <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
                <div>
                  <h2 className="text-lg font-semibold">Knowledge Sources</h2>
                  <p className="text-sm text-muted-foreground">
                    Read-only status for repo-backed Prism Knowledge sources.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={loadSources}
                  disabled={sourceLoading}
                >
                  {sourceLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Refresh
                </Button>
              </div>

              {sourceError ? (
                <div className="border-b border-border/60 px-5 py-3 text-sm text-destructive md:px-6">
                  {sourceError}
                </div>
              ) : null}

              {sources.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="w-28">Kind</TableHead>
                      <TableHead className="w-36">Status</TableHead>
                      <TableHead className="w-28 text-right">Docs</TableHead>
                      <TableHead className="w-40">Synced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((item) => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer"
                        data-state={selectedSourceId === item.id ? "selected" : undefined}
                        onClick={() => setSelectedSourceId(item.id)}
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{item.label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.repo_url}#{item.branch}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{item.kind}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(item.state?.status ?? item.status)}>
                            {item.state?.status ?? item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.state?.doc_count ?? 0}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(item.last_synced_at ?? item.state?.last_synced_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-5 md:p-6">
                  <EmptyState
                    title={sourceLoading ? "Loading sources" : "No sources registered"}
                    body="Repo-backed knowledge sources will appear here after they are registered in Prism Memory."
                  />
                </div>
              )}
            </div>

            <DetailShell
              title={selectedSource?.label ?? "Source Detail"}
              subtitle={selectedSource?.id}
            >
              {selectedSource ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-border bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Docs
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {selectedSource.state?.doc_count ?? 0}
                      </p>
                    </div>
                    <div className="border border-border bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Files
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {selectedSource.state?.file_count ?? 0}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">Repo:</span>{" "}
                      <span className="break-all">{selectedSource.repo_url}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Branch:</span>{" "}
                      {selectedSource.branch}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Commit:</span>{" "}
                      {compactHash(selectedSource.last_synced_commit ?? selectedSource.state?.last_synced_commit)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Last synced:</span>{" "}
                      {formatDate(selectedSource.last_synced_at ?? selectedSource.state?.last_synced_at)}
                    </p>
                  </div>
                  {selectedSource.state?.error ? (
                    <div className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      {selectedSource.state.error.code ? `${selectedSource.state.error.code}: ` : ""}
                      {selectedSource.state.error.message ?? "Unknown source error"}
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Docs Roots
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(selectedSource.docs_roots.length
                        ? selectedSource.docs_roots
                        : selectedSource.state?.docs_roots ?? []
                      ).map((root) => (
                        <Badge key={root} variant="outline">
                          {root}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <pre className="max-h-96 overflow-auto border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
                    {jsonPreview(selectedSource)}
                  </pre>
                </div>
              ) : (
                <EmptyState
                  title="Select a source"
                  body="Choose a source to inspect sync state, docs roots, patterns, and recent errors."
                />
              )}
            </DetailShell>
          </section>
        </TabsContent>

        <TabsContent value="objectives" className="mt-0 flex-1">
          <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="min-w-0">
              <div className="grid gap-3 border-b border-border/60 px-5 py-4 md:px-6 lg:grid-cols-[1.5fr_repeat(3,minmax(120px,170px))_auto]">
                <div className="space-y-2">
                  <Label>Search objectives</Label>
                  <Input
                    value={objectiveSearch}
                    onChange={(event) => setObjectiveSearch(event.target.value)}
                    placeholder="Search title, key, anchors..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={objectiveStatus} onValueChange={setObjectiveStatus}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {objectiveStatuses.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Select value={objectiveSource || "all"} onValueChange={(value) => setObjectiveSource(value === "all" ? "" : value)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      {objectiveSourceOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>External</Label>
                  <Input
                    value={objectiveExternalSystem}
                    onChange={(event) => setObjectiveExternalSystem(event.target.value)}
                    placeholder="portal"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      loadObjectives();
                      loadThroughlines();
                      loadSignals(selectedObjectiveKey);
                    }}
                    disabled={objectiveLoading || throughlineLoading || signalsLoading}
                  >
                    {objectiveLoading || throughlineLoading || signalsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {objectiveError ? (
                <div className="border-b border-border/60 px-5 py-3 text-sm text-destructive md:px-6">
                  {objectiveError}
                </div>
              ) : null}

              <div className="grid border-b border-border/60 px-5 py-4 md:px-6 lg:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Objectives
                  </p>
                  <p className="mt-1 text-2xl font-semibold">{visibleObjectives.length}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Open Throughlines
                  </p>
                  <p className="mt-1 text-2xl font-semibold">{throughlines.length}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Loaded Signals
                  </p>
                  <p className="mt-1 text-2xl font-semibold">{signals.length}</p>
                </div>
              </div>

              <div className="border-b border-border/60 px-5 py-4 md:px-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Throughlines
                    </p>
                    {selectedThroughline ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Filtering objectives by {selectedThroughline.title}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant={selectedThroughlineKey ? "outline" : "secondary"}
                    size="sm"
                    onClick={() => setSelectedThroughlineKey(null)}
                  >
                    All
                  </Button>
                </div>
                {throughlineLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading throughlines...
                  </div>
                ) : throughlines.length ? (
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {throughlines.slice(0, 12).map((throughline) => {
                      const selected = throughline.throughline_key === selectedThroughlineKey;
                      return (
                        <button
                          key={throughline.throughline_key}
                          type="button"
                          className="border border-border bg-background/70 p-3 text-left transition-colors hover:bg-muted/50 data-[state=selected]:border-primary data-[state=selected]:bg-muted"
                          data-state={selected ? "selected" : undefined}
                          onClick={() => {
                            setSelectedThroughlineKey(throughline.throughline_key);
                            const firstObjectiveKey = throughline.objective_keys?.[0] ?? null;
                            if (firstObjectiveKey) {
                              setSelectedObjectiveKey(firstObjectiveKey);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Route className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <p className="truncate text-sm font-medium">{throughline.title}</p>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {throughline.throughline_key}
                              </p>
                            </div>
                            <Badge variant="outline">
                              {throughline.objective_keys?.length ?? 0}
                            </Badge>
                            <Badge variant={statusVariant(throughline.status)}>
                              {throughline.status}
                            </Badge>
                          </div>
                          {throughline.summary ? (
                            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                              {throughline.summary}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-muted-foreground">
                            Last signal {formatDate(throughline.last_signal_at)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    title="No active throughlines"
                    body="Run generated state with enrichment or add explicit throughline keys to source metadata."
                  />
                )}
              </div>

              {visibleObjectives.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {selectedThroughline ? "Objective In Throughline" : "Objective"}
                      </TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-28 text-right">Activity</TableHead>
                      <TableHead className="w-28 text-right">Attention</TableHead>
                      <TableHead className="w-40">Last signal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleObjectives.map((objective) => (
                      <TableRow
                        key={objective.objective_key}
                        className="cursor-pointer"
                        data-state={selectedObjectiveKey === objective.objective_key ? "selected" : undefined}
                        onClick={() => setSelectedObjectiveKey(objective.objective_key)}
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{objective.title || objective.objective_key}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {objective.objective_key}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(objective.sources ?? []).slice(0, 4).map((item) => (
                                <Badge key={item} variant="outline">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(objective.status)}>
                            {objective.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {formatScore(objective.activity_score)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {formatScore(objective.attention_score)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(objective.last_signal_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-5 md:p-6">
                  <EmptyState
                    title={objectiveLoading ? "Loading objectives" : "No objectives found"}
                    body="Try a wider status/source filter or run generated state in Prism Memory."
                  />
                </div>
              )}
            </div>

            <DetailShell
              title={selectedObjective?.title ?? "Objective Detail"}
              subtitle={selectedObjective?.objective_key}
            >
              {selectedObjective ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant(selectedObjective.status)}>
                      {selectedObjective.status}
                    </Badge>
                    <Badge variant="outline">
                      activity {formatScore(selectedObjective.activity_score)}
                    </Badge>
                    <Badge variant="outline">
                      confidence {formatScore(selectedObjective.confidence_score)}
                    </Badge>
                    <Badge variant="outline">
                      {selectedObjective.enrichment_status ?? "unenriched"}
                    </Badge>
                  </div>

                  {selectedObjective.summary ? (
                    <p className="text-sm leading-6">{selectedObjective.summary}</p>
                  ) : null}

                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Score Reasons
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(selectedObjective.score_reasons ?? []).length ? (
                        selectedObjective.score_reasons?.map((reason) => (
                          <Badge key={reason} variant="outline">
                            {reason}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">None</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Anchors
                    </p>
                    <div className="flex max-h-32 flex-wrap gap-2 overflow-auto">
                      {(selectedObjective.anchors ?? []).map((anchor) => (
                        <Badge key={anchor} variant="outline">
                          {anchor}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {throughlines.length ? (
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Throughlines
                      </p>
                      <div className="space-y-2">
                        {throughlines
                          .filter((throughline) => throughline.objective_keys?.includes(selectedObjective.objective_key))
                          .map((throughline) => (
                            <div key={throughline.throughline_key} className="border border-border bg-background/70 p-3">
                              <div className="flex items-center gap-2">
                                <Route className="h-4 w-4 text-muted-foreground" />
                                <p className="text-sm font-medium">{throughline.title}</p>
                              </div>
                              <p className="mt-1 break-all text-xs text-muted-foreground">
                                {throughline.throughline_key}
                              </p>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Signals
                      </p>
                      <Badge variant="outline">{objectiveSignals.length}</Badge>
                    </div>
                    {signalsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading signals...
                      </div>
                    ) : objectiveSignals.length ? (
                      <div className="space-y-3">
                        {objectiveSignals.slice(0, 25).map((signal) => {
                          const url = signal.evidence?.url;
                          return (
                            <div key={signal.signal_id} className="border border-border bg-background/70 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{signal.kind}</Badge>
                                <span className="break-all text-xs text-muted-foreground">
                                  {signal.anchor}
                                </span>
                              </div>
                              <p className="mt-2 line-clamp-3 text-sm">
                                {evidenceText(signal)}
                              </p>
                              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span>{formatDate(signal.occurred_at)}</span>
                                {typeof url === "string" && url.trim() ? (
                                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Evidence
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        title="No signals loaded"
                        body="Select another objective or refresh generated state."
                      />
                    )}
                  </div>

                  <pre className="max-h-80 overflow-auto border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
                    {jsonPreview(selectedObjective)}
                  </pre>
                </div>
              ) : (
                <EmptyState
                  title="Select an objective"
                  body="Choose an objective to inspect anchors, throughlines, and evidence signals."
                />
              )}
            </DetailShell>
          </section>
        </TabsContent>

        <TabsContent value="chat" className="mt-0 flex-1">
          <MemoryChat
            selectedArtifacts={selectedArtifactsForChat}
            onRemoveArtifact={(id) => {
              setSelectedArtifactIds((current) => current.filter((artifactId) => artifactId !== id));
              setSelectedArtifactSnapshots((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
            }}
            onClearArtifacts={() => {
              setSelectedArtifactIds([]);
              setSelectedArtifactSnapshots({});
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
