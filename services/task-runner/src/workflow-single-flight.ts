export function findOpenWorkflowRequests(payload: unknown, keys: string[]) {
  const records = (payload as { changeRequests?: unknown })?.changeRequests;
  if (!Array.isArray(records) || records.length >= 500) throw new Error('WORKFLOW_SINGLE_FLIGHT_INVENTORY_INCOMPLETE');
  return records.filter(row => row && typeof row === 'object' && keys.includes(row.workflowKey));
}
