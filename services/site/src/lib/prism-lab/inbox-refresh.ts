export function shouldRefreshInbox(input: { visible: boolean; refreshPending: boolean }) {
  return input.visible && !input.refreshPending
}
