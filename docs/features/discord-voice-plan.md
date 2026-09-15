# Discord Voice Flow

This document captures the current Discord voice-recording path in `services/source-adapter`.

## Current Goals

- keep Discord text chat, slash commands, and voice flows in one TypeScript service
- avoid Supabase and avoid permanent raw-audio storage
- use local/Railway volume storage for transient audio processing
- transcribe voice recordings with a Whisper-compatible voice transcription provider
- summarize transcripts through `codex-runtime`
- store transcript and summary outputs in Prism Memory inbox
- keep `n8n` as an optional legacy handoff, not the primary processing path

## Slash Commands

The Discord command surface uses the `prism-` prefix:

- `/prism-ping`
- `/prism-health`
- `/prism-chat`
- `/prism-start-cr`
- `/prism-continue-cr`
- `/prism-join`
- `/prism-record`
- `/prism-stoprecord`
- `/prism-rollcall`

## Implemented Recording Flow

1. `/prism-join`
   - joins the caller's current voice channel
   - keeps the bot available for a later recording command
   - explicitly tells the caller that the bot is connected but not recording

2. `/prism-record`
   - joins the caller's current voice channel if needed
   - creates a session under `/data/recordings/<session-id>`
   - stores current non-bot voice participants in session metadata
   - eagerly subscribes to current participant audio streams
   - also listens for Discord `speaking.start` events as a backup
   - persists wall-clock speaker timing events such as stream start, speaking start, first audio chunk, and stream end
   - writes per-speaker Ogg/Opus files under `/data/recordings/<session-id>/raw`
   - persists `session.json` with guild/channel/start/participant metadata so unfinished sessions can be recovered after an adapter restart

3. `/prism-stoprecord`
   - stops active receiver streams
   - if no active in-memory session exists, only recovers an unfinished session from the caller's current voice channel and only within `VOICE_RECOVERY_MAX_AGE_HOURS`
   - closes Ogg writers
   - runs `ffmpeg` to create segmented mono FLAC chunks under `/data/recordings/<session-id>/flac`
   - sends FLAC chunks to the configured voice transcription provider when `VOICE_TRANSCRIPTION_API_KEY` is set
   - fetches messages posted in the Discord voice channel during the recording window
   - stitches voice transcription segments and voice-channel chat messages into one timestamp-sorted transcript
   - offsets voice transcription segments from persisted wall-clock audio chunk times instead of only per-speaker chunk indexes
   - writes transcript JSON and markdown under `/data/recordings/<session-id>/transcript`
   - asks `codex-runtime` to synthesize a structured meeting summary when `CODEX_RUNTIME_BASE_URL` is set
   - writes summary JSON and markdown under `/data/recordings/<session-id>/transcript`
   - writes transcript and summary into Prism Memory inbox when `PRISM_API_BASE` and `PRISM_API_KEY` are set
   - optionally posts metadata to `N8N_WEBHOOK_URL` when that legacy handoff is configured

## Verified Success Signal

Railway validation for session `0d787315-8a99-4d16-91ea-0211f819065d` showed:

- `eager receiver subscribe`
- `received first opus chunk`
- `opusChunks=489`
- `receivedOpus=true`
- `Speakers with audio: 1`
- transcript artifact written on the adapter volume
- summary artifact written on the adapter volume
- transcript saved to Prism Memory inbox
- summary saved to Prism Memory inbox

The Discord completion message should include Prism Memory paths similar to:

```text
Transcript saved to Prism memory: inbox/memory/incoming/<timestamp>-discord-voice-<id>.json
Summary saved to Prism memory: inbox/memory/incoming/<timestamp>-discord-voice-<id>.json
```

## Runtime Dependencies

The source adapter voice path requires:

- Node 22
- `discord.js`
- `@discordjs/voice`
- `@discordjs/opus`
- `prism-media`
- `node-crc`
- `ffmpeg`
- a mounted volume at `/data` on Railway

The deployed Dockerfile installs `ffmpeg`, opus build dependencies, and the Node dependencies needed for the Ogg/Opus path.

## Railway Environment

Required for Discord voice:

- `SOURCE_ADAPTER_DATA_ROOT=/data`
- `SOURCE_ADAPTER_PUBLIC_BASE_URL=https://<discord-adapter-domain>`
- `SOURCE_ADAPTER_TOKEN=<strong-secret>`
- `DISCORD_BOT_TOKEN=<discord bot token>`
- `DISCORD_GUILD_ID=<guild id>`
- `DISCORD_CHAT_ENABLED=true`
- `DISCORD_REGISTER_COMMANDS=true`
- `VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions`
- `VOICE_TRANSCRIPTION_API_KEY=<voice transcription API key>`
- `VOICE_TRANSCRIPTION_MODEL=nvidia/parakeet-tdt-0.6b-v3`
- `VOICE_TRANSCRIPTION_LANGUAGE=en`
- `VOICE_TRANSCRIPTION_RESPONSE_FORMAT=json`
- `VOICE_TRANSCRIPTION_TIMESTAMPS=true`
- `VOICE_CHAT_MAX_MESSAGES=200`
- `VOICE_CHAT_IGNORE_BOT_MESSAGES=true`
- `VOICE_DAVE_ENCRYPTION=true`
- `VOICE_RECORDING_WARNING_MINUTES=50`
- `VOICE_RECORDING_MAX_MINUTES=60`
- `VOICE_RECOVERY_MAX_AGE_HOURS=12`
- `CODEX_RUNTIME_BASE_URL=https://<codex-runtime-domain>`
- `PRISM_API_BASE=https://<prism-memory-domain>`
- `PRISM_API_KEY=<same Prism API key>`

Recommended:

- `VOICE_FFMPEG_SEGMENT_SECONDS=180`
- recordings warn at `VOICE_RECORDING_WARNING_MINUTES` and stop automatically at `VOICE_RECORDING_MAX_MINUTES`; set `VOICE_RECORDING_MAX_MINUTES=0` to disable the automatic stop
- `/prism-stoprecord` only auto-recovers unfinished sessions from the caller's current voice channel and younger than `VOICE_RECOVERY_MAX_AGE_HOURS`; use `POST /recordings/<session-id>/recover` for explicit older recovery
- use public Railway service URLs for `CODEX_RUNTIME_BASE_URL` and `PRISM_API_BASE` until private `*.railway.internal` connectivity has been verified from inside the deployed service

## Local Development

Use the full local stack:

```bash
npm run dev:all
```

This starts `codex-runtime` on port `3030` and passes `CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030` into `source-adapter`.

Local Codex auth should normally use:

```bash
CODEX_HOME=$HOME/.codex
```

If testing manually, start `codex-runtime` first:

```bash
CODEX_HOME="$HOME/.codex" PORT=3030 npm run dev --workspace @prism-railway/codex-runtime
```

Then start `source-adapter` with:

```bash
CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030 npm run dev --workspace @prism-railway/source-adapter
```

## Artifact Layout

Each session uses:

```text
/data/recordings/<session-id>/
  session.json      # participants and timingEvents
  metadata.json     # speakers, chunks, artifacts, and timingEvents
  raw/
    <user-id>-<username>-<timestamp>.ogg
  flac/
    <user-id>-<username>-chunk_000.flac
  transcript/
    transcript.json
    transcript.md
    summary.json
    summary.md
```

Local development uses `services/source-adapter/data/recordings` unless `SOURCE_ADAPTER_DATA_ROOT` is overridden.

## Troubleshooting

If `/prism-stoprecord` reports `Speakers with audio: 0`:

- check logs for `eager receiver subscribe`
- check logs for `received first opus chunk`
- confirm the user was in the same voice channel when `/prism-record` started
- retry after the latest eager-subscribe deploy

If transcription is missing:

- confirm `VOICE_TRANSCRIPTION_BASE_URL` and `VOICE_TRANSCRIPTION_API_KEY` are set
- confirm `ffmpeg` exists in the deployment image
- inspect `/data/recordings/<session-id>/flac`

If `/prism-stoprecord` says no active recording after `/prism-record` succeeded:

- check logs for `voice connection error` or `DecryptionFailed`
- keep `VOICE_DAVE_ENCRYPTION=true` unless Discord voice receive behavior changes and this has been retested
- with the recovery path deployed, `/prism-stoprecord` should recover the newest unfinished session for the guild from the recording volume
- if recovery fails, inspect `/data/recordings/<session-id>/session.json` and `/data/recordings/<session-id>/raw`
- to recover a specific known session, call `POST /recordings/<session-id>/recover` with `X-Adapter-Token`

If voice-channel chat messages are missing:

- confirm the messages were posted in the Discord voice channel chat, not an unrelated text channel
- confirm the message timestamps fall between `/prism-record` and `/prism-stoprecord`
- confirm the bot has read-message-history access to the voice channel
- check logs for `voice chat transcript messages session=<id> count=<n>`

If summary is missing:

- confirm `CODEX_RUNTIME_BASE_URL` is set
- confirm `codex-runtime` health is reachable
- check logs for the detailed fetch cause

If Prism Memory inbox paths are missing:

- confirm `PRISM_API_BASE` and `PRISM_API_KEY`
- confirm `prism-memory` health is reachable
- check logs for `prism memory ingest skipped`

If `DISCORD_BOT_TOKEN` appears in logs or tool output:

- rotate the token in the Discord developer portal
- update `DISCORD_BOT_TOKEN` in Railway
- redeploy `discord-adapter`

## Legacy Reference

The older reference bot in `/home/dekanjbrown/Projects/hausdao/hausos/bot-server` used a PCM-first path:

- join with `@discordjs/voice`
- receive opus audio per speaker
- decode to PCM at `48kHz`, `2ch`
- write per-speaker `.pcm` files
- run `ffmpeg` to convert PCM into segmented FLAC chunks
- post metadata to `n8n`

The current Prism implementation keeps the useful Discord receiver and FLAC segmentation ideas, but records Ogg/Opus directly before FLAC conversion and keeps transcription, summary, and Prism Memory ingestion inside this stack.
