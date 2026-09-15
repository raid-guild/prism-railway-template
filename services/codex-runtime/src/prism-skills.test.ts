import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { credentialRequirementsFromSkillMarkdown, extractSkillBundleFromArchive, requestedSkillNames } from "./prism-skills.js";

async function skillArchive(entries: Array<{ name: string; content?: string; type?: "file" | "directory" }>) {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    pack.on("end", () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on("error", reject);
  });
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      pack.entry({ name: entry.name, type: entry.type ?? "file" }, entry.content ?? "", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  pack.finalize();
  return await completed;
}

test("skill frontmatter accepts credential assignment metadata", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: analytics-report
metadata:
  gateway-credentials: [plausible-production]
---
`), ["plausible-production"]);
});

test("invalid credential keys are ignored", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: unsafe
metadata:
  gateway-credentials: [sendgrid, "../../secret", "bad key"]
---
`), ["sendgrid"]);
});

test("Buzz channel administration requests load the protected admin skill", () => {
  assert.ok(requestedSkillNames("Create a private Buzz channel for delivery").includes("prism-buzz-channel-admin"));
  assert.ok(requestedSkillNames("Add this member to the channel", { transport: "buzz" }).includes("prism-buzz-channel-admin"));
  assert.equal(requestedSkillNames("Summarize this channel", { transport: "buzz" }).includes("prism-buzz-channel-admin"), false);
});

test("exact skill selection does not infer skills from workflow prompt text", () => {
  assert.deepEqual(
    requestedSkillNames("Run this workflow step, record the result, and deploy it", {
      requestedSkills: ["portal-publisher"],
      skillSelectionMode: "exact",
    }),
    ["portal-publisher"],
  );
  assert.deepEqual(
    requestedSkillNames("Run this workflow step and record the result", {
      requestedSkills: [],
      skillSelectionMode: "exact",
    }),
    [],
  );
});

test("hosted skill archives preserve scripts and references for native Codex discovery", async () => {
  const archive = await skillArchive([
    { name: "portal-ops/", type: "directory" },
    { name: "portal-ops/SKILL.md", content: "---\nname: portal-ops\ndescription: Operate Portal.\n---\n" },
    { name: "portal-ops/scripts/publish.sh", content: "#!/bin/sh\n" },
    { name: "portal-ops/references/routes.md", content: "# Routes\n" },
  ]);

  const bundle = await extractSkillBundleFromArchive(archive, "portal-ops");
  assert.match(bundle.content, /name: portal-ops/);
  assert.deepEqual(bundle.files.map((file) => file.path), [
    "SKILL.md",
    "scripts/publish.sh",
    "references/routes.md",
  ]);
});

test("hosted skill archives reject path traversal", async () => {
  const archive = await skillArchive([
    { name: "safe/SKILL.md", content: "---\nname: safe\ndescription: Safe.\n---\n" },
    { name: "safe/../secret", content: "nope" },
  ]);

  await assert.rejects(
    extractSkillBundleFromArchive(archive, "safe"),
    /PRISM_SKILL_ARCHIVE_UNSAFE/,
  );
});
