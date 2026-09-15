# Dreamer maintenance consolidation

Doctor remains an independent deterministic checker. Both Doctor finding tickets
and scheduled request-recovery sweeps use `prism-maintenance`, explicitly owned
by Dreamer (`dreamer-agent`). The protected built-in is seeded by migration 052;
an instance may assign its accountability to Platform Operations. No provider
runtime is pinned; the default model tier is standard with step-local skills.

The shared flow is Assess → Repair → Verify → Closed. Assessment inventories
configuration drift and stuck/failed requests, chooses at most ten safe targets,
and keeps blocked findings separate. Repair requires intended state, observed
failure, exact authorized mutation, verification, and durable receipts.
Verification records actual partial results and does not close unresolved work
without an explicit scoped deferment.

Memory is read-only diagnosis and proposals. Broad redesign, model downgrades
without quality evidence, new workflows, source publishing, destructive changes,
credential/access changes and self-modification require separate authorization.
The persona and mutation lists are guidance, not new per-route RBAC. Dreamer
receives no provider credential bundle by default, but internal service-token
access is still broad. Do not describe this as hard sandbox isolation.

## Live migration

- Preserve #2327 and all earlier requests/artifacts.
- Apply the idempotent protected-profile migration and assign the live profile
  to Platform Operations through the audited domain API.
- Update only the current maintenance definition's executor/instructions.
- Convert the two enabled legacy launchers to deterministic `workflow-runner`
  tasks, preserving their cron/timezone/enabled state and stable task keys.
- Set `singleFlight: true` and `singleFlightWorkflowKeys` to
  `['prism-maintenance','workflow-repair-loop']`.
- Keep the deprecated 30-minute schedule disabled.
- Retire the old workflow definition only when no legacy request is open;
  preserve its files and history, do not delete it.

Single-flight checks all open requests (maximum 500, fail closed if saturated),
and holds an in-process launch lock for the workflow group. This protects the
current single task-runner replica, not a distributed multi-replica deployment.
Any open maintenance request, including one needing attention, prevents a new
sweep. Operators resolve/retry the existing ticket; the scheduler does not
override decisions. Doctor reports do not auto-authorize new repairs.

Preserved schedule: weekdays `0 14-23/2 * * 1-5` UTC, weekends `0 18 * * 6,0`
UTC. These are daytime in Denver, not overnight; an off-hours schedule is a
separate instance decision.
