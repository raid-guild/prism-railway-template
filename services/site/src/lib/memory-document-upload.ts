import { basename, extname } from "node:path"

export type ValidatedMemoryDocument = {
  content: string
  filename: string
  sizeBytes: number
  title: string
}

export function memoryDocumentMaxBytes(rawValue = process.env.MEMORY_DOCUMENT_UPLOAD_MAX_MB) {
  const parsed = Number.parseInt(rawValue ?? "5", 10)
  const megabytes = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 25)) : 5
  return megabytes * 1024 * 1024
}

export function artifactIdFromMemoryInboxPath(path: string) {
  const filename = path.split("/").pop() ?? ""
  return filename.endsWith(".json") ? filename.slice(0, -5) : filename
}

export function titleFromMarkdown(content: string, filename: string) {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim()
  if (heading) return heading

  const stem = basename(filename, extname(filename))
  const words = stem
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!words) return "Working document"
  return words.replace(/\b\w/g, (character) => character.toUpperCase())
}

export function validateMemoryDocumentUpload(input: {
  bytes: Uint8Array
  filename: string
  maxBytes?: number
}): ValidatedMemoryDocument {
  const filename = basename(input.filename.trim())
  if (!filename || filename !== input.filename.trim() || extname(filename).toLowerCase() !== ".md") {
    throw new Error("Only Markdown (.md) files are supported")
  }

  const maxBytes = input.maxBytes ?? memoryDocumentMaxBytes()
  if (input.bytes.byteLength <= 0) {
    throw new Error("This Markdown file is empty")
  }
  if (input.bytes.byteLength > maxBytes) {
    throw new Error(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`)
  }

  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)
  } catch {
    throw new Error("This file is not valid UTF-8 Markdown")
  }
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  if (content.includes("\0")) {
    throw new Error("This file is not valid UTF-8 Markdown")
  }
  if (!content.trim()) {
    throw new Error("This Markdown file is empty")
  }

  return {
    content,
    filename,
    sizeBytes: input.bytes.byteLength,
    title: titleFromMarkdown(content, filename),
  }
}
