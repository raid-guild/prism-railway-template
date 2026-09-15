export const workflowSelectionHint = "Select an enabled workflow explicitly using GET /agent/workflows. Use change-request-default only for actual repository changes. For CMS records, Action Items, or configuration supported by existing APIs, use the relevant operational workflow or perform the authorized operation directly; do not create code work as a fallback.";

export function requireRequestWorkflowKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("WORKFLOW_KEY_REQUIRED");
  }
  return value.trim();
}
