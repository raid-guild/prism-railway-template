---
name: target-deploy-ops
description: Use this skill when Codex needs to inspect target app metadata, work in the target repo, run build or test commands, and trigger or verify staging deploys for a Prism change request.
---

Use this skill after `change-request-ops` has identified the active request and target.

Inputs come from the Prism Agent API response:

- `targetApp`
- `targetEnvironment`
- `deployPlan`
- latest agent run state

Expected work:

1. Read `targetApp.repoUrl`, `targetApp.defaultBranch`, `targetEnvironment`, and `deployPlan`.
2. Determine the local repo path or clone target if the repo is not present.
3. Create or reuse a working branch for the request.
4. Make the requested code changes.
5. Run the target repo's install, build, lint, and test commands when they exist.
6. Trigger or verify the staging deploy and capture the resulting URL.
7. Return branch, commit SHA, deploy URL, and a concise summary back through `change-request-ops`.

Current repo conventions:

- `daohaus-admin` local dev is a standalone Vite app.
- Local dev command is currently `npm run dev`.
- Local manual URL is currently `http://localhost:5173/`.
- Shared staging redeploy still depends on target-specific scripts or Railway ops, not the Prism API itself.

Current deploy-plan interpretation:

- `deployPlan.targetApp` describes the app identity and repo source.
- `deployPlan.targetEnvironment` describes the selected environment.
- `deployPlan.targetEnvironment.deployBackend` tells you whether the current plan is `railway`, `local`, or another backend.
- `deployPlan.targetEnvironment.deployConfig` is the canonical config payload for backend-specific operations.

For Railway targets:

1. Confirm the target service name, project id, service id, environment name, and environment id from `deployConfig`.
2. For this stack, prefer Railway CLI deploy commands with the project token in `RAILWAY_TOKEN`. This is the path that can upload the current hydrated workspace.
3. Do not use `railway login`, `railway whoami`, or `railway link` inside the runtime for deploy automation.
4. When invoking Railway CLI, unset `RAILWAY_API_TOKEN` so the CLI uses the project token path:
   `env -u RAILWAY_API_TOKEN railway ...`
5. Ensure `RAILWAY_PROJECT_ID` is set to `deployConfig.projectId` if the shell does not already have it.
6. Run deploy actions from the hydrated target workspace, not from the runtime service source tree.
7. After deploy, use Railway logs or GraphQL lookups to capture status and the resulting URL.
8. Return deploy status, final URL, and any failure details so the current agent run and request artifacts/external refs capture them.

Recommended environment:

- `RAILWAY_TOKEN`
- `PROJECT_ID` from `deployConfig.projectId`
- `ENVIRONMENT_ID` from `deployConfig.environmentId`
- `ENVIRONMENT_NAME` from `deployConfig.environment`
- `SERVICE_ID` from `deployConfig.serviceId`
- `SERVICE_NAME` from `deployConfig.serviceName`

Preferred deploy command from the hydrated target workspace:

```bash
export RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-$PROJECT_ID}"
env -u RAILWAY_API_TOKEN railway up . \
  --path-as-root \
  --service "$SERVICE_NAME" \
  --environment "$ENVIRONMENT_NAME" \
  --ci
```

Fetch recent logs for the target service without requiring user login:

```bash
export RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-$PROJECT_ID}"
env -u RAILWAY_API_TOKEN railway logs \
  --service "$SERVICE_NAME" \
  --environment "$ENVIRONMENT_NAME" \
  --lines 200
```

Use Railway GraphQL as an optional metadata/status fallback. Project tokens must be sent as `Project-Access-Token`, not `Authorization: Bearer`.

Useful read query when ids are missing:

```bash
curl -fsSL https://backboard.railway.com/graphql/v2 \
  -H "Project-Access-Token: $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "query":"query($projectId:String!){ project(id:$projectId){ id environments{ edges{ node{ id name } } } services{ edges{ node{ id name serviceInstances{ edges{ node{ id environmentId domains{ serviceDomains{ domain } customDomains{ domain } } } } } } } } } }",
    "variables":{"projectId":"'"$PROJECT_ID"'"}
  }'
```

Poll the latest deployment for the service:

```bash
curl -fsSL https://backboard.railway.com/graphql/v2 \
  -H "Project-Access-Token: $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "query":"query($projectId:String!,$environmentId:String!,$serviceId:String!){ deployments(first:1,input:{projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId}){ edges{ node{ id status url staticUrl createdAt updatedAt } } } }",
    "variables":{
      "projectId":"'"$PROJECT_ID"'",
      "environmentId":"'"$ENVIRONMENT_ID"'",
      "serviceId":"'"$SERVICE_ID"'"
    }
  }'
```

For local targets:

1. Use the local repo checkout already on disk.
2. Run the repo's documented local commands.
3. Record the local URL actually used.

Rules:

- Keep branch naming deterministic per request when possible.
- Do not guess deploy details when the target metadata is missing; surface the gap.
- Prefer repo-native scripts over ad hoc shell pipelines.
- Treat build failures, test failures, and deploy failures as agent-run outcomes that must be captured in the run summary, request artifacts, or external refs.
- For this stack, prefer `env -u RAILWAY_API_TOKEN railway ...` with the project token for actual code uploads and use GraphQL only when CLI metadata is insufficient.
