# Prism Gateway Credential Migration

Use this runbook to move organization credentials from Railway variables into
Prism Gateway without changing how trusted agent code uses them.

## Goal

Move secret ownership and entry to Gateway while preserving conventional
environment-variable access inside trusted runtime and task child processes.

## Procedure

1. Inventory the runtime or task service variables.
2. Group each provider's secret and non-secret configuration variables into one
   Gateway credential bundle.
3. Preserve the exact environment-variable names used by existing skills,
   scripts, CLIs, and SDKs.
4. Enter secret values in Admin Settings, never through chat or an agent route.
5. Run the intended Admin Console, full-access source, workflow, or task path.
6. Verify the provider operation and the Gateway lease audit event.
7. Exercise every enabled workflow, task, and hook that uses the credential.
8. Remove the old Railway variable only after those checks pass.

The migration planner reports `credential`, `credentialVariables`,
`configurationVariables`, references, and variables removable after
validation:

```bash
node scripts/railway-prism-gateway-migration-plan.mjs codex-runtime
```

## Runtime Variables

Codex Runtime and Task Runner need:

- `PRISM_GATEWAY_ENABLED=true`
- `PRISM_GATEWAY_BASE_URL`
- their caller-specific `PRISM_GATEWAY_TOKEN`

The caller token remains in the parent service. Provider credentials are leased
only into the child job.

## Assignment

Admin Console, full-access Discord/Telegram, and workflow runs inherit active
credentials from Site trust policy.

Deterministic tasks name required credentials:

```json
{
  "agentConfig": {
    "gatewayCredentials": ["sendgrid"]
  }
}
```

Instance-owned skills may declare a deterministic dependency:

```yaml
metadata:
  gateway-credentials:
    - sendgrid
```

Generic external skills should only document the conventional environment
variables they expect.

## Validation

For each credential verify:

- the bundle has at least one stored secret;
- environment bindings match the consuming SDK or script;
- non-secret base URLs and account identifiers are present;
- the trusted run succeeds;
- the audit event includes caller and run context;
- logs and artifacts contain no secret value;
- rotation changes subsequent leases;
- revocation prevents subsequent leases.

Gateway audits lease issuance, not every provider request made by the trusted
child process.

## Rollback

If a migrated job fails:

1. restore the old Railway variable temporarily;
2. inspect the credential key, environment bindings, and configuration names;
3. repeat the real consuming workflow or task;
4. keep the Railway value until the Gateway lease path passes.

Do not add a second authorization or API-profile layer to repair an environment
binding problem.
