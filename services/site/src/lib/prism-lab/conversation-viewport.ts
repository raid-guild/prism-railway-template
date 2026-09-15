export type ConversationViewportTracker = {
  requestId: string | null
  lastMessageId: string | null
}
export function decideConversationViewportUpdate(
  tracker: ConversationViewportTracker,
  input: {
    requestId: string
    lastMessageId: string | null
    nearBottom: boolean
    revealLatest: boolean
  },
) {
  const requestChanged = tracker.requestId !== input.requestId
  const hasNewMessage = input.lastMessageId !== null && tracker.lastMessageId !== input.lastMessageId
  const scrollToLatest = hasNewMessage && (
    requestChanged
    || tracker.lastMessageId === null
    || input.nearBottom
    || input.revealLatest
  )

  return {
    next: { requestId: input.requestId, lastMessageId: input.lastMessageId },
    scrollToLatest,
    showNewMessages: hasNewMessage && !scrollToLatest,
  }
}
