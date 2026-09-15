import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeGitHubRepoUrl,
  parseAgentTargetAppInput,
  parseAgentTargetAppPatchInput,
  shouldSyncDefaultEnvironmentBranch,
} from "./target-app-input"

test("target app input derives safe defaults from a GitHub repository URL", () => {
  const result = parseAgentTargetAppInput({
    repoUrl: "https://github.com/raid-guild/bard-calendar.git/",
  })

  assert.deepEqual(result, {
    ok: true,
    input: {
      slug: "bard-calendar",
      name: "bard-calendar",
      description: null,
      repoUrl: "https://github.com/raid-guild/bard-calendar",
      defaultBranch: "main",
    },
  })
})

test("target app input accepts explicit metadata and snake-case aliases", () => {
  const result = parseAgentTargetAppInput({
    repo_url: "https://github.com/raid-guild/bard-calendar",
    name: "Bard Calendar",
    slug: "raidguild-calendar",
    description: "Community calendar",
    default_branch: "develop",
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.input.slug, "raidguild-calendar")
    assert.equal(result.input.defaultBranch, "develop")
  }
})

test("target app input rejects non-GitHub URLs and invalid slugs", () => {
  assert.equal(parseAgentTargetAppInput({ repoUrl: "https://example.com/repo" }).ok, false)
  assert.equal(parseAgentTargetAppInput({
    repoUrl: "https://github.com/raid-guild/bard-calendar",
    slug: "Bard Calendar",
  }).ok, false)
  assert.equal(normalizeGitHubRepoUrl("https://github.com/raid-guild/bard-calendar/issues"), null)
})

test("GitHub repository normalization removes only transport noise", () => {
  assert.equal(
    normalizeGitHubRepoUrl("https://github.com/Raid-Guild/Bard-Calendar.git/"),
    "https://github.com/Raid-Guild/Bard-Calendar",
  )
})

test("target app patch accepts agent-safe partial updates", () => {
  assert.deepEqual(parseAgentTargetAppPatchInput({
    default_branch: "master",
    agent_enabled: true,
  }), {
    ok: true,
    input: { defaultBranch: "master", agentEnabled: true },
  })
})

test("target app patch rejects unsupported and malformed updates", () => {
  assert.equal(parseAgentTargetAppPatchInput({ slug: "renamed" }).ok, false)
  assert.equal(parseAgentTargetAppPatchInput({ defaultBranch: "bad branch" }).ok, false)
  assert.equal(parseAgentTargetAppPatchInput({ agentEnabled: "yes" }).ok, false)
})

test("default environment branch sync preserves explicitly divergent environments", () => {
  assert.equal(shouldSyncDefaultEnvironmentBranch({
    environmentSlug: "rips-default",
    environmentBranch: "feature/review",
    targetSlug: "rips",
    previousDefaultBranch: "main",
  }), true)
  assert.equal(shouldSyncDefaultEnvironmentBranch({
    environmentSlug: "production",
    environmentBranch: "main",
    targetSlug: "rips",
    previousDefaultBranch: "main",
  }), true)
  assert.equal(shouldSyncDefaultEnvironmentBranch({
    environmentSlug: "production",
    environmentBranch: "release",
    targetSlug: "rips",
    previousDefaultBranch: "main",
  }), false)
})
