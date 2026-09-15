---
name: prism-buzz-channel-admin
description: Create and manage Buzz channels through Prism's protected communication adapter. Use for requests to create, rename, describe, archive, unarchive, configure access for, or manage membership of Buzz channels.
metadata:
  gateway-credentials:
    - buzz-channel-admin
---

# Prism Buzz Channel Admin

Use the protected adapter API. The `buzz-channel-admin` Gateway lease supplies
`BUZZ_CHANNEL_ADMIN_TOKEN` only in a full-access source context.

Required environment:

- `COMMUNICATION_ADAPTER_BASE_URL`
- `BUZZ_CHANNEL_ADMIN_TOKEN`

If either value is missing, stop and explain that Buzz channel administration
must run from a full-access context such as `#prism-ops`. Do not request, print,
or attempt to recover the token.

Set the common header on every request:

```bash
-H "X-Buzz-Admin-Token: $BUZZ_CHANNEL_ADMIN_TOKEN"
```

## Inspect

List every channel visible to the dedicated Prism Buzz identity before changing
anything:

```bash
curl -fsSL \
  -H "X-Buzz-Admin-Token: $BUZZ_CHANNEL_ADMIN_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/buzz/channels"
```

## Create

Default to `private` when visibility is not specified. Confirm the requested
name, type (`stream` or `forum`), visibility, and initial members. Creation
registers the returned channel in Prism's Buzz source policy using the deployed
full interaction profile unless `registerPrism:false` is explicitly supplied.

```bash
curl -fsSL -X POST \
  -H "content-type: application/json" \
  -H "X-Buzz-Admin-Token: $BUZZ_CHANNEL_ADMIN_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/buzz/channels" \
  -d '{"name":"delivery","channelType":"stream","visibility":"private","description":"Delivery coordination"}'
```

Record the returned `channelId`. Add requested members only after creation
succeeds. A partially failed policy registration can leave a real Buzz channel;
inspect the response and existing channels before retrying creation.

## Update and access

Update any combination of `name`, `description`, `ttlSeconds`, `clearTtl`,
`topic`, and `purpose`:

```bash
curl -fsSL -X PATCH \
  -H "content-type: application/json" \
  -H "X-Buzz-Admin-Token: $BUZZ_CHANNEL_ADMIN_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/buzz/channels/$CHANNEL_ID" \
  -d '{"topic":"Current delivery work","purpose":"Coordinate releases"}'
```

Register an existing channel or change its Prism mode with `PUT
/buzz/channels/:channelId/access`. Supply matching `mode` and
`agentProfileKey`; supported modes are `readonly`, `run-approved`, and
`full`.

## Archive

Archive or unarchive without deleting history:

```bash
curl -fsSL -X POST \
  -H "content-type: application/json" \
  -H "X-Buzz-Admin-Token: $BUZZ_CHANNEL_ADMIN_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/buzz/channels/$CHANNEL_ID/archive" \
  -d '{"archived":true}'
```

Permanent channel deletion is intentionally unavailable. Never substitute raw
Nostr events or direct relay calls.

## Members

- List: `GET /buzz/channels/:channelId/members`
- Add: `POST /buzz/channels/:channelId/members` with `pubkey` and optional role
- Remove: `DELETE /buzz/channels/:channelId/members/:pubkey`

Allowed roles are `owner`, `admin`, `member`, `guest`, and `bot`. Never remove
the final owner. Report the channel ID and each completed membership change.
