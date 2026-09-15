export const defaultDoctorRepairWorkflowKey = 'prism-maintenance';

export function doctorRepairWorkflowKey(value = process.env.PRISM_DOCTOR_REPAIR_WORKFLOW_KEY) {
  return value?.trim() || defaultDoctorRepairWorkflowKey;
}

export function matchingDoctorRepairRequest(
  requests: Record<string, unknown>[], title: string, workflowKey: string,
) {
  return requests.find(request => request.title === title && request.workflowKey === workflowKey) ?? null;
}
