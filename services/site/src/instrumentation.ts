export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startWorkflowAgentRunDispatcher } = await import("@/lib/workflow-agent-run-queue");
  startWorkflowAgentRunDispatcher();
}
