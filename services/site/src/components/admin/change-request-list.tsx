import { useMemo } from "react";
import { Filter, Search } from "lucide-react";

import { ChangeRequestRow } from "@/components/admin/change-request-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ChangeRequestRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
  WorkflowRecord,
} from "@/lib/admin";

import {
  requestTypeLabel,
  type RequestSortValue,
} from "./change-request-utils";

export function ChangeRequestList({
  requests,
  targetApps,
  targetEnvironments,
  workflows,
  requestTypeOptions,
  lifecycleFilter,
  typeFilter,
  repositoryFilter,
  stepFilters,
  workflowStepOptions,
  searchQuery,
  sortValue,
  onLifecycleFilterChange,
  onTypeFilterChange,
  onRepositoryFilterChange,
  onStepFiltersChange,
  onSearchQueryChange,
  onSortValueChange,
  onOpenRequest,
}: {
  requests: ChangeRequestRecord[];
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
  workflows: WorkflowRecord[];
  requestTypeOptions: string[];
  lifecycleFilter: string;
  typeFilter: string;
  repositoryFilter: string;
  stepFilters: string[];
  workflowStepOptions: { key: string; label: string }[];
  searchQuery: string;
  sortValue: RequestSortValue;
  onLifecycleFilterChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  onRepositoryFilterChange: (value: string) => void;
  onStepFiltersChange: (value: string[]) => void;
  onSearchQueryChange: (value: string) => void;
  onSortValueChange: (value: RequestSortValue) => void;
  onOpenRequest: (request: ChangeRequestRecord) => void;
}) {
  const workflowByKey = useMemo(
    () => new Map(workflows.map((workflow) => [workflow.key, workflow])),
    [workflows],
  );
  const selectedStepLabel =
    stepFilters.length === 0
      ? "All steps"
      : stepFilters.length === 1
        ? (workflowStepOptions.find((step) => step.key === stepFilters[0])
            ?.label ?? "1 step")
        : `${stepFilters.length} steps`;

  function toggleStepFilter(stepKey: string) {
    onStepFiltersChange(
      stepFilters.includes(stepKey)
        ? stepFilters.filter((current) => current !== stepKey)
        : [...stepFilters, stepKey],
    );
  }

  return (
    <>
      <div className="border-b border-border/60 bg-background px-5 py-4 md:px-6">
        <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_150px_150px_180px_180px_170px]">
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="request-search"
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="Search titles"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Select value={lifecycleFilter} onValueChange={onLifecycleFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="All requests" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All requests</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="needs-review">Needs review</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Select value={typeFilter} onValueChange={onTypeFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {requestTypeOptions.map((requestType) => (
                  <SelectItem key={requestType} value={requestType}>
                    {requestTypeLabel(requestType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Select
              value={repositoryFilter}
              onValueChange={onRepositoryFilterChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="All targets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All targets</SelectItem>
                {targetApps.map((targetApp) => (
                  <SelectItem key={targetApp.id} value={targetApp.id}>
                    {targetApp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <Filter className="h-4 w-4 shrink-0" />
                    <span className="truncate">{selectedStepLabel}</span>
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Workflow steps</p>
                    {stepFilters.length ? (
                      <button
                        type="button"
                        onClick={() => onStepFiltersChange([])}
                        className="text-xs text-muted-foreground underline underline-offset-2"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {workflowStepOptions.map((step) => (
                      <label
                        key={step.key}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={stepFilters.includes(step.key)}
                          onCheckedChange={() => toggleStepFilter(step.key)}
                        />
                        <span className="min-w-0 truncate">{step.label}</span>
                      </label>
                    ))}
                    {!workflowStepOptions.length ? (
                      <p className="text-sm text-muted-foreground">No workflow steps found.</p>
                    ) : null}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Select
              value={sortValue}
              onValueChange={(value) =>
                onSortValueChange(value as RequestSortValue)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated-desc">
                  Sort by Date (Newest)
                </SelectItem>
                <SelectItem value="updated-asc">
                  Sort by Date (Oldest)
                </SelectItem>
                <SelectItem value="number-desc">
                  Sort by Number (Highest)
                </SelectItem>
                <SelectItem value="number-asc">
                  Sort by Number (Lowest)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="hidden border-b border-border/60 bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground md:grid md:grid-cols-[84px_minmax(0,1fr)_180px_150px_140px] md:gap-4 md:px-6">
        <span>Number</span>
        <span>Request</span>
        <span>Target</span>
        <span>Agent</span>
        <span>Updated</span>
      </div>

      <ScrollArea className="h-[calc(100vh-290px)]">
        <div className="space-y-3 px-5 py-4 md:px-6">
          {requests.length ? (
            requests.map((request) => (
              <ChangeRequestRow
                key={request.id}
                request={request}
                targetApps={targetApps}
                targetEnvironments={targetEnvironments}
                workflow={workflowByKey.get(request.workflowKey) ?? null}
                onOpen={onOpenRequest}
              />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No change requests match the current filters.
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  );
}
