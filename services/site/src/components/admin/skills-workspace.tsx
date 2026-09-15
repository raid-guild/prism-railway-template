"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { BookOpen, Eye, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type SkillRecord = {
  name: string;
  path: string;
  description: string | null;
  source: "site" | "source" | "custom";
  kind: "built-in" | "source" | "custom";
  readOnly: boolean;
  sourceKey?: string | null;
  sourceName?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  commitSha?: string | null;
};

type SkillSourceRecord = {
  key: string;
  name: string;
  provider: "github";
  repoUrl: string;
  branch: string;
  sourcePath: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastCommitSha: string | null;
  lastError: string | null;
  lastSkillCount: number;
};

type SkillsPayload = {
  ok?: boolean;
  skills?: SkillRecord[];
  error?: string;
};

type SkillSourcesPayload = {
  ok?: boolean;
  sources?: SkillSourceRecord[];
  source?: SkillSourceRecord;
  error?: string;
};

type SkillContentPayload = {
  ok?: boolean;
  name?: string;
  content?: string;
  error?: string;
};

type DeleteSkillPayload = {
  ok?: boolean;
  error?: string;
};

type SkillsView = "custom" | "source" | "built-in";

function sourceLabel(source: SkillRecord["source"]) {
  if (source === "custom") return "site volume";
  if (source === "source") return "GitHub source";
  return "site";
}

function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 8) : null;
}

export function SkillsWorkspace() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [sources, setSources] = useState<SkillSourceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillRecord | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>("");
  const [isViewing, setIsViewing] = useState(false);
  const [activeView, setActiveView] = useState<SkillsView>("custom");
  const [sourceForm, setSourceForm] = useState({
    key: "",
    name: "",
    repoUrl: "",
    branch: "main",
    sourcePath: "skills",
  });
  const [isRefreshing, startRefresh] = useTransition();
  const [isSavingSource, startSavingSource] = useTransition();

  async function loadSkills() {
    const [skillsResponse, sourcesResponse] = await Promise.all([
      fetch("/admin/skills", { cache: "no-store" }),
      fetch("/admin/skill-sources", { cache: "no-store" }),
    ]);
    const skillsPayload = (await skillsResponse.json()) as SkillsPayload;
    if (!skillsResponse.ok || !skillsPayload.ok || !Array.isArray(skillsPayload.skills)) {
      throw new Error(skillsPayload.error || "Could not load skills");
    }
    const sourcesPayload = (await sourcesResponse.json()) as SkillSourcesPayload;
    if (!sourcesResponse.ok || !sourcesPayload.ok || !Array.isArray(sourcesPayload.sources)) {
      throw new Error(sourcesPayload.error || "Could not load skill sources");
    }
    setSkills(skillsPayload.skills);
    setSources(sourcesPayload.sources);
    setError(null);
  }

  function refresh() {
    setError(null);
    startRefresh(async () => {
      try {
        await loadSkills();
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Could not load skills",
        );
      }
    });
  }

  async function viewSkill(skill: SkillRecord) {
    setSelectedSkill(skill);
    setSelectedContent("");
    setIsViewing(true);
    try {
      const response = await fetch(
        `/admin/skills/${encodeURIComponent(skill.name)}`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as SkillContentPayload;
      if (!response.ok || !payload.ok || typeof payload.content !== "string") {
        throw new Error(payload.error || "Could not load skill");
      }
      setSelectedContent(payload.content);
    } catch (nextError) {
      setSelectedContent(
        nextError instanceof Error ? nextError.message : "Could not load skill",
      );
    }
  }

  async function deleteSkill(skill: SkillRecord) {
    if (skill.kind !== "custom") return;
    const confirmed = window.confirm(`Delete custom skill "${skill.name}"?`);
    if (!confirmed) return;

    setError(null);
    try {
      const response = await fetch(
        `/admin/skills/${encodeURIComponent(skill.name)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as DeleteSkillPayload;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not delete skill");
      }
      setSkills((current) =>
        current.filter((currentSkill) => currentSkill.name !== skill.name),
      );
      if (selectedSkill?.name === skill.name) {
        setSelectedSkill(null);
        setSelectedContent("");
        setIsViewing(false);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not delete skill",
      );
    }
  }

  function saveSource() {
    setError(null);
    startSavingSource(async () => {
      try {
        const response = await fetch("/admin/skill-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sourceForm),
        });
        const payload = (await response.json().catch(() => ({}))) as SkillSourcesPayload;
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not save skill source");
        }
        setSourceForm({ key: "", name: "", repoUrl: "", branch: "main", sourcePath: "skills" });
        await loadSkills();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not save skill source");
      }
    });
  }

  function syncSource(source: SkillSourceRecord) {
    setError(null);
    startRefresh(async () => {
      try {
        const response = await fetch(`/admin/skill-sources/${encodeURIComponent(source.key)}/sync`, {
          method: "POST",
        });
        const payload = (await response.json().catch(() => ({}))) as SkillSourcesPayload;
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not sync skill source");
        }
        await loadSkills();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not sync skill source");
      }
    });
  }

  function syncAllSources() {
    setError(null);
    startRefresh(async () => {
      try {
        const response = await fetch("/admin/skill-sources/sync", { method: "POST" });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok && response.status !== 207) {
          throw new Error(payload.error || "Could not sync skill sources");
        }
        await loadSkills();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not sync skill sources");
      }
    });
  }

  function deleteSource(source: SkillSourceRecord) {
    const confirmed = window.confirm(`Delete skill source "${source.key}"?`);
    if (!confirmed) return;
    setError(null);
    startRefresh(async () => {
      try {
        const response = await fetch(`/admin/skill-sources/${encodeURIComponent(source.key)}`, {
          method: "DELETE",
        });
        const payload = (await response.json().catch(() => ({}))) as SkillSourcesPayload;
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not delete skill source");
        }
        await loadSkills();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not delete skill source");
      }
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(
    () => ({
      total: skills.length,
      builtIn: skills.filter((skill) => skill.kind === "built-in").length,
      custom: skills.filter((skill) => skill.kind === "custom").length,
      source: skills.filter((skill) => skill.kind === "source").length,
    }),
    [skills],
  );
  const customSkills = useMemo(
    () => skills.filter((skill) => skill.kind === "custom"),
    [skills],
  );
  const builtInSkills = useMemo(
    () => skills.filter((skill) => skill.kind === "built-in"),
    [skills],
  );
  const sourceSkills = useMemo(
    () => skills.filter((skill) => skill.kind === "source"),
    [skills],
  );
  const viewOptions: Array<{
    value: SkillsView;
    label: string;
    count: number;
  }> = [
    { value: "custom", label: "Custom Skills", count: customSkills.length },
    { value: "source", label: "Source Skills", count: sourceSkills.length },
    {
      value: "built-in",
      label: "Built-In Skills",
      count: builtInSkills.length,
    },
  ];

  function renderSkill(skill: SkillRecord) {
    return (
      <div
        key={`${skill.source}:${skill.name}`}
        className="grid gap-4 border border-border/70 bg-background p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,340px)_auto]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">{skill.name}</h2>
            <Badge variant={skill.kind === "custom" ? "default" : "outline"}>
              {skill.kind}
            </Badge>
            <Badge variant="outline">{sourceLabel(skill.source)}</Badge>
            {skill.sourceKey ? <Badge variant="secondary">{skill.sourceKey}</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {skill.description || "No description found."}
          </p>
        </div>
        <div className="min-w-0 self-center text-xs text-muted-foreground">
          <p className="truncate">{skill.path}</p>
          {skill.repoUrl ? <p className="mt-1 truncate">{skill.repoUrl}</p> : null}
          {skill.branch || skill.commitSha ? (
            <p className="mt-1 truncate">
              {skill.branch ? `branch ${skill.branch}` : null}
              {skill.branch && skill.commitSha ? " · " : null}
              {skill.commitSha ? `commit ${shortSha(skill.commitSha)}` : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => viewSkill(skill)}
          >
            <Eye className="h-4 w-4" />
            View
          </Button>
          {skill.kind === "custom" ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteSkill(skill)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground">
            View built-in, GitHub source, and instance custom agent skills available to Prism.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <section className="grid gap-5 px-5 md:px-6">
        <section className="grid gap-3 md:grid-cols-4">
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Skills
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.total}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Built-In
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.builtIn}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Source
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.source}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Custom
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.custom}</p>
          </div>
        </section>

        <section className="grid gap-3 border border-border/70 bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Skill Sources</h2>
              <p className="text-sm text-muted-foreground">
                Register read-only GitHub repositories that publish skills under a path.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={syncAllSources} disabled={isRefreshing || !sources.length}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Sync All
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_120px_120px_auto]">
            <div className="grid gap-1">
              <Label htmlFor="skill-source-key">Key</Label>
              <Input
                id="skill-source-key"
                value={sourceForm.key}
                onChange={(event) => setSourceForm((current) => ({ ...current, key: event.target.value }))}
                placeholder="raid-guild-agent-skills"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="skill-source-name">Name</Label>
              <Input
                id="skill-source-name"
                value={sourceForm.name}
                onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Raid Guild Agent Skills"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="skill-source-repo">Repository</Label>
              <Input
                id="skill-source-repo"
                value={sourceForm.repoUrl}
                onChange={(event) => setSourceForm((current) => ({ ...current, repoUrl: event.target.value }))}
                placeholder="https://github.com/raid-guild/agent-skills.git"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="skill-source-branch">Branch</Label>
              <Input
                id="skill-source-branch"
                value={sourceForm.branch}
                onChange={(event) => setSourceForm((current) => ({ ...current, branch: event.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="skill-source-path">Path</Label>
              <Input
                id="skill-source-path"
                value={sourceForm.sourcePath}
                onChange={(event) => setSourceForm((current) => ({ ...current, sourcePath: event.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={saveSource} disabled={isSavingSource}>
                Save
              </Button>
            </div>
          </div>
          {sources.length ? (
            <div className="grid gap-2">
              {sources.map((source) => (
                <div key={source.key} className="flex flex-wrap items-center justify-between gap-3 border border-border/60 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{source.name}</span>
                      <Badge variant={source.enabled ? "secondary" : "outline"}>{source.enabled ? "enabled" : "disabled"}</Badge>
                      <Badge variant="outline">{source.lastSkillCount} skills</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {source.repoUrl} · {source.branch} · {source.sourcePath}
                      {source.lastCommitSha ? ` · ${shortSha(source.lastCommitSha)}` : ""}
                    </p>
                    {source.lastSyncedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">Last synced {source.lastSyncedAt}</p>
                    ) : null}
                    {source.lastError ? (
                      <p className="mt-1 text-xs text-destructive">{source.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => syncSource(source)} disabled={isRefreshing}>
                      <RefreshCw className="h-4 w-4" />
                      Sync
                    </Button>
                    <Button type="button" variant="destructive" onClick={() => deleteSource(source)} disabled={isRefreshing}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
              No skill sources registered.
            </div>
          )}
        </section>

        <div className="inline-flex h-auto flex-wrap bg-transparent p-0">
          {viewOptions.map((option) => {
            const isActive = option.value === activeView;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveView(option.value)}
                className={[
                  "rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-border/70 bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {option.label}
                <span className="ml-2 text-muted-foreground">
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {activeView === "custom" ? (
          <section className="grid gap-3">
            {customSkills.map(renderSkill)}
            {!customSkills.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No custom skills discovered.
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "source" ? (
          <section className="grid gap-3">
            {sourceSkills.map(renderSkill)}
            {!sourceSkills.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No source skills discovered.
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "built-in" ? (
          <section className="grid gap-3">
            {builtInSkills.map(renderSkill)}
            {!builtInSkills.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No built-in skills discovered.
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-3">
          {!skills.length && !error ? (
            <div className="border border-border/70 bg-background px-4 py-8 text-sm text-muted-foreground">
              No skills discovered.
            </div>
          ) : null}
        </section>
      </section>

      <Dialog open={isViewing} onOpenChange={setIsViewing}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl min-w-0 flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="min-w-0 truncate pr-8">
              {selectedSkill?.name ?? "Skill"}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 overflow-x-auto border border-border/70 bg-muted/20">
            <pre className="max-w-full whitespace-pre-wrap break-words p-4 text-xs leading-6">
              {selectedContent || "Loading..."}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
