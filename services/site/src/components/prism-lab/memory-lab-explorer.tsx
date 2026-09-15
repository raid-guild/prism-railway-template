"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Bot,
  Brain,
  CalendarDays,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { AgentAvatar } from "@/components/prism-lab/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { ChatMessageTimestamp } from "@/components/chat-message-timestamp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AdminSetupStatus } from "@/lib/admin";
import type { LabRollingDay, LabRollingEntry } from "@/lib/prism-lab/memory";

type MemoryReferenceInput =
  | { type: "rolling-day"; date: string }
  | { type: "knowledge-doc"; slug: string };
type KnowledgeResult = {
  slug: string;
  title?: string | null;
  summary?: string | null;
  kind?: string | null;
  updated?: string | null;
  tags?: string[];
  entities?: string[];
  score?: number;
};
type KnowledgeDocument = KnowledgeResult & {
  content?: string;
  metadata?: Record<string, unknown>;
  path?: string;
  meta_path?: string;
};
type MemorySource = {
  id: string;
  label?: string;
  repo_url?: string;
  branch?: string;
  status?: string;
  state?: {
    status?: string;
    doc_count?: number;
    last_synced_at?: string;
    error?: { message?: string } | null;
  };
};
type EligibleAgent = {
  key: string;
  name: string;
  avatarUrl: string | null;
  accentColor: string;
  description: string | null;
  version: number;
  systemKey: string | null;
};
type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
  created_at?: string;
};

function apiError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
  )
    return (payload as { error: string }).error;
  return fallback;
}

async function fetchJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      apiError(payload, `Request failed with ${response.status}`),
    );
  return payload as T;
}

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function weekKey(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function sectionLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relatedDocuments(document: KnowledgeDocument) {
  const value =
    document.metadata?.related_docs ?? document.metadata?.relatedDocs;
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function EvidenceEntry({ entry }: { entry: LabRollingEntry }) {
  return (
    <article className="border-l-2 border-border/70 bg-card/30 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {entry.bucket ? <Badge variant="outline">{entry.bucket}</Badge> : null}
        {entry.stale ? <Badge variant="destructive">Stale</Badge> : null}
        {entry.lastSeen ? (
          <span className="text-xs text-muted-foreground">
            Last seen {entry.lastSeen}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-6">{entry.text}</p>
      {entry.evidence.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {entry.evidence.length} evidence{" "}
            {entry.evidence.length === 1 ? "reference" : "references"}
          </summary>
          <div className="mt-2 space-y-2">
            {entry.evidence.map((evidence, index) => (
              <blockquote
                key={`${evidence.timestamp}-${index}`}
                className="border-l border-primary/50 pl-3 text-xs leading-5"
              >
                <p>{evidence.text}</p>
                <footer className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                  <span>{evidence.author || "Unknown author"}</span>
                  {evidence.timestamp ? (
                    <span>{evidence.timestamp}</span>
                  ) : null}
                  {evidence.jumpUrl ? (
                    <a
                      href={evidence.jumpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline"
                    >
                      Source
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </footer>
              </blockquote>
            ))}
          </div>
        </details>
      ) : entry.sourceDigestPath ? (
        <p className="mt-2 font-mono text-[0.68rem] text-muted-foreground">
          {entry.sourceDigestPath}
        </p>
      ) : null}
    </article>
  );
}

function AskAgentPanel({
  references,
  canChatAgents,
  onClose,
}: {
  references: MemoryReferenceInput[];
  canChatAgents: boolean;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<EligibleAgent[]>([]);
  const [agentKey, setAgentKey] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    fetchJson<{ agents: EligibleAgent[] }>(
      "/admin/memory/api/eligible-agents",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ references }),
      },
    )
      .then((payload) => {
        if (!canceled) {
          setAgents(payload.agents ?? []);
          setAgentKey(payload.agents?.[0]?.key ?? "");
        }
      })
      .catch((caught) => {
        if (!canceled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not resolve eligible agents",
          );
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [references]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !agentKey) return;
    setSending(true);
    setError(null);
    try {
      const payload = await fetchJson<{
        session: { id: string };
        messages: ChatMessage[];
      }>("/admin/memory/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          agentProfileKey: agentKey,
          references,
          sessionId,
        }),
      });
      setSessionId(payload.session.id);
      setMessages(payload.messages ?? []);
      setQuestion("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Memory conversation failed",
      );
    } finally {
      setSending(false);
    }
  }

  const activeAgent = agents.find((agent) => agent.key === agentKey);
  return (
    <aside
      className="fixed inset-0 z-[80] flex justify-end bg-black/55"
      aria-label="Ask an agent about Memory"
    >
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close Memory conversation"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 p-4">
          <div>
            <h2 className="font-semibold">Ask an agent</h2>
            <p className="text-xs text-muted-foreground">
              Read-only · {references.length} selected{" "}
              {references.length === 1 ? "reference" : "references"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!canChatAgents ? (
            <p className="text-sm text-muted-foreground">
              Your role can browse Memory but cannot start agent conversations.
            </p>
          ) : loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" />
              Resolving eligible agents…
            </p>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No available Agent Profile can access every selected reference.
              Narrow the selection or ask an administrator to configure an agent
              memory scope.
            </p>
          ) : (
            <>
              <div>
                <Label>Agent Profile</Label>
                <Select
                  value={agentKey}
                  onValueChange={(value) => {
                    setAgentKey(value);
                    setSessionId(null);
                    setMessages([]);
                  }}
                  disabled={Boolean(sessionId)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.key} value={agent.key}>
                        {agent.name} · v{agent.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeAgent ? (
                  <div className="mt-3 flex gap-3 border border-border/60 p-3">
                    <AgentAvatar
                      name={activeAgent.name}
                      avatarUrl={activeAgent.avatarUrl}
                      accentColor={activeAgent.accentColor}
                      className="h-9 w-9 rounded-md"
                    />
                    <div>
                      <p className="text-sm font-medium">{activeAgent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {activeAgent.description || "No mandate provided"}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-5 space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "assistant"
                        ? "border-l-2 border-border bg-muted/20 p-3 text-sm"
                        : "ml-8 border-l-2 border-primary/60 bg-primary/10 p-3 text-sm"
                    }
                  >
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <Badge variant="outline">{message.role}</Badge>
                      {message.createdAt ?? message.created_at ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <ChatMessageTimestamp
                            value={message.createdAt ?? message.created_at}
                          />
                        </>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap leading-6">
                      {message.content}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
          {error ? (
            <p
              className="mt-4 border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
        {agents.length ? (
          <form onSubmit={submit} className="border-t border-border/60 p-4">
            <Label htmlFor="memory-question">Question</Label>
            <Textarea
              id="memory-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              placeholder="Ask for a grounded comparison, summary, or explanation…"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[0.68rem] text-muted-foreground">
                This session cannot mutate requests, workflows, or knowledge.
              </p>
              <Button
                type="submit"
                disabled={sending || !question.trim() || !agentKey}
              >
                {sending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <MessageSquareText />
                )}
                {sending ? "Asking…" : "Ask"}
              </Button>
            </div>
            {sessionId && activeAgent ? (
              <Link
                className="mt-3 inline-block text-xs underline"
                href={`/admin/lab/agents/${encodeURIComponent(activeAgent.key)}?memorySession=${encodeURIComponent(sessionId)}`}
              >
                Continue in {activeAgent.name} Console
              </Link>
            ) : null}
          </form>
        ) : null}
      </div>
    </aside>
  );
}

export function MemoryLabExplorer({
  setup,
  canChatAgents,
  canManageSources,
}: {
  setup: AdminSetupStatus["prismMemory"];
  canChatAgents: boolean;
  canManageSources: boolean;
}) {
  const [mode, setMode] = useState<"timeline" | "knowledge">("timeline");
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [day, setDay] = useState<LabRollingDay | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineWarning, setTimelineWarning] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [tag, setTag] = useState("all");
  const [entity, setEntity] = useState("all");
  const [source, setSource] = useState("all");
  const [audience, setAudience] = useState("all");
  const [stability, setStability] = useState("all");
  const [facets, setFacets] = useState<{
    kinds: string[];
    tags: string[];
    entities: string[];
    audiences: string[];
    stabilities: string[];
  }>({ kinds: [], tags: [], entities: [], audiences: [], stabilities: [] });
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(
    null,
  );
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<
    MemoryReferenceInput[]
  >([]);
  const [askOpen, setAskOpen] = useState(false);

  const loadDay = useCallback(async (date: string) => {
    setTimelineLoading(true);
    setTimelineError(null);
    setTimelineWarning(null);
    try {
      const payload = await fetchJson<{ day: LabRollingDay }>(
        `/admin/memory/api/rolling/${encodeURIComponent(date)}`,
      );
      setDay(payload.day);
      setSelectedDate(date);
    } catch (caught) {
      setTimelineError(
        caught instanceof Error
          ? caught.message
          : "Could not load rolling Memory",
      );
      setDay(null);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const payload = await fetchJson<{
        dates: string[];
        latestDate: string | null;
        warnings?: string[];
      }>("/admin/memory/api/rolling");
      setDates(payload.dates ?? []);
      setTimelineWarning(payload.warnings?.filter(Boolean).join(" ") || null);
      const date =
        selectedDate && payload.dates.includes(selectedDate)
          ? selectedDate
          : payload.latestDate;
      if (date) await loadDay(date);
    } catch (caught) {
      setTimelineError(
        caught instanceof Error
          ? caught.message
          : "Could not load Memory timeline",
      );
    } finally {
      setTimelineLoading(false);
    }
  }, [loadDay, selectedDate]);

  useEffect(() => {
    if (setup.reachable) void loadTimeline();
  }, [setup.reachable]);
  useEffect(() => {
    if (!setup.reachable) return;
    fetchJson<{
      facets: {
        kinds?: string[];
        tags?: string[];
        entities?: string[];
        audiences?: string[];
        stabilities?: string[];
      };
      sources?: MemorySource[];
    }>("/admin/memory/api/knowledge/facets")
      .then((payload) => {
        setFacets({
          kinds: payload.facets.kinds ?? [],
          tags: payload.facets.tags ?? [],
          entities: payload.facets.entities ?? [],
          audiences: payload.facets.audiences ?? [],
          stabilities: payload.facets.stabilities ?? [],
        });
        setSources(payload.sources ?? []);
      })
      .catch(() => undefined);
  }, [setup.reachable]);

  const groupedDates = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const date of dates) {
      const key = weekKey(date);
      groups.set(key, [...(groups.get(key) ?? []), date]);
    }
    return [...groups.entries()];
  }, [dates]);
  const daySelected = selectedDate
    ? selectedReferences.some(
        (item) => item.type === "rolling-day" && item.date === selectedDate,
      )
    : false;
  function toggleReference(reference: MemoryReferenceInput) {
    const key =
      reference.type === "rolling-day"
        ? `${reference.type}:${reference.date}`
        : `${reference.type}:${reference.slug}`;
    setSelectedReferences((current) =>
      current.some(
        (item) =>
          (item.type === "rolling-day"
            ? `${item.type}:${item.date}`
            : `${item.type}:${item.slug}`) === key,
      )
        ? current.filter(
            (item) =>
              (item.type === "rolling-day"
                ? `${item.type}:${item.date}`
                : `${item.type}:${item.slug}`) !== key,
          )
        : [...current, reference].slice(-8),
    );
  }

  async function searchKnowledge(event: FormEvent) {
    event.preventDefault();
    if (
      !query.trim() &&
      kind === "all" &&
      tag === "all" &&
      entity === "all" &&
      source === "all" &&
      audience === "all" &&
      stability === "all"
    )
      return;
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    setSelectedDoc(null);
    const params = new URLSearchParams({ limit: "50" });
    if (query.trim()) params.set("q", query.trim());
    if (kind !== "all") params.set("kind", kind);
    if (tag !== "all") params.set("tag", tag);
    if (entity !== "all") params.set("entity", entity);
    if (source !== "all") params.set("source", source);
    if (audience !== "all") params.set("audience", audience);
    if (stability !== "all") params.set("stability", stability);
    try {
      const payload = await fetchJson<{ results?: KnowledgeResult[] }>(
        `/admin/memory/api/knowledge/search?${params}`,
      );
      setResults(payload.results ?? []);
    } catch (caught) {
      setKnowledgeError(
        caught instanceof Error ? caught.message : "Knowledge search failed",
      );
      setResults([]);
    } finally {
      setKnowledgeLoading(false);
    }
  }
  async function loadDocument(slug: string) {
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      setSelectedDoc(
        await fetchJson<KnowledgeDocument>(
          `/admin/memory/api/knowledge/docs/${slug.split("/").map(encodeURIComponent).join("/")}`,
        ),
      );
    } catch (caught) {
      setKnowledgeError(
        caught instanceof Error
          ? caught.message
          : "Could not load knowledge document",
      );
    } finally {
      setKnowledgeLoading(false);
    }
  }

  if (!setup.configured)
    return (
      <section className="mx-auto max-w-3xl p-6 sm:p-10">
        <Badge variant="outline">Not configured</Badge>
        <h1 className="mt-4 text-2xl font-semibold">
          Prism Memory is not configured
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set PRISM_MEMORY_BASE_URL on Site to enable this workspace context.
        </p>
      </section>
    );
  if (!setup.reachable)
    return (
      <section className="mx-auto max-w-3xl p-6 sm:p-10">
        <Badge variant="destructive">Memory offline</Badge>
        <h1 className="mt-4 text-2xl font-semibold">
          Memory remains configured but is unavailable
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Space {setup.space ?? "unknown"} ·{" "}
          {setup.error || `health returned ${setup.status ?? "no status"}`}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          The navigator remains stable during outages. No cached Memory is being
          presented as current.
        </p>
      </section>
    );

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <header className="border-b border-border/60 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
              <Brain className="h-4 w-4" />
              Workspace Memory
            </div>
            <h1 className="mt-2 text-2xl font-semibold">Memory Explorer</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Rolling evidence and durable knowledge for space{" "}
              {setup.space ?? "unknown"}.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={mode === "timeline" ? "secondary" : "ghost"}
              onClick={() => setMode("timeline")}
            >
              <CalendarDays />
              Timeline
            </Button>
            <Button
              variant={mode === "knowledge" ? "secondary" : "ghost"}
              onClick={() => setMode("knowledge")}
            >
              <BookOpen />
              Knowledge
            </Button>
          </div>
        </div>
      </header>
      {mode === "timeline" ? (
        <div className="grid min-h-[calc(100vh-11rem)] lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="border-b border-border/60 p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider">
                Daily rollups
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void loadTimeline()}
                aria-label="Refresh timeline"
              >
                <RefreshCw />
              </Button>
            </div>
            {timelineWarning ? (
              <p className="mt-3 border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-amber-200" role="status">
                {timelineWarning}
              </p>
            ) : null}
            <div className="mt-3 max-h-[65vh] space-y-4 overflow-y-auto">
              {groupedDates.map(([week, weekDates]) => (
                <section key={week}>
                  <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                    Week of {displayDate(week)}
                  </p>
                  {weekDates.map((date, index) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => void loadDay(date)}
                      className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-sm ${date === selectedDate ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50"}`}
                    >
                      <span>{displayDate(date)}</span>
                      {index === 0 && date === dates[0] ? (
                        <Badge variant="outline">Latest</Badge>
                      ) : null}
                    </button>
                  ))}
                </section>
              ))}
              {dates.length === 0 && !timelineLoading ? (
                <p className="text-xs text-muted-foreground">
                  No dated rolling snapshots were indexed.
                </p>
              ) : null}
            </div>
          </aside>
          <main className="min-w-0 p-4 sm:p-6">
            {timelineLoading && !day ? (
              <p className="flex gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Loading rolling Memory…
              </p>
            ) : timelineError ? (
              <p className="border border-destructive/50 p-4 text-sm text-destructive">
                {timelineError}
              </p>
            ) : day ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-5">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>
                        {day.date === dates[0] ? "Latest daily" : "Daily"}
                      </Badge>
                      {day.buckets.map((bucket) => (
                        <Badge key={bucket} variant="outline">
                          {bucket}
                          {bucket === "meetings" ? " · meeting" : ""}
                        </Badge>
                      ))}
                    </div>
                    <h2 className="mt-3 text-xl font-semibold">
                      {displayDate(day.date)}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {day.narrative ||
                        "Deterministic daily rollup with source-linked evidence."}
                    </p>
                  </div>
                  <Button
                    variant={daySelected ? "secondary" : "outline"}
                    onClick={() =>
                      toggleReference({ type: "rolling-day", date: day.date })
                    }
                  >
                    {daySelected ? "Selected for agent" : "Select day"}
                  </Button>
                </div>
                <div className="mt-6 space-y-7">
                  {Object.entries(day.sections)
                    .filter(([, entries]) => entries.length)
                    .map(([section, entries]) => (
                      <section key={section}>
                        <div className="mb-3 flex items-center gap-2">
                          <h3 className="font-semibold">
                            {sectionLabel(section)}
                          </h3>
                          <Badge variant="outline">{entries.length}</Badge>
                        </div>
                        <div className="space-y-3">
                          {entries.map((entry, index) => (
                            <EvidenceEntry
                              key={`${entry.sourceDigestPath}-${index}`}
                              entry={entry}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                </div>
              </>
            ) : null}
          </main>
        </div>
      ) : (
        <div className="grid min-h-[calc(100vh-11rem)] xl:grid-cols-[minmax(20rem,0.8fr)_minmax(24rem,1.2fr)]">
          <section className="border-b border-border/60 p-4 sm:p-6 xl:border-b-0 xl:border-r">
            <form onSubmit={searchKnowledge} className="space-y-3">
              <div>
                <Label htmlFor="knowledge-query">
                  Search durable knowledge
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="knowledge-query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Policy, project, process, entity…"
                  />
                  <Button
                    type="submit"
                    disabled={
                      knowledgeLoading ||
                      (!query.trim() &&
                        kind === "all" &&
                        tag === "all" &&
                        entity === "all" &&
                        source === "all" &&
                        audience === "all" &&
                        stability === "all")
                    }
                  >
                    <Search />
                    Search
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kind" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All kinds</SelectItem>
                    {facets.kinds.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={tag} onValueChange={setTag}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tags</SelectItem>
                    {facets.tags.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={entity} onValueChange={setEntity}>
                  <SelectTrigger>
                    <SelectValue placeholder="Entity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All entities</SelectItem>
                    {facets.entities.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    {sources.map((value) => (
                      <SelectItem key={value.id} value={value.id}>
                        {value.label || value.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={audience} onValueChange={setAudience}>
                  <SelectTrigger>
                    <SelectValue placeholder="Audience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All audiences</SelectItem>
                    {facets.audiences.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={stability} onValueChange={setStability}>
                  <SelectTrigger>
                    <SelectValue placeholder="Stability" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stability</SelectItem>
                    {facets.stabilities.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </form>
            {knowledgeError ? (
              <p className="mt-4 text-sm text-destructive">{knowledgeError}</p>
            ) : null}
            <div className="mt-5 space-y-2">
              {results.map((result) => (
                <button
                  key={result.slug}
                  type="button"
                  onClick={() => void loadDocument(result.slug)}
                  className="w-full border border-border/60 p-3 text-left hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {result.title || result.slug}
                    </span>
                    {result.kind ? (
                      <Badge variant="outline">{result.kind}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {result.summary || result.slug}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(result.tags ?? []).slice(0, 5).map((value) => (
                      <Badge key={value} variant="muted">
                        {value}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
              {results.length === 0 && !knowledgeLoading ? (
                <div className="border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Search text or choose a metadata facet. Search runs against
                  Prism Memory, not only this page.
                </div>
              ) : null}
            </div>
            <details className="mt-6 border border-border/60 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Knowledge sources · {sources.length}
              </summary>
              <div className="mt-3 space-y-2">
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="border-t border-border/50 pt-2 text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">
                        {source.label || source.id}
                      </span>
                      <Badge variant="outline">
                        {source.state?.status || source.status || "unknown"}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-muted-foreground">
                      {source.repo_url || "Non-repository source"}
                      {source.branch ? ` · ${source.branch}` : ""}
                    </p>
                  </div>
                ))}
                {canManageSources ? (
                  <Link
                    href="/admin/lab/settings"
                    className="inline-block text-xs underline"
                  >
                    Manage Memory configuration
                  </Link>
                ) : null}
              </div>
            </details>
          </section>
          <main className="min-w-0 p-4 sm:p-6">
            {knowledgeLoading && !selectedDoc ? (
              <p className="flex gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Loading knowledge…
              </p>
            ) : selectedDoc ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      {selectedDoc.kind ? (
                        <Badge>{selectedDoc.kind}</Badge>
                      ) : null}
                      {(selectedDoc.tags ?? []).map((value) => (
                        <Badge key={value} variant="outline">
                          {value}
                        </Badge>
                      ))}
                    </div>
                    <h2 className="mt-3 text-xl font-semibold">
                      {selectedDoc.title || selectedDoc.slug}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {selectedDoc.summary}
                    </p>
                    <p className="mt-2 font-mono text-[0.68rem] text-muted-foreground">
                      knowledge:{selectedDoc.slug}
                    </p>
                  </div>
                  <Button
                    variant={
                      selectedReferences.some(
                        (item) =>
                          item.type === "knowledge-doc" &&
                          item.slug === selectedDoc.slug,
                      )
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() =>
                      toggleReference({
                        type: "knowledge-doc",
                        slug: selectedDoc.slug,
                      })
                    }
                  >
                    {selectedReferences.some(
                      (item) =>
                        item.type === "knowledge-doc" &&
                        item.slug === selectedDoc.slug,
                    )
                      ? "Selected for agent"
                      : "Select document"}
                  </Button>
                </div>
                <article className="mt-5 whitespace-pre-wrap text-sm leading-7">
                  {selectedDoc.content || "No document body returned."}
                </article>
                {relatedDocuments(selectedDoc).length ? (
                  <section className="mt-6 border border-border/60 p-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider">
                      Connections
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {relatedDocuments(selectedDoc).map((slug) => (
                        <Button
                          key={slug}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadDocument(slug)}
                        >
                          {slug}
                        </Button>
                      ))}
                    </div>
                    <p className="mt-2 text-[0.68rem] text-muted-foreground">
                      Only explicit related-document metadata is shown; shared
                      tags are not treated as stronger graph edges.
                    </p>
                  </section>
                ) : null}
                <details className="mt-6 border border-border/60 p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Metadata and provenance
                  </summary>
                  <pre className="mt-3 overflow-auto text-[0.68rem]">
                    {JSON.stringify(selectedDoc.metadata ?? {}, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-border/60 text-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  Select a knowledge document
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Content, metadata, ownership, stability, and source provenance
                  appear here.
                </p>
              </div>
            )}
          </main>
        </div>
      )}
      {selectedReferences.length ? (
        <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 border border-primary/40 bg-background px-4 py-3 shadow-xl">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm">{selectedReferences.length} selected</span>
          <Button
            size="sm"
            onClick={() => setAskOpen(true)}
            disabled={!canChatAgents}
          >
            <Bot />
            Ask an agent
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedReferences([])}
          >
            Clear
          </Button>
        </div>
      ) : null}
      {askOpen ? (
        <AskAgentPanel
          references={selectedReferences}
          canChatAgents={canChatAgents}
          onClose={() => setAskOpen(false)}
        />
      ) : null}
    </div>
  );
}
