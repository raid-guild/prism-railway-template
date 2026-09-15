# Custom Skills

Prism skills are file-shaped instructions that Codex can load when a prompt or task requests them.

## Source Layout

- Template built-ins live in `services/site/skills/*`.
- Instance custom skills live in `/data/skills/*/SKILL.md` on the `site` service volume.
- Prism Memory built-ins may still be exposed by `prism-memory` for memory-specific operations.
- Executable helper scripts, checkpoints, and generated outputs should not live inside skill folders. Put those under an instance path such as `/data/custom/<workflow>/...` on the service that runs them.

For example, the RaidGuild DAO proposal experiment uses:

- Skill definition: `/data/skills/dao-proposal-watcher/SKILL.md`
- Runtime script: `/data/custom/dao-proposals/scripts/dao_proposal_watcher.mjs`
- Runtime state/output: `/data/custom/dao-proposals/checkpoint.json` and `/data/custom/dao-proposals/proposals/*.md`

## Ownership

`site` is the custom skill manager. `codex-runtime` is the executor.

Codex should create or update custom skill definitions through the site internal API:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skills" \
  -d @skill-payload.json
```

Payload:

```json
{
  "name": "example-skill",
  "content": "---\nname: example-skill\ndescription: Use this skill when...\n---\n\nSkill instructions go here.\n"
}
```

The skill then appears in the admin Skills tab and is available through the same site-hosted skill download flow used by `codex-runtime`. Interactive full-authority runtime sessions expose these bundles through Codex's native skill discovery, so Codex can match the user's request against skill descriptions and load the full instructions only when needed. Exact deterministic runs remain limited to their configured skill list.

Custom skills can be removed by name through the same internal API:

```bash
curl -fsSL \
  -X DELETE \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skills/example-skill"
```

Only custom skills under `/data/skills` can be deleted this way. Template built-ins return `409`.

## Registry Decision

There is no DB registry yet. For now, the canonical custom skill source is the `SKILL.md` file under `/data/skills`.

A DB registry becomes useful when Prism needs state that does not belong in `SKILL.md`, such as:

- enabled/disabled status
- owner/reviewer
- version/hash history
- review or approval status
- task references
- archive/delete history

Until then, file discovery keeps skills close to Codex's native format and avoids two sources of truth.
