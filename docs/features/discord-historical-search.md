# Discord Historical Search

Status: Discord-first slice implemented locally; live deployment verification pending

## Purpose

Prism Memory is intentionally optimized for recent activity, rollups, derived
state, events, and durable knowledge. It is not intended to duplicate the full
message history of a long-running Discord community before an agent can answer
a historical question.

For communities with many years of Discord history, Prism should supplement
Memory retrieval with Discord's native guild message search. This gives trusted
agents access to primary-source historical evidence without requiring a complete
Discord backfill into Prism Memory.

Discord is the first source covered by this feature. The agent-facing contract
should nevertheless be source-neutral so Buzz, Telegram, email, and future
providers can participate according to the history capabilities each provider
actually exposes.

## Goals

- Keep Prism Memory as the first retrieval layer for current synthesized state.
- Let trusted agents search the Discord guild's long-term history on demand.
- Return direct Discord message links and enough metadata to cite primary
  evidence.
- Retrieve nearby messages when a matching message needs conversational
  context.
- Enforce source and channel access on the server, not through skill prose.
- Report Discord indexing, permission, pagination, and coverage limitations
  explicitly.
- Report source-specific search modes and coverage without implying that every
  provider supports Discord-equivalent native history search.
- Avoid coupling historical search to Memory collection checkpoints or digest
  generation.

## Non-Goals

- Backfill the entire Discord guild into Prism Memory before search is useful.
- Automatically promote search results into Memory or Knowledge.
- Replace Memory, digest, objective, throughline, or Knowledge retrieval.
- Provide message mutation, moderation, deletion, or outbound delivery.
- Claim that Discord search covers channels the bot cannot view.
- Define complete historical-search behavior for Telegram, Buzz, or email in
  the first slice.
- Introduce a Telegram user-authorized MTProto or TDLib client in the first
  slice.

## Retrieval Model

The agent should treat Prism Memory and Discord search as complementary layers:

```text
Knowledge       canonical or reviewed durable material
Memory          recent rollups, events, state, and synthesized context
Discord search  long-range primary-source evidence on demand
```

Default retrieval order:

1. Query the narrowest Prism Memory, state, digest, artifact, or Knowledge
   endpoint that can answer the question.
2. Search Discord when the request is historical, asks what was originally
   said, predates available Memory coverage, or needs stronger primary evidence.
3. Use Discord as a supplement when Memory provides a useful synthesis but not
   enough supporting detail.
4. Fetch surrounding Discord messages for a small number of promising matches.
5. Distinguish synthesized Prism conclusions from raw Discord evidence in the
   answer and link to the original messages.

A caller may search Discord first when the user explicitly asks to search
Discord or provides a historical Discord-specific question.

## Discord Capability

Discord exposes guild message search at:

```http
GET /guilds/{guild.id}/messages/search
```

The Discord adapter should call this endpoint with its existing bot identity.
The application must have the privileged `MESSAGE_CONTENT` intent enabled, and
the bot must have `READ_MESSAGE_HISTORY` in the channels being searched.
Discord applies the bot's channel visibility when producing results.

Relevant Discord constraints include:

- at most 25 results per request;
- offset pagination is capped at 9,975;
- searches may be sorted by timestamp or relevance;
- content, channel, author, mention, attachment, and related filters are
  available;
- a guild that is not yet indexed may return `202 Accepted` with indexing
  progress and a retry delay;
- result counts and page lengths are not guaranteed to remain stable while
  messages are changing;
- old or cold messages may occasionally produce fewer results than the
  requested page size.

The Prism contract must not hide these limitations.

## Provider Capability Model

The common source-history interface must describe what each configured source
can actually search. A provider may use one of these modes:

- `native-search`: the provider exposes server-side full-text or structured
  historical search;
- `bounded-read-through`: the provider exposes recent or range-bounded message
  reads that Prism can filter without changing collection state;
- `local-index`: Prism can search only records it previously observed and
  retained;
- `unavailable`: the source is configured for communication but has no safe
  historical-search capability.

Initial provider behavior:

| Source | Mode | Coverage |
| --- | --- | --- |
| Discord | `native-search` | Guild history visible to the bot and indexed by Discord |
| Buzz | `bounded-read-through` | Allowed channels within the configured relay lookback and result limits |
| Telegram | `local-index` | Updates observed and retained by the bot after it joined the chat |
| Email | `unavailable` | Until a provider connector and mailbox/folder policy are configured |

### Buzz

The current Buzz integration exposes channel messages through the official CLI
using channel, `since`, and `limit` parameters. It does not expose native
full-text search equivalent to Discord guild search.

The common source-history API may initially filter a bounded Buzz read-through
result by query, author, thread, and timestamp. It must report the active
`maxLookbackSeconds` and `maxMessages` values. Empty results outside that window
are incomplete coverage, not evidence that a message never existed.

Longer-range Buzz search requires either broader relay reads supported by the
provider or a local retained-message index. The existing direct Buzz history
route remains non-collecting and must not advance `/sync` checkpoints.

### Telegram

The Telegram Bot API does not provide arbitrary chat-history traversal or
full-text message search. It delivers updates through polling or webhooks, and
unconsumed updates are retained by Telegram for no longer than 24 hours.

Prism should persist normalized Telegram messages as the bot observes them and
search that retained local history. Capability responses must include the
earliest retained timestamp for each authorized chat and label coverage as
`bot-seen-updates`.

Telegram's MTProto API and TDLib can retrieve and search chat history for a
user-authorized client, but that is a different identity, credential, privacy,
and operational model from the existing bot adapter. Prism should not add a
user-authorized Telegram client merely to make provider capabilities appear
uniform. That integration would require a separate future security and product
decision.

## Service Boundaries

### Site

Site owns the agent-facing API and authorization decision:

```http
GET /agent/source-history/capabilities
POST /agent/source-history/search
POST /agent/source-history/context
```

These routes use the normal Prism service token. Site validates and narrows the
requested scope, then calls the communication adapter with its internal adapter
credential. Codex Runtime and skills must not receive the communication adapter
token merely to perform read-only history queries.

Site should record compact audit metadata such as caller context, requested
scope, result count, and duration. It must not copy full message bodies into an
audit log.

### Communication Adapter

The communication adapter owns Discord-specific operations:

- calling Discord's search endpoint;
- translating Prism filters into Discord query parameters;
- handling Discord rate limits and `202` indexing responses;
- normalizing nested Discord search results;
- fetching a bounded window around a selected message;
- resolving channel and thread metadata;
- constructing canonical Discord message URLs.

The adapter operations should be read-only. They must not advance `/sync`
checkpoints or post search results to Prism Memory.

Provider-specific adapter operations may remain internal implementation details.
The Site agent contract should remain source-neutral so the skill does not need
to learn a different route family for every provider.

### Prism Memory

Prism Memory remains unchanged for the first slice. Its existing read APIs
continue to provide recent and synthesized context. Historical Discord reads do
not become Memory records unless an operator explicitly invokes a separate
promotion or ingestion flow.

## Configuration

Historical search should not introduce new required environment variables.

The Discord implementation should reuse existing adapter configuration:

- `DISCORD_BOT_TOKEN` for the existing bot identity;
- `DISCORD_GUILD_ID` for the configured guild;
- existing Site and communication-adapter URLs and service credentials for
  internal routing.

Search behavior and authorization belong in Site-owned configuration, preferably
as an extension of source-adapter policy. Configurable values may include:

- whether history search is enabled for a platform;
- target-specific `historyScopes`;
- maximum context messages before and after a result;
- allowed search filters;
- whether age-restricted channels may be searched;
- provider-specific retention settings for locally retained history;
- operator-selected result and query limits below provider hard limits.

These settings should have conservative code defaults so the feature can start
without a configuration migration. Operators should manage non-secret settings
through `/agent/source-adapter-policy` and the corresponding Admin Console UI,
not through new Railway variables.

Provider secrets remain in their existing credential boundary. Future email or
other provider search should use Gateway-leased credentials rather than adding
search-specific secrets to Site or Codex Runtime environment configuration.

The capability endpoint should derive availability from existing provider
configuration and permissions. A separate `DISCORD_HISTORY_SEARCH_ENABLED`
environment flag is not required.

## Agent Search Contract

Proposed request:

```json
{
  "source": "discord",
  "query": "workflow approval",
  "channelIds": ["123", "456"],
  "authorIds": [],
  "mentions": [],
  "from": "2021-01-01T00:00:00.000Z",
  "to": "2026-08-13T23:59:59.999Z",
  "has": [],
  "sortBy": "relevance",
  "sortOrder": "desc",
  "includeNsfw": false,
  "limit": 25,
  "cursor": null
}
```

Rules:

- `source` is required and must be present in the current capability response.
- `query` maps to Discord's content search.
- `channelIds` and `authorIds` are intersected with the server-authorized scope.
- `from` and `to` are converted to Discord snowflake boundaries for `min_id`
  and `max_id`.
- `limit` must be between 1 and 25.
- `includeNsfw` defaults to `false` and may be rejected by policy.
- The public contract uses an opaque cursor rather than exposing Discord offset
  mechanics as the stable Prism API.
- Unknown filters are rejected rather than silently ignored.

Proposed response:

```json
{
  "ok": true,
  "source": "discord",
  "query": {
    "text": "workflow approval",
    "sortBy": "relevance"
  },
  "coverage": {
    "guildId": "789",
    "scope": "authorized-channels",
    "complete": true,
    "limitations": []
  },
  "totalResults": 143,
  "results": [
    {
      "source": "discord",
      "guildId": "789",
      "channelId": "123",
      "channelName": "ops",
      "threadId": null,
      "messageId": "999",
      "author": {
        "id": "456",
        "name": "Alice",
        "bot": false
      },
      "timestamp": "2022-06-04T15:20:00.000Z",
      "editedTimestamp": null,
      "text": "We should keep the approval gate...",
      "url": "https://discord.com/channels/789/123/999",
      "attachments": [],
      "embeds": []
    }
  ],
  "nextCursor": "opaque-or-null"
}
```

The response should preserve exact source text within reasonable payload limits.
It should not generate summaries in the adapter or Site route.

For Buzz and Telegram, the same envelope applies, but `coverage` must identify
the provider mode, earliest available timestamp when known, active lookback or
result limits, and whether the result set is complete for the requested range.

## Context Contract

Search results often need nearby conversation to be interpretable. Proposed
request:

```json
{
  "source": "discord",
  "channelId": "123",
  "messageId": "999",
  "before": 5,
  "after": 5
}
```

The route should use Discord's channel message retrieval around the selected
message and return messages in chronological order. `before` and `after` should
have conservative server-side maximums. The result must include the selected
message even when no surrounding messages are available.

Context lookup must repeat authorization checks. A valid message ID from one
channel must not grant access to another channel.

Buzz context should expand the relevant reply thread within configured limits.
Telegram context may return only neighboring retained updates and must not
imply that missing unobserved messages are available.

## Capability Contract

Proposed response:

```json
{
  "ok": true,
  "sources": {
    "discord": {
      "mode": "native-search",
      "coverage": "provider-history",
      "supportsQuery": true,
      "supportsContext": true,
      "limitations": ["bot-visible-channels-only"]
    },
    "buzz": {
      "mode": "bounded-read-through",
      "coverage": "configured-lookback",
      "supportsQuery": true,
      "supportsContext": true,
      "maxLookbackSeconds": 7200,
      "maxMessages": 100
    },
    "telegram": {
      "mode": "local-index",
      "coverage": "bot-seen-updates",
      "supportsQuery": true,
      "supportsContext": true,
      "earliestAvailable": "2026-07-12T16:42:00.000Z"
    },
    "email": {
      "mode": "unavailable",
      "coverage": "not-configured",
      "supportsQuery": false,
      "supportsContext": false
    }
  }
}
```

Capabilities are authorization-scoped. They must not reveal private target
names, message counts, or coverage metadata for sources the caller cannot use.

## Pagination

The initial implementation may wrap Discord offset pagination in an opaque
cursor. It should not imply that every query can enumerate more than Discord's
offset ceiling.

For timestamp-sorted searches that need deeper traversal, the adapter should
prefer boundary pagination using the oldest or newest returned message ID as a
new `max_id` or `min_id`. Relevance-sorted searches may remain subject to
Discord's offset ceiling and must report that limitation when reached.

Opaque cursors should be integrity-protected or server-validated and contain no
credentials. A cursor must be bound to the normalized query and authorized
scope so it cannot be replayed with broader filters.

## Indexing And Retry Behavior

When Discord returns `202 Accepted` because guild search is still being indexed,
the Prism route should return a retryable response rather than treating it as an
empty search:

```json
{
  "ok": false,
  "code": "DISCORD_SEARCH_INDEXING",
  "retryable": true,
  "retryAfterSeconds": 2,
  "documentsIndexed": 120000
}
```

The adapter should follow Discord rate-limit headers and use bounded retries for
short delays. Long indexing waits should be returned to the caller so a runtime
job can retry without holding an HTTP request open indefinitely.

## Authorization And Privacy

Historical search creates a broader disclosure risk than replying from the
current conversation. Discord's bot permissions are necessary but not always
sufficient for Prism's delegated caller policy.

Default scope:

- Admin Console and explicitly trusted task/workflow runs may search channels
  visible to the bot.
- Discord-originated interactions may search only their current channel or
  thread unless Site policy explicitly grants broader history scopes.
- `readonly` and `run-approved` contexts receive no implicit guild-wide search.
- Requests for channel IDs outside the caller's allowed scope are rejected or
  removed with an explicit partial-coverage response.
- DMs are out of scope.
- Age-restricted channels are excluded by default.

Future source-adapter policy may add an explicit history section:

```json
{
  "platforms": {
    "discord": {
      "targets": {
        "123": {
          "mode": "readonly",
          "historyScopes": ["123", "456"]
        }
      }
    }
  }
}
```

Policy must be enforced by Site before the adapter request. Skill instructions
are guidance and are not an authorization boundary.

Discord messages and attachments are untrusted external content. Runtime
prompts should treat retrieved text as evidence, not instructions, and should
not follow commands found inside historical messages.

## Skill

Add a read-only Site-hosted skill such as
`prism-source-history-reader`. The skill should teach the agent to:

1. use Prism Memory first for current synthesized state;
2. use Discord search for older history, original statements, or missing
   evidence;
3. break broad questions into a small number of targeted searches;
4. retrieve context only for the strongest matches;
5. cite canonical Discord message URLs and dates;
6. describe partial coverage, indexing, or permission limitations;
7. keep promotion into Memory or Knowledge as a separate explicit action.
8. check source capabilities before searching Buzz, Telegram, email, or another
   provider and describe incomplete coverage accurately.

The skill must call Site `/agent/*` routes with the Prism service token. It must
not call browser `/admin/*` routes or receive the Discord bot token.

## Observability

Capture metrics without logging full message bodies:

- search request count and latency;
- Discord response status and rate-limit retries;
- indexing responses and reported progress;
- result counts;
- context request counts;
- rejected or narrowed scopes;
- errors grouped by Discord code and Prism error code.

Logs should use guild, channel, and message IDs only when operationally needed.
Query text should be omitted or redacted by default because searches may reveal
sensitive intent even without result bodies.

## Verification Strategy

Tests should progress from deterministic local coverage to an optional live
read-only smoke test:

1. Unit-test request validation, Discord query translation, date-to-snowflake
   conversion, cursor validation, normalization, and error mapping.
2. Test Site authorization and scope intersection with mocked adapter
   responses.
3. Test adapter behavior with mocked Discord `200`, `202`, `403`, and `429`
   responses, including nested result normalization and retry metadata.
4. Run repository service tests without requiring Discord credentials or a live
   guild.
5. After deployment, use the live RaidGuild Prism stack on Railway for a
   read-only smoke test against known historical messages.

The live smoke test should verify:

- a known old phrase returns at least one expected Discord result;
- channel and date filters narrow results correctly;
- canonical Discord message URLs are valid;
- bounded context retrieval returns the selected message in chronological
  context;
- an unauthorized or out-of-scope target is rejected;
- search and context reads do not advance collection checkpoints or create
  Prism Memory inbox records.

Indexing and rate-limit edge cases should remain mocked unless they occur
naturally. Do not repeatedly query the live guild merely to force those states.
Live tests must use `/agent/*` service routes and existing service credentials;
they must not use browser `/admin/*` routes or print secret values.

## First Slice

- Add the Discord adapter search operation backed by native guild search.
- Add the Discord adapter bounded context operation.
- Add the source-neutral Site capability, search, and context routes.
- Advertise Discord as `native-search`; advertise Buzz and Telegram truthfully
  even before their search implementations are enabled.
- Add Site agent routes that authenticate, authorize, and proxy Discord reads.
- Support content, channel, author, date-boundary, sort, and attachment-presence
  filters.
- Normalize results and return canonical Discord message URLs.
- Handle Discord `202` indexing responses and `429` rate limits.
- Add opaque pagination with explicit coverage limitations.
- Add the read-only `prism-source-history-reader` Site-hosted skill.
- Add unit tests for filter validation, response normalization, policy scope,
  pagination, indexing responses, and authorization failures.
- Document required Discord permissions and the privileged message-content
  intent.
- Add no new required environment variables; use existing Discord/service
  configuration and Site-owned source policy.
- Complete a read-only smoke test on the RaidGuild Railway instance after local
  mocked tests pass.

## First Slice Progress

Implemented on `feat/discord-historical-search-spec`:

- protected adapter-native Discord search and bounded context operations;
- source-neutral Site capability, search, and context agent routes;
- content, channel, author, mention, date, attachment-presence, sort, limit, and
  opaque cursor translation;
- Discord indexing, permission, failure, and rate-limit error mapping;
- normalized messages with canonical URLs and thread identification;
- Site policy parsing for target `historyScopes` and source-context scope
  enforcement;
- honest capability reporting for Discord, Buzz, Telegram, and email;
- the Site-hosted `prism-source-history-reader` skill;
- mocked adapter and Site authorization tests;
- no new required environment variables.

Still pending:

- deploy Site and the Discord adapter to the RaidGuild Railway stack;
- run the read-only live smoke test;
- expose Buzz bounded read-through through the common search route;
- retain and locally index bot-seen Telegram updates.

## Later Phases

### Retrieval orchestration

- Teach the skill to compare Memory coverage with requested dates.
- Add structured result synthesis helpers while keeping raw evidence available.
- Allow approved historical discussions to be explicitly promoted into Memory
  or Knowledge with provenance.

### Other providers

- Put Buzz bounded history behind the common source-history API and report the
  configured lookback and result limits.
- Persist Telegram updates for local history search, then expose only updates
  observed and retained by the bot, with the earliest available timestamp
  reported.
- Add email-provider search through an explicitly configured Gateway credential
  and mailbox/folder allowlists.
- Extend the capability endpoint as sources become available without changing
  the skill's route contract.

### Optional local history index

- Add a derived local full-text index if cross-source ranking, lower latency, or
  provider-independent retention becomes valuable.
- Continue using Discord native search as the authoritative long-range fallback
  even if recent Discord messages are locally indexed.

## Open Questions

- Should full trusted Discord interactions inherit guild-wide search, or should
  every non-console context require explicit `historyScopes`?
- Should the first cursor implementation support boundary traversal only for
  timestamp sorting, leaving relevance searches capped by Discord offsets?
- How much attachment and embed text should be returned by default?
- Should context retrieval include thread starter messages automatically?
- What audit retention is appropriate for query metadata?
- Where should retained Telegram message history live, and what retention and
  deletion policy should apply?
- Does the Buzz provider support a safe longer-range relay query beyond the
  current CLI limits, or should durable Buzz search depend on a local index?

## Acceptance Criteria

- An authorized agent can search Discord messages older than Prism Memory's
  retained or synthesized window without first backfilling them into Memory.
- Results contain source text, timestamps, channel/thread metadata, authors, and
  working Discord message URLs.
- An agent can retrieve bounded surrounding context for an authorized result.
- Search and context reads do not change Memory or source collection
  checkpoints.
- Unauthorized channel scope cannot be widened through request filters or
  cursors.
- Discord indexing and pagination limitations are visible to the caller and are
  never represented as a confident empty result.
- The agent skill uses Memory for recent synthesized context and Discord search
  for long-range primary evidence.
- Capability responses distinguish Discord native search, Buzz bounded
  read-through, Telegram bot-seen local history, and unavailable providers.
- The Discord-first slice requires no new environment variables beyond the
  existing Discord adapter and Site service configuration.

## Provider References

- [Discord Search Guild Messages](https://docs.discord.com/developers/resources/message#search-guild-messages)
- [Telegram Bot API update retention](https://core.telegram.org/bots/api#getting-updates)
- [Telegram `messages.getHistory` user-only method](https://core.telegram.org/method/messages.getHistory)
