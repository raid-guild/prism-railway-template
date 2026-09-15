# Working Document Upload v2

## Status

Planned first slice.

## Purpose

Let a contributor upload a working Markdown document from Prism Console or the
Memory Explorer, share it with other contributors, and use it as context in a
chat session.

An upload is a Memory event and artifact. It is not an evergreen Knowledge
document. The normal digest and rolling-memory pipeline may retain a short
recap, decision, action, or open thread when the document is important enough,
but the full document remains in the artifact and rolling memory keeps a link
back to it.

```text
Markdown file
    |
    v
Site contributor upload route
    |
    v
Prism Memory POST /memory/inbox
    |
    +--> shareable Memory artifact
    |
    +--> inbox collector -> digest -> rolling memory summary/reference
```

## Product Boundary

Memory is for event-driven, rolling context. Knowledge is for reviewed,
long-lived, evergreen material.

- Upload drafts, working notes, proposals under review, and collaborative
  documents to Memory.
- Keep the complete Markdown body in the Memory artifact.
- Allow the digest pipeline to decide whether the upload contributes a short
  item to rolling memory.
- Do not copy the full document into `memory/rolling/latest.json`.
- Add promotion to Knowledge later as an explicit review action with Knowledge
  metadata and duplicate protection.

## First-Slice Experience

### Prism Console

Add an upload control beside the Console composer. It accepts one UTF-8 `.md`
file, uploads it to Memory, and attaches the resulting artifact to the current
prompt by default.

The attachment shows:

- document title and original filename;
- incoming/processed state;
- `Open artifact`, `Copy link`, and `Remove from chat` actions.

Submitting the prompt includes the artifact id and contributor-facing URL so
the runtime can fetch the artifact with Prism Memory reader access.

### Memory Explorer

Add `Upload document` to the Artifacts tab header. It uses the same Site route
as Console. After upload, refresh the artifact list and open the new artifact.

Do not add a separate Inbox tab. The uploaded object is immediately a Memory
artifact and follows the existing incoming/processed lifecycle.

## Supported Input

The first slice accepts exactly one file per request:

- `.md` filename, case-insensitive;
- valid UTF-8 text;
- non-empty content;
- no NUL bytes;
- 5 MiB maximum by default;
- configurable through `MEMORY_DOCUMENT_UPLOAD_MAX_MB`, clamped to 1-25 MiB.

The browser may provide `.md,text/markdown` as picker hints, but the
server treats the filename extension and decoded bytes as authoritative.

## Site API

Add a contributor-session route:

```http
POST /admin/memory/api/artifacts/upload
content-type: multipart/form-data

file=<markdown file>
```

Site validates the file, derives a title from the first H1 or filename, and
posts this event to Prism Memory with the write key:

```json
{
  "source": "prism-site",
  "type": "working_document",
  "ts": "2026-07-15T18:00:00Z",
  "content": "# Working Draft\n\n...",
  "author": "Contributor",
  "metadata": {
    "title": "Working Draft",
    "original_filename": "working-draft.md",
    "mime_type": "text/markdown",
    "size_bytes": 4812,
    "content_sha256": "...",
    "document_state": "working",
    "uploaded_via": "prism-site"
  }
}
```

Use `PRISM_API_WRITE_KEY`, falling back to `PRISM_API_KEY`. Never expose either
key or `PRISM_MEMORY_BASE_URL` to browser JavaScript.

Return a browser-safe shape:

```json
{
  "ok": true,
  "artifact": {
    "id": "20260715_180000z-prism-site-a1b2c3d4",
    "status": "incoming",
    "title": "Working Draft",
    "filename": "working-draft.md",
    "viewUrl": "/admin/memory/artifacts/20260715_180000z-prism-site-a1b2c3d4"
  }
}
```

## Prism Memory Contract

Extend the `POST /memory/inbox` response with the created artifact id, status,
and relative artifact URL. Keep `path` for compatibility.

When the caller does not provide `url`, Prism Memory adds its stable relative
artifact URL to the stored event before writing it. The collector carries that
URL as `jump_url`; structured digest evidence and rolling-memory entries can
therefore retain it as the source reference.

The full Markdown body can inform digest classification, but rolling memory
stores bounded summaries and evidence excerpts rather than the full artifact.

## Contributor Artifact Link

Expose a Site-hosted artifact view at:

```http
GET /admin/memory/artifacts/:artifactId
```

Require a valid contributor session with workspace-view access. Render the
artifact as escaped text and do not execute Markdown HTML, scripts, remote
images, MDX, or code blocks. This is shareable with authenticated contributors,
not a public anonymous link.

## Security And Observability

- Validate extension, size, UTF-8, NUL bytes, and non-empty content on Site.
- Treat browser MIME type as advisory.
- Do not log document bodies, multipart requests, or Prism credentials.
- Record safe upload outcome, artifact id, filename, byte count, hash prefix,
  upstream status, and duration.
- Preserve contributor identity when the session has a stable user id; otherwise
  use a neutral `prism-contributor` author.
- Keep one backend flow for Console and Memory Explorer uploads.

## First-Slice Tests

- Accept valid UTF-8 `.md` content and derive title from the first H1.
- Fall back to a humanized filename when no H1 exists.
- Reject unsupported extensions, empty files, NUL bytes, invalid UTF-8, and
  oversized files.
- Confirm upload uses the write key rather than read or ops credentials.
- Confirm Prism Memory returns a stable artifact id and stores the artifact URL
  on the event.
- Confirm the contributor artifact view escapes document content.
- Confirm Console attaches the artifact id and URL to the next prompt.
- Confirm Memory Explorer refreshes and opens the uploaded artifact.

## Later Work

- Multiple-file upload and progress queues.
- Explicit `Promote to Knowledge` with metadata review.
- Draft replacement/version history.
- Signed external share links if anonymous collaboration becomes necessary.
- Additional text or document formats after extraction and provenance are
  designed.
