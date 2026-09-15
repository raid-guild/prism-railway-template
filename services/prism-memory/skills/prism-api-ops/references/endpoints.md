# Ops Endpoint Patterns

Base URL:

```text
https://<prism-memory-domain>
```

Auth header:

```text
X-Prism-Api-Key: <ops-key>
```

Examples:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/memory/run?force=true"
```

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/memory/backfill?days=30&force=true"
```

Rebuild generated state for one day:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/state/run?date=YYYY-MM-DD&force=true"
```

Backfill generated state for recent history:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/state/backfill?days=60&force=true"
```

Edit a throughline title, status, kind, ownership, aliases, or pinned/archive
metadata. These curation changes survive later state rebuilds:

```bash
curl -X PATCH \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/state/throughlines/<throughline-key>" \
  -d '{"title":"Human readable work name","kind":"project","pinned":true}'
```

Merge a noisy or duplicate throughline into a target throughline:

```bash
curl -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/state/throughlines/<source-key>/merge" \
  -d '{"target_key":"<target-key>","reason":"Duplicate throughline"}'
```

Hide/delete a generated throughline from operator views:

```bash
curl -X DELETE \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/state/throughlines/<throughline-key>"
```

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/knowledge/run"
```
