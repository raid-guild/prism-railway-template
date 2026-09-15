export type ActiveRequestAgentRunSummary = {
  id: string;
  requestId: string;
  status: "queued" | "claimed" | "running";
};

type ActiveRunProjectionInput = {
  id: string;
  requestId: string | null;
  status: string;
};

const activeStatuses = new Set<ActiveRequestAgentRunSummary["status"]>([
  "queued",
  "claimed",
  "running",
]);

/** Reduces privileged agent-run rows to the non-sensitive board occupancy contract. */
export function projectActiveRequestAgentRuns(
  runs: readonly ActiveRunProjectionInput[],
): ActiveRequestAgentRunSummary[] {
  return runs.flatMap((run) => {
    const requestId = run.requestId?.trim() || null;
    const status = run.status.trim().toLocaleLowerCase();
    if (!requestId || !activeStatuses.has(status as ActiveRequestAgentRunSummary["status"])) {
      return [];
    }
    return [{
      id: run.id,
      requestId,
      status: status as ActiveRequestAgentRunSummary["status"],
    }];
  });
}
