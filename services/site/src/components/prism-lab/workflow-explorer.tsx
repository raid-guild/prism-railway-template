import { ArrowDown, CheckCircle2, Flag, GitBranch, History, Map, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { WorkflowExplorerStep } from "@/lib/prism-lab/workflow-explorer"
import { cn } from "@/lib/utils"

export function WorkflowExplorer({
  workflowName,
  workflowStatus,
  steps,
}: {
  workflowName: string
  workflowStatus: string | null
  steps: WorkflowExplorerStep[]
}) {
  return (
    <section aria-labelledby="workflow-map-heading" className="mt-5 border border-border/60 bg-card/30">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-4 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 id="workflow-map-heading" className="text-lg font-semibold">Workflow explorer</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{workflowName} · observed execution and configured routes</p>
        </div>
        <Badge variant="outline">{workflowStatus || "No run"}</Badge>
      </div>

      {steps.length ? (
        <ol className="p-4">
          {steps.map((step, index) => (
            <li key={step.key} className="relative pb-4 last:pb-0">
              {index < steps.length - 1 ? <div className="absolute bottom-0 left-4 top-9 w-px bg-border" aria-hidden="true" /> : null}
              <article className={cn(
                "relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border p-3",
                step.current ? "border-primary bg-primary/8" : "border-border/60 bg-background/35",
              )}>
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border bg-background",
                  step.current ? "border-primary text-primary" : step.completed ? "border-primary/40 text-primary" : "text-muted-foreground",
                )}>
                  {step.terminal ? <Flag aria-hidden="true" /> : step.completed ? <CheckCircle2 aria-hidden="true" /> : step.observed ? <History aria-hidden="true" /> : <GitBranch aria-hidden="true" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{step.label}</p>
                    <Badge variant={step.current ? "default" : "outline"}>{step.type}</Badge>
                    {step.current ? <Badge variant="secondary">Current</Badge> : null}
                    {!step.current && step.completed ? <Badge variant="muted">Completed</Badge> : null}
                    {!step.current && !step.completed && step.observed ? <Badge variant="muted">Observed</Badge> : null}
                  </div>
                  <p className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">{step.key}</p>
                  {step.routes.length ? (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Routes from ${step.label}`}>
                      {step.routes.map((route) => (
                        <li key={`${route.action}:${route.target}`} className="flex items-center gap-1 text-xs text-muted-foreground">
                          {route.loop ? <RotateCcw aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                          <span>{route.action} → {route.target}{route.loop ? " · loop" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-xs text-muted-foreground">Terminal state · no configured outgoing route</p>}
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : <div className="px-5 py-10 text-center text-sm text-muted-foreground">No workflow definition is available for this request.</div>}
    </section>
  )
}
