import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { getWorkflowByKey, loadConfig, upsertWorkflow } from "@/lib/app-core";
import { readRouteParam, requireLocalAdminAccess } from "@/lib/local-admin-api";

type RouteContext = {
  params: Promise<{ key: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function workflowSteps(definition: Record<string, unknown>) {
  return Array.isArray(definition.steps) ? definition.steps.filter(isRecord) : [];
}

function resolveWorkflowFile(rawPath: unknown) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return null;
  }

  const config = loadConfig();
  const normalized = rawPath.trim();
  const siteWorkflowRoots = [
    path.resolve(config.workspaceRoot, "workflows"),
    path.resolve(config.repoRoot, "services/site/workflows"),
  ];
  const dataWorkflowRoot = path.resolve(config.dataRoot, "workflows");
  const candidates = path.isAbsolute(normalized)
    ? [path.resolve(normalized)]
    : [
        path.resolve(config.workspaceRoot, normalized),
        path.resolve(config.workspaceRoot, "workflows", normalized.replace(/^workflows\/+/, "")),
        path.resolve(config.repoRoot, "services/site", normalized.replace(/^\/+/, "")),
      ];
  const allowedRoots = [...siteWorkflowRoots, dataWorkflowRoot].map((allowedRoot) => {
    try {
      return fs.realpathSync(allowedRoot);
    } catch {
      return allowedRoot;
    }
  });

  const absolutePath = candidates.find((candidate) => {
    return allowedRoots.some((allowedRoot) => candidate === allowedRoot || candidate.startsWith(`${allowedRoot}${path.sep}`));
  });
  if (!absolutePath) {
    return null;
  }

  try {
    const realPath = fs.realpathSync(absolutePath);
    if (!allowedRoots.some((allowedRoot) => realPath === allowedRoot || realPath.startsWith(`${allowedRoot}${path.sep}`))) {
      return null;
    }
    return {
      path: realPath,
      content: fs.readFileSync(realPath, "utf8").trim(),
    };
  } catch {
    return {
      path: absolutePath,
      content: null,
    };
  }
}

async function requireWorkflowReadAccess() {
  return requireLocalAdminAccess();
}

function parseBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function parseWorkflowDefinition(value: unknown) {
  if (isRecord(value)) {
    return { definition: value, error: null };
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!isRecord(parsed)) {
        return { definition: null, error: "Workflow definition must be a JSON object" };
      }
      return { definition: parsed, error: null };
    } catch {
      return { definition: null, error: "Workflow definition is not valid JSON" };
    }
  }
  return { definition: null, error: "Workflow definition is required" };
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireWorkflowReadAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { key } = await context.params;
  const workflow = getWorkflowByKey(readRouteParam(key));
  if (!workflow) {
    return NextResponse.json({ ok: false, error: "Workflow not found" }, { status: 404 });
  }

  const workflowFile = resolveWorkflowFile(workflow.definition.workflowPath);
  const steps = workflowSteps(workflow.definition).map((step) => {
    const instructionFile = resolveWorkflowFile(step.instructionPath);
    return {
      key: typeof step.key === "string" ? step.key : "",
      label: typeof step.label === "string" ? step.label : typeof step.name === "string" ? step.name : "",
      type: typeof step.type === "string" ? step.type : "agent",
      instructionPath: typeof step.instructionPath === "string" ? step.instructionPath : null,
      resolvedInstructionPath: instructionFile?.path ?? null,
      instructionContent: instructionFile?.content ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    workflow,
    detail: {
      workflowPath: typeof workflow.definition.workflowPath === "string" ? workflow.definition.workflowPath : null,
      resolvedWorkflowPath: workflowFile?.path ?? null,
      workflowContent: workflowFile?.content ?? null,
      steps,
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireWorkflowReadAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { key } = await context.params;
  const workflow = getWorkflowByKey(readRouteParam(key));
  if (!workflow) {
    return NextResponse.json({ ok: false, error: "Workflow not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseWorkflowDefinition(body?.definition ?? body?.manifest ?? body?.definitionJson ?? body?.manifestJson);
  if (parsed.error || !parsed.definition) {
    return NextResponse.json({ ok: false, error: parsed.error ?? "Workflow definition is required" }, { status: 400 });
  }
  if (parsed.definition.key !== workflow.key) {
    return NextResponse.json({ ok: false, error: "Workflow definition key does not match requested key" }, { status: 400 });
  }
  if (!Array.isArray(parsed.definition.steps) || !parsed.definition.steps.length) {
    return NextResponse.json({ ok: false, error: "Workflow definition must include steps" }, { status: 400 });
  }

  const updated = upsertWorkflow({
    key: workflow.key,
    name: typeof body?.name === "string" && body.name.trim()
      ? body.name.trim()
      : typeof parsed.definition.name === "string" && parsed.definition.name.trim()
        ? parsed.definition.name.trim()
        : workflow.name,
    description: body?.description === null
      ? null
      : typeof body?.description === "string"
        ? body.description
        : typeof parsed.definition.description === "string"
          ? parsed.definition.description
          : workflow.description,
    version: typeof parsed.definition.version === "number" && Number.isFinite(parsed.definition.version)
      ? parsed.definition.version
      : workflow.version,
    definition: parsed.definition,
    systemDefault: workflow.systemDefault,
    enabled: parseBoolean(body?.enabled, workflow.enabled),
  });

  return NextResponse.json({ ok: true, workflow: updated });
}
