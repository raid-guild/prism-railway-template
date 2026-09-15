type MessageLike = {
  role?: unknown
  source?: unknown
  meta?: unknown
}

type SessionLike = {
  createdByUserId?: unknown
}

type UserSummary = {
  id: string
  displayName: string | null
  handle: string | null
  email?: string | null
}

export type RequestMessageActor = {
  id: string | null
  displayName: string | null
  handle: string | null
  kind: "site-user" | "external" | "unknown"
  basis: "message-snapshot" | "session-owner" | "external-message" | "unknown"
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isSiteUserSource(source: string | null) {
  return Boolean(source && (source.startsWith("site-") || source === "site" || source === "admin-console"))
}

export function resolveRequestMessageActor(
  message: MessageLike,
  session: SessionLike | null,
  resolveUser?: (userId: string) => UserSummary | null,
): RequestMessageActor | null {
  if (message.role !== "user") return null
  const meta = record(message.meta)
  const source = text(message.source)
  const snapshotUserId = text(meta.actorUserId)
  const externalId = text(meta.authorId ?? meta.authorPubkey ?? meta.telegramAuthorId ?? meta.discordAuthorId)
  const fallbackUserId = isSiteUserSource(source) ? text(session?.createdByUserId) : null
  const actorId = snapshotUserId ?? externalId ?? fallbackUserId
  const resolved = actorId && (snapshotUserId || fallbackUserId) ? resolveUser?.(actorId) ?? null : null
  const displayName = text(meta.actorDisplayName ?? meta.authorName)
    ?? resolved?.displayName
    ?? resolved?.handle
    ?? resolved?.email
    ?? null
  const handle = text(meta.actorHandle) ?? resolved?.handle ?? null
  const kind = snapshotUserId || fallbackUserId
    ? "site-user"
    : externalId || displayName
      ? "external"
      : "unknown"
  const basis = snapshotUserId
    ? "message-snapshot"
    : fallbackUserId
      ? "session-owner"
      : externalId || displayName
        ? "external-message"
        : "unknown"

  return { id: actorId, displayName, handle, kind, basis }
}

export function requestActorMessageMeta(user: UserSummary | null, userId: string | null) {
  return {
    actorUserId: userId,
    actorDisplayName: user?.displayName ?? user?.handle ?? user?.email ?? null,
    actorHandle: user?.handle ?? null,
  }
}
