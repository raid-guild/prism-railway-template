import fs from "node:fs";
import path from "node:path";
import { getHostedSkillsRoot } from "./hosted-skills";
import { loadConfig } from "./config";

export const recordingSummaryProfileSkillName = "recording-summary-profile";

function stripFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    return normalized.trim();
  }
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) {
    return normalized.trim();
  }
  return normalized.slice(end + 4).trim();
}

function readSkillFile(root: string, name: string) {
  const resolvedRoot = path.resolve(root);
  const skillPath = path.resolve(resolvedRoot, name, "SKILL.md");
  const relative = path.relative(resolvedRoot, skillPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  try {
    return fs.readFileSync(skillPath, "utf8");
  } catch {
    return null;
  }
}

export function readRecordingSummaryProfile() {
  const config = loadConfig();
  const customContent = readSkillFile(config.customSkillsRoot, recordingSummaryProfileSkillName);
  if (customContent) {
    return {
      name: recordingSummaryProfileSkillName,
      source: "custom" as const,
      content: stripFrontmatter(customContent),
    };
  }

  const builtInContent = readSkillFile(getHostedSkillsRoot(config.repoRoot), recordingSummaryProfileSkillName);
  return {
    name: recordingSummaryProfileSkillName,
    source: "built-in" as const,
    content: stripFrontmatter(builtInContent ?? ""),
  };
}

