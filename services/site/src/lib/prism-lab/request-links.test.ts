import assert from "node:assert/strict";
import test from "node:test";

import { defaultLabRequestFilters } from "./request-filters";
import {
  labRequestHref,
  selectedRequestWorkspaceId,
} from "./request-links";

test("request links preserve filters and target the selected workspace", () => {
  assert.equal(
    labRequestHref(42, defaultLabRequestFilters),
    `/admin/lab/requests/42#${selectedRequestWorkspaceId}`,
  );
  assert.equal(
    labRequestHref(7, {
      ...defaultLabRequestFilters,
      query: "blocked request",
      lifecycle: "all",
      priority: "urgent",
    }),
    `/admin/lab/requests/7?q=blocked+request&lifecycle=all&priority=urgent#${selectedRequestWorkspaceId}`,
  );
});
