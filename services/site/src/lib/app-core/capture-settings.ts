import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

export type CaptureDispatchSettings = {
  destinationType: "none" | "prism-hook" | "external-http";
  prismHookKey: string | null;
  externalUrl: string | null;
  externalHeaderName: string | null;
  externalHeaderValue: string | null;
  autoDispatchOnTranscript: boolean;
};

export const defaultCaptureDispatchSettings: CaptureDispatchSettings = {
  destinationType: "prism-hook",
  prismHookKey: "recording-transcript-completed",
  externalUrl: null,
  externalHeaderName: null,
  externalHeaderValue: null,
  autoDispatchOnTranscript: true,
};

function settingsPath() {
  return path.resolve(loadConfig().dataRoot, "capture-settings.json");
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDestinationType(value: unknown): CaptureDispatchSettings["destinationType"] {
  return value === "prism-hook" || value === "external-http" ? value : "none";
}

export function normalizeCaptureDispatchSettings(value: unknown): CaptureDispatchSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    destinationType: normalizeDestinationType(record.destinationType ?? record.destination_type),
    prismHookKey: stringValue(record.prismHookKey ?? record.prism_hook_key),
    externalUrl: stringValue(record.externalUrl ?? record.external_url),
    externalHeaderName: stringValue(record.externalHeaderName ?? record.external_header_name),
    externalHeaderValue: stringValue(record.externalHeaderValue ?? record.external_header_value),
    autoDispatchOnTranscript: typeof record.autoDispatchOnTranscript === "boolean"
      ? record.autoDispatchOnTranscript
      : typeof record.auto_dispatch_on_transcript === "boolean"
        ? record.auto_dispatch_on_transcript
        : false,
  };
}

export async function readCaptureDispatchSettings() {
  try {
    const content = await fs.readFile(settingsPath(), "utf8");
    return {
      ...defaultCaptureDispatchSettings,
      ...normalizeCaptureDispatchSettings(JSON.parse(content)),
    };
  } catch {
    return defaultCaptureDispatchSettings;
  }
}

export async function writeCaptureDispatchSettings(value: unknown) {
  const settings = normalizeCaptureDispatchSettings(value);
  const resolved = settingsPath();
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}
