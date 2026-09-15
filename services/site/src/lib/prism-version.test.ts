import assert from "node:assert/strict"
import test from "node:test"

import {
  comparePrismVersions,
  fetchPrismUpdateStatus,
} from "./prism-version"

test("comparePrismVersions compares stable semantic versions", () => {
  assert.equal(comparePrismVersions("0.1.0", "0.2.0"), -1)
  assert.equal(comparePrismVersions("1.0.0", "1.0.0"), 0)
  assert.equal(comparePrismVersions("2.0.0", "1.9.9"), 1)
  assert.equal(comparePrismVersions("invalid", "1.0.0"), null)
})

test("comparePrismVersions follows SemVer prerelease precedence", () => {
  assert.equal(comparePrismVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1)
  assert.equal(comparePrismVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1)
  assert.equal(comparePrismVersions("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1)
  assert.equal(comparePrismVersions("1.0.0-rc.1", "1.0.0"), -1)
  assert.equal(comparePrismVersions("1.0.0+build.1", "1.0.0+build.2"), 0)
  assert.equal(comparePrismVersions("1.0.0-alpha.01", "1.0.0-alpha.1"), null)
})

test("fetchPrismUpdateStatus reports a newer canonical version", async () => {
  const status = await fetchPrismUpdateStatus(async () => new Response(JSON.stringify({
    version: "0.2.0",
    channel: "stable",
    repository: "superprismio/prism-railway-template",
    branch: "main",
  }), { status: 200 }))

  assert.equal(status.state, "update_available")
  assert.equal(status.currentVersion, "0.1.0")
  assert.equal(status.latestVersion, "0.2.0")
  assert.equal(status.updateReason, "version")
  assert.equal(status.error, null)
})

test("fetchPrismUpdateStatus detects changed commits without a version bump", async () => {
  const previousSha = process.env.PRISM_BUILD_SHA
  process.env.PRISM_BUILD_SHA = "1111111111111111111111111111111111111111"
  try {
    const status = await fetchPrismUpdateStatus(async (input) => {
      if (String(input).includes("api.github.com")) {
        return new Response(JSON.stringify({
          status: "behind",
          behind_by: 2,
          files: [{ filename: "services/site/src/app/page.tsx" }],
          head_commit: { sha: "2222222222222222222222222222222222222222" },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        version: "0.1.0",
        channel: "stable",
        repository: "superprismio/prism-railway-template",
        branch: "main",
      }), { status: 200 })
    })

    assert.equal(status.state, "update_available")
    assert.equal(status.updateReason, "commits")
    assert.equal(status.latestVersion, "0.1.0")
    assert.equal(status.latestSha, "2222222222222222222222222222222222222222")
  } finally {
    if (previousSha === undefined) delete process.env.PRISM_BUILD_SHA
    else process.env.PRISM_BUILD_SHA = previousSha
  }
})

test("fetchPrismUpdateStatus ignores merge-only commits with no changed files", async () => {
  const previousSha = process.env.PRISM_BUILD_SHA
  process.env.PRISM_BUILD_SHA = "1111111111111111111111111111111111111111"
  try {
    const status = await fetchPrismUpdateStatus(async (input) => new Response(JSON.stringify(
      String(input).includes("api.github.com")
        ? { status: "behind", behind_by: 1, files: [], head_commit: { sha: "2222222222222222222222222222222222222222" } }
        : {
          version: "0.1.0",
          channel: "stable",
          repository: "superprismio/prism-railway-template",
          branch: "main",
        },
    ), { status: 200 }))

    assert.equal(status.state, "current")
    assert.equal(status.updateReason, null)
  } finally {
    if (previousSha === undefined) delete process.env.PRISM_BUILD_SHA
    else process.env.PRISM_BUILD_SHA = previousSha
  }
})

test("fetchPrismUpdateStatus fails open when the canonical check fails", async () => {
  const status = await fetchPrismUpdateStatus(async () => new Response("unavailable", { status: 503 }))

  assert.equal(status.state, "unknown")
  assert.equal(status.latestVersion, null)
  assert.match(status.error ?? "", /HTTP 503/)
})
