import type { LabRequestFilterState } from "./contracts";
import { labRequestFiltersToSearchParams } from "./request-filters";

export const selectedRequestWorkspaceId = "selected-request-workspace";

export function labRequestHref(
  requestNumber: number,
  filters: LabRequestFilterState,
) {
  const params = labRequestFiltersToSearchParams(filters);
  const query = params.toString();
  return `/admin/lab/requests/${requestNumber}${query ? `?${query}` : ""}#${selectedRequestWorkspaceId}`;
}
