---
name: prism-skill-source-author
description: Use this skill when Codex is asked to create, update, register, sync, or review GitHub-backed Prism skill source repositories.
---

Use this skill to work with GitHub-backed Prism skill source repositories.

GitHub-backed skill sources are read-only from Prism's point of view. The GitHub
repo is the source of truth; Prism registers the repo, syncs a configured path,
validates `SKILL.md` files, and exposes successful skills beside built-in and
custom skills.

## When To Use

Use a GitHub-backed skill source when a community or team wants reusable skills
with normal GitHub review, history, branch protection, and reuse across Prism
instances.

Use an instance custom skill instead when the skill is a one-off local
experiment, contains instance-private instructions, or should be edited directly
from the Prism admin UI/API.

## Repository Shape

Use this layout:

```text
skills/
  example-skill/
    SKILL.md
  another-skill/
    SKILL.md
```

Rules:

1. Use lowercase kebab-case skill names.
2. Each directory name must match the `name` in `SKILL.md` frontmatter.
3. Every skill must include `SKILL.md`.
4. Keep each skill self-contained. Use optional `references/`, `scripts/`, or
   `assets/` folders only when they directly support the skill.
5. Do not add README, changelog, install guide, or other auxiliary docs inside a
   skill folder.
6. Keep generated outputs and runtime state out of the skill repo.
7. Keep generic source skills independent of Prism Gateway. Site policy leases
   credentials to trusted interactive contexts. Use
   `metadata.gateway-credentials` only when a source is intentionally
   instance-specific and has a deterministic dependency. Do not add custom
   top-level frontmatter keys.

Minimal skill:

```markdown
---
name: example-skill
description: Use this skill when Codex is asked to...
---

Instructions go here.
```

Skill that uses an organization integration:

```markdown
---
name: crm-contact-research
description: Use this skill when Codex is asked to research CRM contacts.
metadata:
  gateway-credentials:
    - crm
---

Use the provider's conventional environment variables. Site policy, rather
than generic source-skill metadata, normally leases credentials to trusted
jobs.
```

Descriptions decide when the skill loads, so make them explicit about the user
requests and work types the skill covers.

## Authoring Process

1. Inspect existing built-in, source-backed, and custom skills before adding a
   new one.
2. Decide whether the capability should be a skill, workflow, task, hook, or
   knowledge source.
3. Create or update `skills/<skill-name>/SKILL.md` in the GitHub repo.
4. Keep instructions concise and procedural. Include only context Codex cannot
   reliably infer.
5. If the skill needs detailed domain references, put them under
   `skills/<skill-name>/references/` and tell Codex when to read them.
6. Commit through normal GitHub review.
7. Register or sync the repo in Prism.
8. Verify the skill appears as a source skill and does not silently duplicate a
   better built-in or custom skill.
9. Run Prism Doctor on each target instance before removing a legacy runtime
   secret. A source repository can be shared while credential availability and
   Site/source-policy assignments remain instance-specific.

## Register A Skill Source

Prefer `/agent/*` routes from Codex Runtime. Do not use `/admin/*` with a
service token.

Expected env:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`

Fallback env:

- `APP_API_BASE_URL`
- `APP_API_SERVICE_TOKEN`

Create or update the env aliases if needed:

```bash
export PRISM_AGENT_API_BASE_URL="${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}"
export PRISM_AGENT_SERVICE_TOKEN="${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}"
```

Register a source:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skill-sources" \
  -d '{
    "key": "raid-guild-agent-skills",
    "name": "Raid Guild Agent Skills",
    "repoUrl": "https://github.com/raid-guild/agent-skills.git",
    "branch": "main",
    "sourcePath": "skills",
    "enabled": true
  }'
```

Then sync with the dedicated sync endpoint:

```bash
curl -fsSL \
  -X POST \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skill-sources/raid-guild-agent-skills/sync"
```

Do not use `PATCH /agent/skill-sources/:key` to sync.

## Verify

List skill sources:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skill-sources"
```

List available skills:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skills"
```

Check:

- the source has `lastSyncedAt`,
- the source has the expected skill count,
- `lastError` is empty,
- expected skills appear with source kind/metadata,
- duplicate or overlapping custom skills are reported but not deleted without
  explicit operator approval.

## Conflict Guidance

Built-in skills should remain the default for Prism platform operations. A
source-backed skill should add community-specific domain knowledge, operating
style, or external tool procedures.

If a source-backed skill overlaps with an existing custom skill, report the
overlap and recommend a cleanup path. Do not delete custom skills unless the
operator explicitly approves that deletion.

If a source-backed skill overlaps with a built-in skill, prefer updating the
built-in only when the behavior is generally useful to all Prism instances.
Otherwise rename or narrow the source-backed skill so it is clearly
community-specific.
