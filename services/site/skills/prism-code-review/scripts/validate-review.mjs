#!/usr/bin/env node

import fs from "node:fs"

const filePath = process.argv[2]
if (!filePath) {
  console.error("usage: validate-review.mjs <code-review.json>")
  process.exit(2)
}

let review
try {
  review = JSON.parse(fs.readFileSync(filePath, "utf8"))
} catch (error) {
  console.error(`invalid review JSON: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const errors = []
const oneOf = (value, allowed, path) => {
  if (!allowed.includes(value)) errors.push(`${path} must be one of ${allowed.join(", ")}`)
}
const requiredString = (value, path) => {
  if (typeof value !== "string" || !value.trim()) errors.push(`${path} must be a non-empty string`)
}
const stringArray = (value, path) => {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  value.forEach((entry, index) => requiredString(entry, `${path}[${index}]`))
}

if (!review || typeof review !== "object" || Array.isArray(review)) {
  errors.push("review must be an object")
} else {
  if (review.version !== 2) errors.push("version must be 2")
  oneOf(review.status, ["approved", "changes_requested", "inconclusive"], "status")
  oneOf(review.reviewMode, ["initial", "incremental"], "reviewMode")
  requiredString(review.baseSha, "baseSha")
  requiredString(review.headSha, "headSha")
  if (review.previousHeadSha !== null && review.previousHeadSha !== undefined) requiredString(review.previousHeadSha, "previousHeadSha")
  if (review.reviewMode === "initial" && review.previousHeadSha !== null) {
    errors.push("previousHeadSha must be null for an initial review")
  }
  if (review.reviewMode === "incremental") requiredString(review.previousHeadSha, "previousHeadSha")
  stringArray(review.repositoryPolicy, "repositoryPolicy")
  if (!Array.isArray(review.checks)) {
    errors.push("checks must be an array")
  } else {
    review.checks.forEach((check, index) => {
      const path = `checks[${index}]`
      if (!check || typeof check !== "object" || Array.isArray(check)) {
        errors.push(`${path} must be an object`)
        return
      }
      requiredString(check.name, `${path}.name`)
      oneOf(check.status, ["passed", "failed", "skipped", "unavailable"], `${path}.status`)
      requiredString(check.evidence, `${path}.evidence`)
    })
  }
  if (!Array.isArray(review.findings)) {
    errors.push("findings must be an array")
  } else {
    const ids = new Set()
    review.findings.forEach((finding, index) => {
      const path = `findings[${index}]`
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
        errors.push(`${path} must be an object`)
        return
      }
      requiredString(finding.id, `${path}.id`)
      if (typeof finding.id === "string" && ids.has(finding.id)) errors.push(`${path}.id must be unique`)
      ids.add(finding.id)
      oneOf(finding.severity, ["blocking", "high", "medium", "low"], `${path}.severity`)
      oneOf(finding.confidence, ["high", "medium", "low"], `${path}.confidence`)
      oneOf(finding.status, ["open", "resolved"], `${path}.status`)
      for (const field of ["title", "failureScenario", "evidence", "recommendation", "firstSeenHead", "lastSeenHead"]) {
        requiredString(finding[field], `${path}.${field}`)
      }
      if (finding.path !== null && finding.path !== undefined) requiredString(finding.path, `${path}.path`)
      if (finding.line !== null && finding.line !== undefined && (!Number.isSafeInteger(finding.line) || finding.line < 1)) {
        errors.push(`${path}.line must be null or a positive integer`)
      }
      if (finding.side !== null && finding.side !== undefined) oneOf(finding.side, ["LEFT", "RIGHT"], `${path}.side`)
      if (finding.line != null && (typeof finding.path !== "string" || !finding.path.trim())) {
        errors.push(`${path}.path is required when line is set`)
      }
      if (finding.line != null && finding.side == null) errors.push(`${path}.side is required when line is set`)
      if (finding.line == null && finding.side != null) errors.push(`${path}.side must be null when line is null`)
      if (typeof finding.lastSeenHead === "string" && typeof review.headSha === "string" && finding.lastSeenHead !== review.headSha) {
        errors.push(`${path}.lastSeenHead must equal headSha`)
      }
    })
    const openDecisionFindings = review.findings.filter((finding) => (
      finding
      && finding.status === "open"
      && ["blocking", "high"].includes(finding.severity)
    ))
    if (review.status === "approved" && openDecisionFindings.length) {
      errors.push("approved reviews cannot contain open blocking or high findings")
    }
    if (review.status === "changes_requested" && !openDecisionFindings.length) {
      errors.push("changes_requested reviews require an open blocking or high finding")
    }
  }
  requiredString(review.summary, "summary")
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`valid Prism code review: ${review.findings.length} finding(s), ${review.status}`)
