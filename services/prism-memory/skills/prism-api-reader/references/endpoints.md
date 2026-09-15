# Prism Reader Endpoints

Base URL:

```text
https://<prism-memory-domain>
```

Auth header:

```text
X-Prism-Api-Key: <read-key>
```

Examples:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/memory/latest"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/memory/dates?limit=180"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/latest"
```

Generated objective state:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/objectives?status=active&limit=25"
```

Filter objectives by Portal/external refs:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/objectives?externalSystem=portal&limit=25"
```

Find signals for a request anchor:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/signals?anchor=request:26&limit=50"
```

Read active throughlines:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/throughlines?status=active&limit=25"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/search?q=discord&limit=10"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/docs/raidguild-handbook-home"
```

Human-readable Prism knowledge doc page:

```text
$PRISM_API_BASE/knowledge/view/<slug>
```

List recent memory inbox artifacts:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/api/artifacts?source=discord-voice&limit=10"
```

List processed knowledge artifacts:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/api/artifacts?category=knowledge&status=processed&limit=10"
```

Fetch one artifact as JSON:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/api/artifacts/<artifact-id>"
```

Human-readable artifact pages are available at:

```text
$PRISM_API_BASE/artifacts/<artifact-id>
```

Raw artifact payloads are only available at:

```text
$PRISM_API_BASE/api/artifacts/<artifact-id>/raw
```

Use the `/artifacts/<artifact-id>` page for links shared with humans in Discord or chat. Do not use `/api/artifacts/<artifact-id>` as the default user-facing link.

Knowledge source inventory:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/sources"
```

Fetch one knowledge source:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/sources/<source-id>"
```
