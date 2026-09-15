import assert from "node:assert/strict"
import test from "node:test"

import {
  artifactIdFromMemoryInboxPath,
  memoryDocumentMaxBytes,
  titleFromMarkdown,
  validateMemoryDocumentUpload,
} from "./memory-document-upload"

test("validates UTF-8 Markdown and derives the first H1", () => {
  const result = validateMemoryDocumentUpload({
    bytes: new TextEncoder().encode("# Review Draft\n\nWorking copy."),
    filename: "review-draft.md",
  })
  assert.equal(result.title, "Review Draft")
  assert.equal(result.content, "# Review Draft\n\nWorking copy.")
})

test("uses a humanized filename when the document has no H1", () => {
  assert.equal(titleFromMarkdown("Working copy.", "project_status-draft.md"), "Project Status Draft")
})

test("rejects unsupported, empty, binary, and oversized input", () => {
  assert.throws(
    () => validateMemoryDocumentUpload({ bytes: new TextEncoder().encode("text"), filename: "draft.txt" }),
    /Only Markdown/,
  )
  assert.throws(
    () => validateMemoryDocumentUpload({ bytes: new Uint8Array(), filename: "draft.md" }),
    /empty/,
  )
  assert.throws(
    () => validateMemoryDocumentUpload({ bytes: new Uint8Array([0xff]), filename: "draft.md" }),
    /UTF-8/,
  )
  assert.throws(
    () => validateMemoryDocumentUpload({ bytes: new Uint8Array(5), filename: "draft.md", maxBytes: 4 }),
    /upload limit/,
  )
})

test("derives artifact ids and clamps configured limits", () => {
  assert.equal(
    artifactIdFromMemoryInboxPath("inbox/memory/incoming/20260715_prism-site-abcd.json"),
    "20260715_prism-site-abcd",
  )
  assert.equal(memoryDocumentMaxBytes("0"), 1024 * 1024)
  assert.equal(memoryDocumentMaxBytes("100"), 25 * 1024 * 1024)
  assert.equal(memoryDocumentMaxBytes("invalid"), 5 * 1024 * 1024)
})
