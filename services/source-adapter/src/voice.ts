import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  PermissionResolvable,
  TextBasedChannel,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";
import { GuildScheduledEventStatus, PermissionFlagsBits } from "discord.js";
import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import prism from "prism-media";
import { requestSiteRuntime } from "./site-runtime.js";

const voiceDaveEncryptionRaw = process.env.VOICE_DAVE_ENCRYPTION?.trim().toLowerCase();
const voiceDaveEncryptionExplicit = Boolean(voiceDaveEncryptionRaw);
const voiceDaveEncryptionEnabled = voiceDaveEncryptionRaw ? voiceDaveEncryptionRaw === "true" : true;

export type VoiceChunkMetadata = {
  audioUrl: string | null;
  index: number;
  startMs?: number;
  endMs?: number;
  startedAt?: string;
  endedAt?: string;
  byteStart: number;
  byteEnd: number;
  fileName: string;
  contentType: string;
};

export type VoiceTimingEvent = {
  type: "stream.start" | "speaking.start" | "audio.first_chunk" | "stream.end";
  userId: string;
  username: string;
  at: string;
};

export type SpeakerMetadata = {
  userId: string;
  username: string;
  duration: number;
  startedAt?: string;
  firstAudioAt?: string;
  endedAt?: string;
  audioUrl: string | null;
  chunks: VoiceChunkMetadata[];
  rawPath: string;
};

export type ParticipantPresence = {
  userId: string;
  username: string;
  joinedAt: number;
  leftAt?: number;
  didSpeak: boolean;
};

export type RecordingWebhookMetadata = {
  meeting: {
    name?: string;
    platform: "discord";
    channel_id: string;
    attendee_ids: string[];
    attendee_count: number;
    location?: string;
    timezone?: string;
  };
  sys: {
    event_name: "meeting.held";
    time_window: {
      start: string;
      end: string;
    };
  };
};

export type RecordingSessionMetadata = {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  channelId: string;
  guildId: string;
  scheduledEventId?: string | null;
  scheduledEvent?: ScheduledEventMetadata | null;
  speakers: SpeakerMetadata[];
  participants: ParticipantPresence[];
  timingEvents?: VoiceTimingEvent[];
  metadata: RecordingWebhookMetadata;
  source: {
    service: "source-adapter";
    transport: "discord";
    storage: "local-volume";
    recordingBaseUrl: string | null;
    authHeader: "X-Adapter-Token";
  };
  artifacts?: {
    transcriptJsonPath?: string;
    transcriptMarkdownPath?: string;
    summaryJsonPath?: string;
    summaryMarkdownPath?: string;
    prismMemoryTranscriptPath?: string;
    prismMemorySummaryPath?: string;
  };
};

type ScheduledEventMetadata = {
  id: string;
  name: string | null;
  description: string | null;
  status: string | number | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  channelId: string | null;
  entityType: string | number | null;
  recurrenceRule: unknown | null;
};

export type StopRecordingResult = {
  privateMessage: string;
  publicMessage?: string | null;
};

type TranscriptionSegment = {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speakerId: string;
  chunkIndex?: number;
  source: "voice" | "chat";
  messageId?: string;
  jumpUrl?: string;
  timestamp?: string;
};

type SpeakerTranscript = {
  userId: string;
  username: string;
  text: string;
  segments: TranscriptionSegment[];
};

type SkippedTranscriptionChunk = {
  speaker: string;
  speakerId: string;
  chunkIndex: number;
  fileName: string;
  reason: string;
};

type SessionTranscriptArtifacts = {
  speakerTranscripts: SpeakerTranscript[];
  chatMessages: TranscriptionSegment[];
  mergedSegments: TranscriptionSegment[];
  mergedTranscript: string;
  transcriptJsonPath: string;
  transcriptMarkdownPath: string;
  skippedChunks?: SkippedTranscriptionChunk[];
};

type SessionSummary = {
  title: string;
  tldr: string;
  summary: string;
  actionItems: Array<{
    name: string;
    description: string;
    assignedTo: string | null;
    dueDate: string | null;
    params: Record<string, string>;
  }>;
  notableQuotes: Array<{
    author: string;
    quote: string;
    paraphrase: string;
  }>;
  tags: string[];
  raw?: unknown;
  summaryJsonPath: string;
  summaryMarkdownPath: string;
};

type SessionRecap = {
  title: string;
  recap: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{
    description: string;
    owner: string | null;
    dueDate: string | null;
  }>;
  openQuestions: string[];
  confidence: "low" | "medium" | "high";
};

type VoiceTranscriptionResponse = {
  text?: string;
  duration?: number;
  timestamps?: {
    segment?: Array<{
      text?: string;
      start?: number;
      end?: number;
    }>;
  };
};

type JsonObject = Record<string, unknown>;

const MIN_TRANSCRIBABLE_AUDIO_BYTES = 16 * 1024;

type VoiceConnectionState = {
  channelId: string;
  channelName: string;
  connection: VoiceConnection;
  receiverStartHandler: (userId: string) => void;
};

type SpeakerStream = {
  userId: string;
  username: string;
  filename: string;
  rawPath: string;
  stream?: WriteStream;
  startedAt: number;
  firstAudioAt?: number;
  endedAt?: number;
  didSpeak: boolean;
};

type ActiveAudioStream = {
  userId: string;
  opusStream: NodeJS.ReadableStream;
  oggStream: NodeJS.ReadWriteStream;
  startedAt: number;
  receivedOpus: boolean;
  pipelinePromise: Promise<void>;
};

type RecordingSession = {
  sessionId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  scheduledEventId?: string | null;
  scheduledEvent?: ScheduledEventMetadata | null;
  announcementChannel: TextBasedChannel | null;
  startedAt: number;
  rootDir: string;
  rawDir: string;
  flacDir: string;
  transcriptDir: string;
  participants: Map<string, ParticipantPresence>;
  speakers: Map<string, SpeakerStream>;
  timingEvents: VoiceTimingEvent[];
  activeAudioStreams: Map<string, ActiveAudioStream>;
  speakingHandler: (userId: string) => void;
  speakingEndHandler: (userId: string) => void;
  connectionSpeakingHandler: (userId: string, speaking: boolean) => void;
  warningTimer?: NodeJS.Timeout;
  autoStopTimer?: NodeJS.Timeout;
  recoveredFromDisk?: boolean;
};

type PersistedRecordingSession = {
  sessionId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  scheduledEventId?: string | null;
  scheduledEvent?: ScheduledEventMetadata | null;
  startedAt: string;
  participants?: Array<{
    userId: string;
    username: string;
    joinedAt?: string;
    leftAt?: string;
    didSpeak?: boolean;
  }>;
  timingEvents?: VoiceTimingEvent[];
};

type VoiceManagerOptions = {
  client: Client;
  dataRoot: string;
  publicBaseUrl: () => string | null;
  describeError: (error: unknown) => string;
};

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "user";
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return parsed;
}

function parseMinuteEnv(name: string, defaultValue: number): number {
  const raw = (process.env[name] ?? "").trim();
  const value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(0, value);
}

function parseHourEnv(name: string, defaultValue: number): number {
  const raw = (process.env[name] ?? "").trim();
  const value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(0, value);
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return defaultValue;
}

function parseIntegerEnv(name: string, defaultValue: number): number {
  const raw = (process.env[name] ?? "").trim();
  const value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return value;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

function isoTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function voiceOffsetSeconds(at: string | undefined, sessionStartedAt: number): number {
  if (!at) {
    return 0;
  }
  const value = Date.parse(at);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, (value - sessionStartedAt) / 1000);
}

export class DiscordVoiceManager {
  private readonly client: Client;
  private readonly dataRoot: string;
  private readonly publicBaseUrl: () => string | null;
  private readonly describeError: (error: unknown) => string;
  private readonly connections = new Map<string, VoiceConnectionState>();
  private readonly sessionsByGuild = new Map<string, RecordingSession>();
  private readonly recordingOperationsByGuild = new Map<string, "starting" | "stopping">();
  private readonly recapOperationsByGuild = new Set<string>();
  private readonly activeUserStreams = new Map<string, Map<string, ActiveAudioStream>>();
  private readonly ffmpegSegmentSeconds = Number.parseInt(process.env.VOICE_FFMPEG_SEGMENT_SECONDS ?? "180", 10) || 180;
  private readonly voiceChatMaxMessages = Number.parseInt(process.env.VOICE_CHAT_MAX_MESSAGES ?? "200", 10) || 200;
  private readonly recordingWarningMinutes = parseMinuteEnv("VOICE_RECORDING_WARNING_MINUTES", 50);
  private readonly recordingMaxMinutes = parseMinuteEnv("VOICE_RECORDING_MAX_MINUTES", 60);
  private readonly recoveryMaxAgeHours = parseHourEnv("VOICE_RECOVERY_MAX_AGE_HOURS", 12);
  private readonly recordingsRoot: string;
  private recordingSummaryProfileCache: { loadedAt: number; content: string; source: string } | null = null;

  constructor(options: VoiceManagerOptions) {
    this.client = options.client;
    this.dataRoot = options.dataRoot;
    this.publicBaseUrl = options.publicBaseUrl;
    this.describeError = options.describeError;
    this.recordingsRoot = path.join(this.dataRoot, "recordings");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.recordingsRoot, { recursive: true });
  }

  private async resolveMemberVoiceChannel(interaction: ChatInputCommandInteraction): Promise<{ guild: Guild; member: GuildMember; channel: VoiceBasedChannel }> {
    if (!interaction.guildId || !interaction.guild) {
      throw new Error("This command must be used inside a Discord server.");
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    if (!channel || !channel.isVoiceBased()) {
      throw new Error(`Join a voice channel first, then run \`/${interaction.commandName}\`.`);
    }
    return { guild: interaction.guild, member, channel };
  }

  private requireBotVoicePermissions(guild: Guild, channel: VoiceBasedChannel) {
    const me = guild.members.me;
    if (!me) {
      throw new Error("Bot membership is not ready in this guild yet. Try again in a few seconds.");
    }
    const permissions = channel.permissionsFor(me);
    const required: Array<[PermissionResolvable, string]> = [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.Connect, "Connect"],
      [PermissionFlagsBits.Speak, "Speak"],
      [PermissionFlagsBits.UseVAD, "Use Voice Activity"],
    ];
    const missing = required
      .filter(([permission]) => !permissions?.has(permission))
      .map(([, label]) => label);
    if (missing.length > 0) {
      throw new Error(`Missing voice permissions in **${channel.name}**: ${missing.join(", ")}`);
    }
  }

  private ensureParticipant(session: RecordingSession, member: GuildMember): ParticipantPresence {
    const existing = session.participants.get(member.user.id);
    if (existing) {
      existing.username = member.displayName;
      existing.leftAt = undefined;
      return existing;
    }
    const participant: ParticipantPresence = {
      userId: member.user.id,
      username: member.displayName,
      joinedAt: Date.now(),
      didSpeak: false,
    };
    session.participants.set(participant.userId, participant);
    return participant;
  }

  private recordTimingEvent(
    session: RecordingSession,
    type: VoiceTimingEvent["type"],
    userId: string,
    username: string,
    at = Date.now(),
  ): VoiceTimingEvent {
    const event: VoiceTimingEvent = {
      type,
      userId,
      username,
      at: isoTimestamp(at),
    };
    session.timingEvents.push(event);
    void this.persistSession(session).catch((error) => {
      console.warn(`[discord-adapter] failed to persist voice timing event session=${session.sessionId}: ${this.describeError(error)}`);
    });
    return event;
  }

  private persistableSession(session: RecordingSession) {
    return {
      sessionId: session.sessionId,
      guildId: session.guildId,
      channelId: session.channelId,
      channelName: session.channelName,
      scheduledEventId: session.scheduledEventId ?? null,
      scheduledEvent: session.scheduledEvent ?? null,
      startedAt: isoTimestamp(session.startedAt),
      participants: [...session.participants.values()].map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        joinedAt: isoTimestamp(participant.joinedAt),
        leftAt: participant.leftAt ? isoTimestamp(participant.leftAt) : undefined,
        didSpeak: participant.didSpeak,
      })),
      timingEvents: session.timingEvents,
    };
  }

  private async persistSession(session: RecordingSession): Promise<void> {
    await fs.writeFile(
      path.join(session.rootDir, "session.json"),
      `${JSON.stringify(this.persistableSession(session), null, 2)}\n`,
      "utf8",
    );
  }

  private async ensureVoiceConnection(guild: Guild, channel: VoiceBasedChannel): Promise<VoiceConnectionState> {
    const existing = this.connections.get(guild.id);
    if (existing && existing.channelId === channel.id) {
      return existing;
    }
    if (existing) {
      existing.connection.receiver.speaking.off("start", existing.receiverStartHandler);
      existing.connection.destroy();
      this.connections.delete(guild.id);
    }
    const createConnection = (daveEncryption: boolean) =>
      joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        daveEncryption,
      });
    const attachConnectionLogging = (connectionToLog: VoiceConnection) => {
      connectionToLog.on("error", (error) => {
        console.warn(`[discord-adapter] voice connection error guild=${guild.id}: ${this.describeError(error)}`);
      });
      connectionToLog.on("stateChange", (oldState, newState) => {
        if (oldState.status !== newState.status) {
          console.log(`[discord-adapter] voice connection state guild=${guild.id} ${oldState.status}->${newState.status}`);
        }
      });
    };
    let connection = createConnection(voiceDaveEncryptionEnabled);
    console.log(
      `[discord-adapter] joining voice guild=${guild.id} channel=${channel.id} daveEncryption=${voiceDaveEncryptionEnabled ? "true" : "false"}${voiceDaveEncryptionExplicit ? "" : " default"}`,
    );
    attachConnectionLogging(connection);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
    } catch (error) {
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      const joinedTargetChannel = me?.voice.channelId === channel.id;
      if (!joinedTargetChannel) {
        connection.destroy();
        if (voiceDaveEncryptionEnabled && !voiceDaveEncryptionExplicit) {
          console.warn(
            `[discord-adapter] voice join failed with default DAVE encryption for guild ${guild.id}; retrying with daveEncryption=false`,
            this.describeError(error),
          );
          connection = createConnection(false);
          attachConnectionLogging(connection);
          await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
        } else {
          throw error;
        }
      } else {
        console.warn(
          `[discord-adapter] voice join ready-wait failed for guild ${guild.id}, but bot is present in ${channel.id}; continuing`,
          this.describeError(error),
        );
      }
    }
    const receiverStartHandler = (userId: string) => {
      const activeSession = this.sessionsByGuild.get(guild.id);
      if (!activeSession) {
        return;
      }
      console.log(`[discord-adapter] receiver speaking start session=${activeSession.sessionId} user=${userId}`);
      void this.beginSpeakerCapture(activeSession, userId, "speaking").catch((error) => {
        console.error("[discord-adapter] receiver speaker capture failed", this.describeError(error));
      });
    };
    connection.receiver.speaking.on("start", receiverStartHandler);

    const state: VoiceConnectionState = {
      channelId: channel.id,
      channelName: channel.name,
      connection,
      receiverStartHandler,
    };
    this.connections.set(guild.id, state);
    return state;
  }

  private scheduledEventMetadata(event: {
    id: string;
    name?: string | null;
    description?: string | null;
    status?: string | number | null;
    scheduledStartTimestamp?: number | null;
    scheduledEndTimestamp?: number | null;
    channelId?: string | null;
    entityType?: string | number | null;
    recurrenceRule?: unknown;
  }): ScheduledEventMetadata {
    return {
      id: event.id,
      name: event.name ?? null,
      description: event.description ?? null,
      status: event.status ?? null,
      scheduledStartAt: event.scheduledStartTimestamp ? new Date(event.scheduledStartTimestamp).toISOString() : null,
      scheduledEndAt: event.scheduledEndTimestamp ? new Date(event.scheduledEndTimestamp).toISOString() : null,
      channelId: event.channelId ?? null,
      entityType: event.entityType ?? null,
      recurrenceRule: event.recurrenceRule ?? null,
    };
  }

  private async resolveScheduledEvent(guild: Guild, channelId: string, atMs = Date.now()): Promise<ScheduledEventMetadata | null> {
    try {
      const scheduledEvents = await guild.scheduledEvents.fetch();
      const candidateEvents = [...scheduledEvents.values()]
        .filter((event) => event.channelId === channelId)
        .map((event) => {
          const start = event.scheduledStartTimestamp ?? 0;
          const end = event.scheduledEndTimestamp ?? start + 6 * 60 * 60 * 1000;
          const isActive = event.status === GuildScheduledEventStatus.Active;
          const isNearRecordingWindow = start <= atMs + 2 * 60 * 60 * 1000 && end >= atMs - 6 * 60 * 60 * 1000;
          return { event, start, isActive, isNearRecordingWindow };
        })
        .filter(({ event, isActive, isNearRecordingWindow }) =>
          isActive || (event.status === GuildScheduledEventStatus.Scheduled && isNearRecordingWindow),
        )
        .sort((left, right) => {
          if (left.isActive !== right.isActive) {
            return left.isActive ? -1 : 1;
          }
          return Math.abs(left.start - atMs) - Math.abs(right.start - atMs);
        });
      const candidate = candidateEvents[0]?.event;
      if (candidate) {
        return this.scheduledEventMetadata(candidate);
      }
      for (const event of scheduledEvents.values()) {
        if (event.channelId === channelId) {
          console.warn(
            `[discord-adapter] skipped scheduled event outside recording window guild=${guild.id} channel=${channelId} event=${event.id} status=${event.status}`,
          );
        }
      }
    } catch (error) {
      console.warn(`[discord-adapter] scheduled event lookup failed guild=${guild.id} channel=${channelId}: ${this.describeError(error)}`);
    }
    return null;
  }

  async join(interaction: ChatInputCommandInteraction): Promise<string> {
    const { guild, channel } = await this.resolveMemberVoiceChannel(interaction);
    this.requireBotVoicePermissions(guild, channel);
    await this.ensureVoiceConnection(guild, channel);
    return [
      `Joined **${channel.name}**.`,
      "I am connected but not recording.",
      "Run `/prism-record` when you want to start capturing audio.",
    ].join("\n");
  }

  async startRecording(interaction: ChatInputCommandInteraction): Promise<string> {
    const { guild, channel } = await this.resolveMemberVoiceChannel(interaction);
    this.requireBotVoicePermissions(guild, channel);
    const activeOperation = this.recordingOperationsByGuild.get(guild.id);
    if (activeOperation) {
      return `A recording is currently ${activeOperation} for this server. Try again after that operation finishes.`;
    }
    this.recordingOperationsByGuild.set(guild.id, "starting");
    try {
    const active = this.sessionsByGuild.get(guild.id);
    if (active) {
      return `Already recording in **${active.channelName}** with session \`${active.sessionId}\`.`;
    }

    const connectionState = await this.ensureVoiceConnection(guild, channel);
    const sessionId = randomUUID();
    const rootDir = path.join(this.recordingsRoot, sessionId);
    const rawDir = path.join(rootDir, "raw");
    const flacDir = path.join(rootDir, "flac");
    const transcriptDir = path.join(rootDir, "transcript");
    await fs.mkdir(rawDir, { recursive: true });
    await fs.mkdir(flacDir, { recursive: true });
    await fs.mkdir(transcriptDir, { recursive: true });

    const scheduledEvent = await this.resolveScheduledEvent(guild, channel.id);
    const session: RecordingSession = {
      sessionId,
      guildId: guild.id,
      channelId: channel.id,
      channelName: channel.name,
      scheduledEventId: scheduledEvent?.id ?? null,
      scheduledEvent,
      announcementChannel: interaction.channel && interaction.channel.isSendable() ? interaction.channel : null,
      startedAt: Date.now(),
      rootDir,
      rawDir,
      flacDir,
      transcriptDir,
      participants: new Map(),
      speakers: new Map(),
      timingEvents: [],
      activeAudioStreams: new Map(),
      speakingHandler: (_userId: string) => {},
      speakingEndHandler: (_userId: string) => {},
      connectionSpeakingHandler: (_userId: string, _speaking: boolean) => {},
    };

    for (const member of channel.members.values()) {
      if (!member.user.bot) {
        this.ensureParticipant(session, member);
      }
    }

    console.log(
      `[discord-adapter] start recording session=${sessionId} guild=${guild.id} channel=${channel.id} participants=${JSON.stringify(
        [...session.participants.values()].map((participant) => ({
          userId: participant.userId,
          username: participant.username,
        })),
      )}`,
    );
    this.activeUserStreams.set(guild.id, new Map());
    this.sessionsByGuild.set(guild.id, session);
    this.scheduleRecordingTimers(session);

    const participantIds = [...session.participants.keys()];
    if (participantIds.length > 0) {
      console.log(
        `[discord-adapter] eager receiver subscribe session=${sessionId} participants=${JSON.stringify(participantIds)}`,
      );
      const subscribeResults = await Promise.allSettled(
        participantIds.map((userId) => this.beginSpeakerCapture(session, userId, "eager")),
      );
      subscribeResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.warn(
            `[discord-adapter] eager receiver subscribe failed session=${sessionId} user=${participantIds[index]}: ${this.describeError(result.reason)}`,
          );
        }
      });
    }

    await this.persistSession(session);

    const timeoutLine = this.recordingMaxMinutes > 0
      ? `This recording will stop automatically after ${this.recordingMaxMinutes} minutes${this.recordingWarningMinutes > 0 && this.recordingWarningMinutes < this.recordingMaxMinutes ? `, with a warning at ${this.recordingWarningMinutes} minutes` : ""}.`
      : null;
    return [
      `Recording started in **${channel.name}**.`,
      `Session: \`${sessionId}\``,
      `Raw audio is being written to \`${rootDir}\`.`,
      timeoutLine,
    ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
    } finally {
      this.recordingOperationsByGuild.delete(guild.id);
    }
  }

  private scheduleRecordingTimers(session: RecordingSession): void {
    this.clearRecordingTimers(session);
    if (this.recordingMaxMinutes <= 0) {
      return;
    }

    if (this.recordingWarningMinutes > 0 && this.recordingWarningMinutes < this.recordingMaxMinutes) {
      session.warningTimer = setTimeout(() => {
        void this.sendRecordingMessage(
          session,
          `Recording in **${session.channelName}** has been running for ${this.recordingWarningMinutes} minutes and will stop automatically in ${this.recordingMaxMinutes - this.recordingWarningMinutes} minutes.`,
        );
      }, this.recordingWarningMinutes * 60_000);
    }

    session.autoStopTimer = setTimeout(() => {
      void this.autoStopRecording(session.guildId, session.sessionId);
    }, this.recordingMaxMinutes * 60_000);
  }

  private clearRecordingTimers(session: RecordingSession): void {
    if (session.warningTimer) {
      clearTimeout(session.warningTimer);
      session.warningTimer = undefined;
    }
    if (session.autoStopTimer) {
      clearTimeout(session.autoStopTimer);
      session.autoStopTimer = undefined;
    }
  }

  private async sendRecordingMessage(session: RecordingSession, content: string): Promise<void> {
    if (!session.announcementChannel?.isSendable()) {
      return;
    }
    await session.announcementChannel.send(content).catch((error) => {
      console.warn(`[discord-adapter] recording announcement failed session=${session.sessionId}: ${this.describeError(error)}`);
    });
  }

  private async autoStopRecording(guildId: string, sessionId: string): Promise<void> {
    if (this.recordingOperationsByGuild.has(guildId)) {
      console.warn(`[discord-adapter] skipped auto-stop while recording operation is active guild=${guildId} session=${sessionId}`);
      return;
    }
    this.recordingOperationsByGuild.set(guildId, "stopping");
    try {
    const session = this.sessionsByGuild.get(guildId);
    if (!session || session.sessionId !== sessionId) {
      return;
    }

    console.warn(`[discord-adapter] auto-stopping recording session=${session.sessionId} guild=${guildId} maxMinutes=${this.recordingMaxMinutes}`);
    await this.sendRecordingMessage(
      session,
      `Recording in **${session.channelName}** reached ${this.recordingMaxMinutes} minutes and is stopping automatically now.`,
    );

    try {
      const metadata = await this.finalizeSession(session);
      const publicMessage = metadata.artifacts?.transcriptMarkdownPath
        ? `Recording for **${session.channelName}** stopped automatically. Transcript was sent to Prism for synthesis.`
        : `Recording for **${session.channelName}** stopped automatically. Transcript was not generated.`;
      await this.sendRecordingMessage(session, publicMessage);
    } catch (error) {
      await this.sendRecordingMessage(
        session,
        `Recording for **${session.channelName}** stopped automatically, but finalization failed: ${this.describeError(error)}`,
      );
    }
    } finally {
      this.recordingOperationsByGuild.delete(guildId);
    }
  }

  private async beginSpeakerCapture(session: RecordingSession, userId: string, reason: "eager" | "speaking" = "speaking"): Promise<void> {
    const guildStreams = this.activeUserStreams.get(session.guildId) ?? new Map<string, ActiveAudioStream>();
    this.activeUserStreams.set(session.guildId, guildStreams);
    const existingStream = guildStreams.get(userId) ?? session.activeAudioStreams.get(userId);
    if (existingStream) {
      if (reason === "speaking") {
        const username = session.speakers.get(userId)?.username ?? session.participants.get(userId)?.username ?? userId;
        this.recordTimingEvent(session, "speaking.start", userId, username);
      }
      return;
    }
    const guild = await this.client.guilds.fetch(session.guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    const username = member?.displayName ?? member?.user.username ?? userId;
    if (member && !member.user.bot) {
      this.ensureParticipant(session, member);
    }
    const speaker = await this.ensureSpeakerStream(session, userId, username);
    if (reason === "speaking") {
      this.recordTimingEvent(session, "speaking.start", userId, username);
    }
    const connectionState = this.connections.get(session.guildId);
    if (!connectionState) {
      throw new Error(`No voice connection found for guild ${session.guildId}`);
    }

    console.log(`[discord-adapter] begin speaker capture session=${session.sessionId} user=${userId} name=${username}`);
    console.log(
      `[discord-adapter] receiver subscribe session=${session.sessionId} user=${userId} channel=${session.channelId} existingStreams=${guildStreams.size}`,
    );

    const opusStream = connectionState.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });
    const oggStream = new prism.opus.OggLogicalBitstream({
      opusHead: new prism.opus.OpusHead({
        channelCount: 2,
        sampleRate: 48_000,
      }),
      pageSizeControl: {
        maxPackets: 10,
      },
    });
    if (!speaker.stream) {
      throw new Error(`Recovered speaker stream cannot be reused for live capture: ${userId}`);
    }
    const pipelinePromise = (pipeline(opusStream as any, oggStream as any, speaker.stream) as Promise<void>).catch((error) => {
      console.warn(
        `[discord-adapter] speaker capture pipeline ended with error session=${session.sessionId} user=${userId}: ${this.describeError(error)}`,
      );
    });
    const activeStream: ActiveAudioStream = {
      userId,
      opusStream,
      oggStream,
      startedAt: Date.now(),
      receivedOpus: false,
      pipelinePromise,
    };
    session.activeAudioStreams.set(userId, activeStream);
    guildStreams.set(userId, activeStream);

    let loggedFirstOpusChunk = false;
    let opusChunkCount = 0;
    let opusBytes = 0;
    opusStream.on("data", (chunk: Buffer) => {
      activeStream.receivedOpus = true;
      opusChunkCount += 1;
      opusBytes += chunk.length;
      if (!loggedFirstOpusChunk) {
        loggedFirstOpusChunk = true;
        speaker.firstAudioAt = Date.now();
        this.recordTimingEvent(session, "audio.first_chunk", userId, username, speaker.firstAudioAt);
        console.log(
          `[discord-adapter] received first opus chunk session=${session.sessionId} user=${userId} bytes=${chunk.length}`,
        );
      }
      speaker.didSpeak = true;
      const participant = session.participants.get(userId);
      if (participant) {
        participant.didSpeak = true;
      }
    });

    const cleanup = (reason: string) => {
      const lifetimeMs = Date.now() - activeStream.startedAt;
      if (!speaker.endedAt) {
        speaker.endedAt = Date.now();
        this.recordTimingEvent(session, "stream.end", userId, username, speaker.endedAt);
      }
      console.log(
        `[discord-adapter] cleanup speaker stream session=${session.sessionId} user=${userId} reason=${reason} lifetimeMs=${lifetimeMs} opusChunks=${opusChunkCount} opusBytes=${opusBytes} receivedOpus=${activeStream.receivedOpus ? "true" : "false"}`,
      );
      session.activeAudioStreams.delete(userId);
      const streams = this.activeUserStreams.get(session.guildId);
      if (streams) {
        streams.delete(userId);
        if (streams.size === 0) {
          this.activeUserStreams.delete(session.guildId);
        }
      }
    };

    opusStream.on("error", (error: Error) => {
      console.error(`[discord-adapter] opus stream error for user ${userId}:`, error.message);
    });
    opusStream.on("end", () => cleanup("opus_end"));
    opusStream.on("close", () => cleanup("opus_close"));
    oggStream.on("end", () => cleanup("ogg_end"));
    oggStream.on("close", () => cleanup("ogg_close"));
    oggStream.on("error", (error: Error) => {
      console.error(`[discord-adapter] ogg stream error for user ${userId}:`, error.message);
      cleanup("ogg_error");
    });
  }

  private async ensureSpeakerStream(session: RecordingSession, userId: string, username: string): Promise<SpeakerStream> {
    const existing = session.speakers.get(userId);
    if (existing) {
      return existing;
    }
    const filename = `${userId}-${sanitizeFileSegment(username)}-${Date.now()}.ogg`;
    const rawPath = path.join(session.rawDir, filename);
    const stream = createWriteStream(rawPath);
    const speaker: SpeakerStream = {
      userId,
      username,
      filename,
      rawPath,
      stream,
      startedAt: Date.now(),
      didSpeak: false,
    };
    session.speakers.set(userId, speaker);
    this.recordTimingEvent(session, "stream.start", userId, username, speaker.startedAt);
    return speaker;
  }

  private async recoverLatestSessionFromDisk(guildId: string, channelId: string): Promise<RecordingSession | null> {
    const entries = await fs.readdir(this.recordingsRoot, { withFileTypes: true }).catch(() => []);
    const candidates: Array<{ session: PersistedRecordingSession; rootDir: string }> = [];
    const now = Date.now();
    const maxAgeMs = this.recoveryMaxAgeHours * 60 * 60 * 1000;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const rootDir = path.join(this.recordingsRoot, entry.name);
      const metadataPath = path.join(rootDir, "metadata.json");
      if (await fileExists(metadataPath)) {
        continue;
      }
      const sessionPath = path.join(rootDir, "session.json");
      const raw = await fs.readFile(sessionPath, "utf8").catch(() => null);
      if (!raw) {
        continue;
      }
      try {
        const session = JSON.parse(raw) as PersistedRecordingSession;
        if (session.guildId !== guildId || session.channelId !== channelId || !session.sessionId || !session.startedAt) {
          continue;
        }
        const startedAt = parseIsoDate(session.startedAt).getTime();
        if (maxAgeMs > 0 && now - startedAt > maxAgeMs) {
          console.warn(
            `[discord-adapter] skipped stale recording recovery session=${session.sessionId} channel=${session.channelId} ageHours=${((now - startedAt) / 3_600_000).toFixed(2)} maxAgeHours=${this.recoveryMaxAgeHours}`,
          );
          continue;
        }
        if (session.guildId === guildId && session.sessionId && session.channelId && session.startedAt) {
          candidates.push({ session, rootDir });
        }
      } catch (error) {
        console.warn(`[discord-adapter] skipped corrupt recording session file ${sessionPath}: ${this.describeError(error)}`);
      }
    }

    candidates.sort((left, right) => parseIsoDate(right.session.startedAt).getTime() - parseIsoDate(left.session.startedAt).getTime());
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    return this.buildRecoveredSession(candidate.session, candidate.rootDir);
  }

  private async recoverSessionFromDisk(sessionId: string): Promise<RecordingSession | null> {
    const safeSessionId = path.basename(sessionId);
    if (safeSessionId !== sessionId) {
      throw new Error("Invalid recording session id");
    }
    const rootDir = path.join(this.recordingsRoot, safeSessionId);
    const metadataPath = path.join(rootDir, "metadata.json");
    if (await fileExists(metadataPath)) {
      return null;
    }
    const raw = await fs.readFile(path.join(rootDir, "session.json"), "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as PersistedRecordingSession;
    if (session.sessionId !== safeSessionId) {
      throw new Error(`Recording session id mismatch in ${safeSessionId}`);
    }
    return this.buildRecoveredSession(session, rootDir);
  }

  private async buildRecoveredSession(candidate: PersistedRecordingSession, rootDir: string): Promise<RecordingSession> {
    const rawDir = path.join(rootDir, "raw");
    const flacDir = path.join(rootDir, "flac");
    const transcriptDir = path.join(rootDir, "transcript");
    await fs.mkdir(flacDir, { recursive: true });
    await fs.mkdir(transcriptDir, { recursive: true });

    const session: RecordingSession = {
      sessionId: candidate.sessionId,
      guildId: candidate.guildId,
      channelId: candidate.channelId,
      channelName: candidate.channelName,
      scheduledEventId: candidate.scheduledEventId ?? null,
      scheduledEvent: candidate.scheduledEvent ?? null,
      announcementChannel: null,
      startedAt: parseIsoDate(candidate.startedAt).getTime(),
      rootDir,
      rawDir,
      flacDir,
      transcriptDir,
      participants: new Map(),
      speakers: new Map(),
      timingEvents: candidate.timingEvents ?? [],
      activeAudioStreams: new Map(),
      speakingHandler: (_userId: string) => {},
      speakingEndHandler: (_userId: string) => {},
      connectionSpeakingHandler: (_userId: string, _speaking: boolean) => {},
      recoveredFromDisk: true,
    };

    for (const participant of candidate.participants ?? []) {
      session.participants.set(participant.userId, {
        userId: participant.userId,
        username: participant.username,
        joinedAt: participant.joinedAt ? parseIsoDate(participant.joinedAt).getTime() : session.startedAt,
        leftAt: participant.leftAt ? parseIsoDate(participant.leftAt).getTime() : undefined,
        didSpeak: Boolean(participant.didSpeak),
      });
    }

    const rawFiles = (await fs.readdir(rawDir).catch(() => [])).filter((name) => name.endsWith(".ogg")).sort();
    for (const filename of rawFiles) {
      const rawPath = path.join(rawDir, filename);
      const stat = await fs.stat(rawPath).catch(() => null);
      if (!stat || stat.size === 0) {
        continue;
      }
      const parsed = this.parseRawSpeakerFileName(filename);
      const userId = parsed.userId;
      const username = parsed.username || userId;
      const startedAt = parsed.startedAt ?? session.startedAt;
      const didSpeak = stat.size >= 1024;
      session.speakers.set(userId, {
        userId,
        username,
        filename,
        rawPath,
        startedAt,
        didSpeak,
      });
      const existingParticipant = session.participants.get(userId);
      if (existingParticipant) {
        existingParticipant.didSpeak = existingParticipant.didSpeak || didSpeak;
      } else {
        session.participants.set(userId, {
          userId,
          username,
          joinedAt: session.startedAt,
          didSpeak,
        });
      }
    }

    console.warn(
      `[discord-adapter] recovered unfinished recording session=${session.sessionId} guild=${session.guildId} speakers=${session.speakers.size} participants=${session.participants.size}`,
    );
    return session;
  }

  async recoverRecordingSession(sessionId: string): Promise<RecordingSessionMetadata> {
    for (const session of this.sessionsByGuild.values()) {
      if (session.sessionId === sessionId) {
        return this.finalizeSession(session);
      }
    }
    const metadataPath = path.join(this.recordingsRoot, path.basename(sessionId), "metadata.json");
    const existing = await fs.readFile(metadataPath, "utf8").catch(() => null);
    if (existing) {
      const metadata = JSON.parse(existing) as RecordingSessionMetadata;
      return this.recoverPrismMemoryArtifacts(metadata, metadataPath);
    }
    const session = await this.recoverSessionFromDisk(sessionId);
    if (!session) {
      throw new Error(`Recording session not recoverable: ${sessionId}`);
    }
    return this.finalizeSession(session);
  }

  private async recoverPrismMemoryArtifacts(
    metadata: RecordingSessionMetadata,
    metadataPath: string,
  ): Promise<RecordingSessionMetadata> {
    if (metadata.artifacts?.prismMemoryTranscriptPath || metadata.artifacts?.prismMemorySummaryPath) {
      return metadata;
    }
    const transcriptArtifacts = await this.loadPersistedTranscriptArtifacts(metadata);
    const summary = await this.loadPersistedSummary(metadata);
    const memoryIngest = await this.ingestArtifactsToPrismMemory(metadata, transcriptArtifacts, summary, {
      ingestTranscript: this.recordingTranscriptMemoryIngestEnabled(),
      ingestSummary: this.recordingSummaryMemoryIngestEnabled(),
    });
    metadata.artifacts = {
      ...(metadata.artifacts ?? {}),
      prismMemoryTranscriptPath: memoryIngest.transcriptPath ?? undefined,
      prismMemorySummaryPath: memoryIngest.summaryPath ?? undefined,
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    console.log(
      `[discord-adapter] recovered prism memory artifacts session=${metadata.sessionId} transcript=${metadata.artifacts.prismMemoryTranscriptPath ?? "none"} summary=${metadata.artifacts.prismMemorySummaryPath ?? "none"}`,
    );
    return metadata;
  }

  private async loadPersistedTranscriptArtifacts(metadata: RecordingSessionMetadata): Promise<SessionTranscriptArtifacts | null> {
    const transcriptJsonPath = metadata.artifacts?.transcriptJsonPath;
    if (!transcriptJsonPath) {
      return null;
    }
    const raw = await fs.readFile(transcriptJsonPath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionTranscriptArtifacts;
  }

  private async loadPersistedSummary(metadata: RecordingSessionMetadata): Promise<SessionSummary | null> {
    const summaryJsonPath = metadata.artifacts?.summaryJsonPath;
    if (!summaryJsonPath) {
      return null;
    }
    const raw = await fs.readFile(summaryJsonPath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionSummary;
  }

  private parseRawSpeakerFileName(filename: string): { userId: string; username: string; startedAt?: number } {
    const base = filename.replace(/\.ogg$/i, "");
    const parts = base.split("-");
    const userId = parts.shift() || "unknown";
    const maybeTimestamp = parts[parts.length - 1];
    const startedAt = maybeTimestamp && /^\d+$/.test(maybeTimestamp) ? Number.parseInt(maybeTimestamp, 10) : undefined;
    if (startedAt) {
      parts.pop();
    }
    return {
      userId,
      username: parts.join("-") || userId,
      startedAt,
    };
  }

  async stopRecording(interaction: ChatInputCommandInteraction): Promise<StopRecordingResult> {
    if (!interaction.guildId) {
      throw new Error("This command must be used inside a Discord server.");
    }
    const { channel } = await this.resolveMemberVoiceChannel(interaction);
    const activeOperation = this.recordingOperationsByGuild.get(interaction.guildId);
    if (activeOperation) {
      throw new Error(`A recording is currently ${activeOperation} for this server. Try again after that operation finishes.`);
    }
    this.recordingOperationsByGuild.set(interaction.guildId, "stopping");
    try {
    const activeSession = this.sessionsByGuild.get(interaction.guildId);
    if (activeSession && activeSession.channelId !== channel.id) {
      throw new Error(`An active recording is running in **${activeSession.channelName}**. Join that channel to stop it.`);
    }
    const session = activeSession ?? (await this.recoverLatestSessionFromDisk(interaction.guildId, channel.id));
    if (!session) {
      throw new Error(`No active recording session found for **${channel.name}**. \`/prism-join\` only connects the bot; use \`/prism-record\` to start recording.`);
    }
    console.log(
      `[discord-adapter] stop recording requested session=${session.sessionId} activeStreams=${session.activeAudioStreams.size} trackedParticipants=${session.participants.size}`,
    );
    const metadata = await this.finalizeSession(session);
    const privateMessage = [
      `Recording stopped for **${session.channelName}**.`,
      `Session: \`${metadata.sessionId}\``,
      session.recoveredFromDisk ? "Recovered unfinished session from the recording volume after adapter restart." : null,
      `Participants: ${metadata.participants.length}`,
      `Speakers with audio: ${metadata.speakers.length}`,
      metadata.artifacts?.transcriptMarkdownPath
        ? `Transcript written locally: \`${metadata.artifacts.transcriptMarkdownPath}\``
        : "Transcript not generated.",
      this.recordingCompleteHookEnabled() && this.recordingCompleteHookKey()
        ? `Prism workflow handoff attempted via hook \`${this.recordingCompleteHookKey()}\`.`
        : "Prism workflow handoff disabled.",
      this.recordingSummaryEnabled() && metadata.artifacts?.summaryMarkdownPath
        ? `Summary written locally: \`${metadata.artifacts.summaryMarkdownPath}\``
        : null,
      process.env.N8N_WEBHOOK_URL ? "Legacy n8n webhook handoff attempted." : null,
    ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
    const publicMessage = metadata.artifacts?.transcriptMarkdownPath
      ? `Recording for **${session.channelName}** is transcribed and queued for Prism synthesis.`
      : null;
    return {
      privateMessage,
      publicMessage,
    };
    } finally {
      this.recordingOperationsByGuild.delete(interaction.guildId);
    }
  }

  async finalizeSession(session: RecordingSession): Promise<RecordingSessionMetadata> {
    this.clearRecordingTimers(session);
    this.sessionsByGuild.delete(session.guildId);
    const endedAt = Date.now();
    const connectionState = this.connections.get(session.guildId);
    if (connectionState) {
      if (typeof (connectionState.connection as any).off === "function") {
        (connectionState.connection as any).off("speaking", session.connectionSpeakingHandler);
      }
    }

    for (const active of session.activeAudioStreams.values()) {
      if ("destroy" in active.opusStream && typeof active.opusStream.destroy === "function") {
        active.opusStream.destroy();
      }
      if ("destroy" in active.oggStream && typeof active.oggStream.destroy === "function") {
        active.oggStream.destroy();
      }
    }
    await Promise.allSettled([...session.activeAudioStreams.values()].map((active) => active.pipelinePromise));
    session.activeAudioStreams.clear();
    this.activeUserStreams.delete(session.guildId);

    await Promise.all(
      [...session.speakers.values()].map(
        (speaker) =>
          new Promise<void>((resolve) => {
            if (!speaker.stream) {
              resolve();
              return;
            }
            speaker.stream.end(() => resolve());
          }),
      ),
    );

    const speakers: SpeakerMetadata[] = [];
    for (const speaker of session.speakers.values()) {
      const chunks = await this.transcodeSpeaker(session, speaker, endedAt);
      speakers.push({
        userId: speaker.userId,
        username: speaker.username,
        duration: Math.max(0, endedAt - speaker.startedAt),
        startedAt: isoTimestamp(speaker.startedAt),
        firstAudioAt: speaker.firstAudioAt ? isoTimestamp(speaker.firstAudioAt) : undefined,
        endedAt: isoTimestamp(speaker.endedAt ?? endedAt),
        audioUrl: chunks[0]?.audioUrl ?? null,
        chunks,
        rawPath: speaker.rawPath,
      });
    }

    const participants = [...session.participants.values()].map((participant) => ({
      ...participant,
      leftAt: participant.leftAt ?? endedAt,
    }));
    for (const participant of participants) {
      session.participants.set(participant.userId, participant);
    }
    await this.persistSession(session);

    console.log(
      `[discord-adapter] finalize session=${session.sessionId} speakersTracked=${session.speakers.size} participantSnapshot=${JSON.stringify(
        participants.map((participant) => ({
          userId: participant.userId,
          username: participant.username,
          didSpeak: participant.didSpeak,
          joinedAt: participant.joinedAt,
          leftAt: participant.leftAt,
        })),
      )}`,
    );

    const metadata = this.buildWebhookPayload(session, speakers, participants, endedAt);
    const transcriptArtifacts = await this.buildTranscriptArtifacts(session, metadata);
    let summary: SessionSummary | null = null;
    if (this.recordingSummaryEnabled()) {
      try {
        summary = await this.buildSummaryArtifacts(session, metadata, transcriptArtifacts);
      } catch (error) {
        console.warn(
          `[discord-adapter] summary generation skipped session=${session.sessionId}: ${this.describeError(error)}`,
        );
      }
    }
    let memoryIngest: { transcriptPath: string | null; summaryPath: string | null } = {
      transcriptPath: null,
      summaryPath: null,
    };
    if (this.recordingSummaryMemoryIngestEnabled() || this.recordingTranscriptMemoryIngestEnabled()) {
      try {
        memoryIngest = await this.ingestArtifactsToPrismMemory(metadata, transcriptArtifacts, summary, {
          ingestTranscript: this.recordingTranscriptMemoryIngestEnabled(),
          ingestSummary: this.recordingSummaryMemoryIngestEnabled(),
        });
      } catch (error) {
        console.warn(
          `[discord-adapter] prism memory ingest skipped session=${session.sessionId}: ${this.describeError(error)}`,
        );
      }
    }
    metadata.artifacts = {
      transcriptJsonPath: transcriptArtifacts?.transcriptJsonPath,
      transcriptMarkdownPath: transcriptArtifacts?.transcriptMarkdownPath,
      summaryJsonPath: summary?.summaryJsonPath,
      summaryMarkdownPath: summary?.summaryMarkdownPath,
      prismMemoryTranscriptPath: memoryIngest.transcriptPath ?? undefined,
      prismMemorySummaryPath: memoryIngest.summaryPath ?? undefined,
    };
    console.log(
      `[discord-adapter] finalized session=${session.sessionId} speakerArtifacts=${JSON.stringify(
        metadata.speakers.map((speaker) => ({
          userId: speaker.userId,
          username: speaker.username,
          chunkCount: speaker.chunks.length,
          rawPath: speaker.rawPath,
        })),
      )} artifacts=${JSON.stringify(metadata.artifacts ?? {})}`,
    );
    await fs.writeFile(path.join(session.rootDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    try {
      await this.triggerRecordingCompleteHook(metadata, summary);
    } catch (error) {
      console.warn(`[discord-adapter] recording complete hook skipped after unexpected error session=${session.sessionId}: ${this.describeError(error)}`);
    }
    await this.sendWebhook(metadata);

    if (connectionState) {
      connectionState.connection.destroy();
      this.connections.delete(session.guildId);
    }
    return metadata;
  }

  async rollcall(interaction: ChatInputCommandInteraction): Promise<string> {
    const active = interaction.guildId ? this.sessionsByGuild.get(interaction.guildId) : null;
    if (active) {
      const lines = [...active.participants.values()]
        .map((participant) => `- ${participant.username}${participant.didSpeak ? " (spoke)" : ""}`)
        .sort((left, right) => left.localeCompare(right));
      return [
        `Recording session: \`${active.sessionId}\``,
        `Voice channel: **${active.channelName}**`,
        `Participants: ${lines.length}`,
        lines.length > 0 ? lines.join("\n") : "- none",
      ].join("\n");
    }

    const { channel } = await this.resolveMemberVoiceChannel(interaction);
    const members = [...channel.members.values()]
      .filter((member) => !member.user.bot)
      .map((member) => `- ${member.displayName}`)
      .sort((left, right) => left.localeCompare(right));
    return [
      `Voice channel: **${channel.name}**`,
      `Participants: ${members.length}`,
      members.length > 0 ? members.join("\n") : "- none",
    ].join("\n");
  }

  async recap(interaction: ChatInputCommandInteraction, steering?: string | null): Promise<string> {
    if (!interaction.guildId) {
      throw new Error("This command must be used inside a Discord server.");
    }
    if (this.recapOperationsByGuild.has(interaction.guildId)) {
      throw new Error("A meeting recap is already running for this server.");
    }
    const { channel } = await this.resolveMemberVoiceChannel(interaction);
    const session = this.sessionsByGuild.get(interaction.guildId);
    if (!session) {
      throw new Error(`No active recording session found for **${channel.name}**. Use \`/prism-record\` first.`);
    }
    if (session.channelId !== channel.id) {
      throw new Error(`An active recording is running in **${session.channelName}**. Join that channel to request a recap.`);
    }

    this.recapOperationsByGuild.add(interaction.guildId);
    try {
      const transcript = await this.buildLiveRecapTranscript(session);
      if (!transcript.mergedTranscript.trim()) {
        throw new Error("No transcript text is available yet. Wait for people to speak, then try `/prism-recap` again.");
      }
      const recap = await this.buildLiveRecap(session, transcript, steering?.trim() || null);
      return this.renderLiveRecapResponse(session, recap, transcript);
    } finally {
      this.recapOperationsByGuild.delete(interaction.guildId);
    }
  }

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const session = this.sessionsByGuild.get(newState.guild.id) ?? this.sessionsByGuild.get(oldState.guild.id);
    if (!session) {
      return;
    }
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) {
      return;
    }

    if (newState.channelId === session.channelId) {
      console.log(
        `[discord-adapter] voice state update session=${session.sessionId} user=${member.user.id} joinedOrPresent channel=${session.channelId}`,
      );
      this.ensureParticipant(session, member);
      return;
    }

    if (oldState.channelId === session.channelId && newState.channelId !== session.channelId) {
      console.log(
        `[discord-adapter] voice state update session=${session.sessionId} user=${member.user.id} left channel=${session.channelId} next=${newState.channelId ?? "none"}`,
      );
      const participant = session.participants.get(member.user.id);
      if (participant) {
        participant.leftAt = Date.now();
      }
    }
  }

  private async transcodeSpeaker(session: RecordingSession, speaker: SpeakerStream, endedAt: number): Promise<VoiceChunkMetadata[]> {
    const stat = await fs.stat(speaker.rawPath).catch(() => null);
    if (!stat || stat.size < 1024) {
      console.log(
        `[discord-adapter] skipping transcode session=${session.sessionId} user=${speaker.userId} path=${speaker.rawPath} size=${stat?.size ?? 0}`,
      );
      return [];
    }
    const outputPattern = path.join(session.flacDir, `${speaker.userId}-${sanitizeFileSegment(speaker.username)}-chunk_%03d.flac`);
    await this.runFfmpeg(speaker.rawPath, outputPattern);
    const files = (await fs.readdir(session.flacDir))
      .filter((name) => name.startsWith(`${speaker.userId}-${sanitizeFileSegment(speaker.username)}-chunk_`) && name.endsWith(".flac"))
      .sort();
    const totalDuration = Math.max(0, endedAt - speaker.startedAt);
    const audioAnchor = speaker.firstAudioAt ?? speaker.startedAt;
    const base = this.publicBaseUrl();
    const chunks: VoiceChunkMetadata[] = [];
    for (const [index, fileName] of files.entries()) {
      const filePath = path.join(session.flacDir, fileName);
      const fileStat = await fs.stat(filePath);
      const startMs = Math.min(totalDuration, index * this.ffmpegSegmentSeconds * 1000);
      const endMs = Math.min(totalDuration, (index + 1) * this.ffmpegSegmentSeconds * 1000);
      const chunkStartedAt = audioAnchor + startMs;
      const chunkEndedAt = audioAnchor + endMs;
      chunks.push({
        audioUrl: base ? `${base}/recordings/${session.sessionId}/${encodeURIComponent(fileName)}` : null,
        index,
        startMs,
        endMs,
        startedAt: isoTimestamp(chunkStartedAt),
        endedAt: isoTimestamp(chunkEndedAt),
        byteStart: 0,
        byteEnd: fileStat.size,
        fileName,
        contentType: "audio/flac",
      });
    }
    return chunks;
  }

  private runFfmpeg(inputPath: string, outputPattern: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        inputPath,
        "-f",
        "segment",
        "-segment_time",
        String(this.ffmpegSegmentSeconds),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "flac",
        outputPattern,
      ];
      const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-400)}`));
      });
      ffmpeg.on("error", reject);
    });
  }

  private buildWebhookPayload(
    session: RecordingSession,
    speakers: SpeakerMetadata[],
    participants: ParticipantPresence[],
    endedAt: number,
  ): RecordingSessionMetadata {
    const attendeeIds = [...new Set(participants.map((participant) => participant.userId))];
    return {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt,
      channelId: session.channelId,
      guildId: session.guildId,
      scheduledEventId: session.scheduledEventId ?? null,
      scheduledEvent: session.scheduledEvent ?? null,
      speakers,
      participants,
      timingEvents: session.timingEvents,
      metadata: {
        meeting: {
          name: session.channelName,
          platform: "discord",
          channel_id: session.channelId,
          attendee_ids: attendeeIds,
          attendee_count: attendeeIds.length,
          location: `Discord #${session.channelName}`,
          timezone: process.env.MEETING_TIMEZONE || process.env.TZ || "UTC",
        },
        sys: {
          event_name: "meeting.held",
          time_window: {
            start: new Date(session.startedAt).toISOString(),
            end: new Date(endedAt).toISOString(),
          },
        },
      },
      source: {
        service: "source-adapter",
        transport: "discord",
        storage: "local-volume",
        recordingBaseUrl: this.publicBaseUrl(),
        authHeader: "X-Adapter-Token",
      },
    };
  }

  private async buildTranscriptArtifacts(
    session: RecordingSession,
    metadata: RecordingSessionMetadata,
  ): Promise<SessionTranscriptArtifacts | null> {
    const chatMessages = await this.fetchVoiceChannelChatSegments(session, metadata.endedAt);
    const speakerTranscripts: SpeakerTranscript[] = [];
    const skippedChunks: SkippedTranscriptionChunk[] = [];

    if (this.voiceTranscriptionApiKey()) {
      for (const speaker of metadata.speakers) {
        const segments: TranscriptionSegment[] = [];
        for (const chunk of speaker.chunks) {
          const chunkPath = path.join(session.flacDir, chunk.fileName);
          const chunkStat = await fs.stat(chunkPath).catch(() => null);
          if (!chunkStat || chunkStat.size < MIN_TRANSCRIBABLE_AUDIO_BYTES) {
            const reason = chunkStat ? `audio chunk too small (${chunkStat.size} bytes)` : "audio chunk missing";
            skippedChunks.push({
              speaker: speaker.username,
              speakerId: speaker.userId,
              chunkIndex: chunk.index,
              fileName: chunk.fileName,
              reason,
            });
            console.warn(
              `[discord-adapter] skipped voice transcription chunk session=${session.sessionId} user=${speaker.userId} chunk=${chunk.fileName}: ${reason}`,
            );
            continue;
          }
          let result: VoiceTranscriptionResponse;
          try {
            result = await this.transcribeChunk(chunkPath);
          } catch (error) {
            if (!this.isSkippableTranscriptionError(error)) {
              throw error;
            }
            const reason = this.describeError(error);
            skippedChunks.push({
              speaker: speaker.username,
              speakerId: speaker.userId,
              chunkIndex: chunk.index,
              fileName: chunk.fileName,
              reason,
            });
            console.warn(
              `[discord-adapter] skipped voice transcription chunk session=${session.sessionId} user=${speaker.userId} chunk=${chunk.fileName}: ${reason}`,
            );
            continue;
          }
          const offsetSeconds = chunk.startedAt
            ? voiceOffsetSeconds(chunk.startedAt, session.startedAt)
            : voiceOffsetSeconds(speaker.firstAudioAt ?? speaker.startedAt, session.startedAt) + (chunk.startMs ?? 0) / 1000;
          const chunkSegments = (result.timestamps?.segment ?? [])
            .map((segment) => ({
              text: String(segment.text ?? "").trim(),
              start: Number(segment.start ?? 0) + offsetSeconds,
              end: Number(segment.end ?? 0) + offsetSeconds,
              speaker: speaker.username,
              speakerId: speaker.userId,
              chunkIndex: chunk.index,
              source: "voice" as const,
            }))
            .filter((segment) => segment.text);
          if (chunkSegments.length === 0) {
            const fallbackText = String(result.text ?? "").trim();
            if (fallbackText) {
              chunkSegments.push({
                text: fallbackText,
                start: offsetSeconds,
                end: offsetSeconds + Math.max(1, Number(result.duration ?? 0)),
                speaker: speaker.username,
                speakerId: speaker.userId,
                chunkIndex: chunk.index,
                source: "voice",
              });
            }
          }
          segments.push(...chunkSegments);
        }
        segments.sort((left, right) => left.start - right.start);
        speakerTranscripts.push({
          userId: speaker.userId,
          username: speaker.username,
          text: segments.map((segment) => segment.text).join(" ").trim(),
          segments,
        });
      }
    } else if (metadata.speakers.length > 0) {
      console.warn(`[discord-adapter] voice transcription skipped session=${session.sessionId}: VOICE_TRANSCRIPTION_API_KEY is not configured`);
    }

    if (speakerTranscripts.length === 0 && chatMessages.length === 0) {
      return null;
    }

    const mergedSegments = [...speakerTranscripts.flatMap((speaker) => speaker.segments), ...chatMessages].sort((left, right) =>
      left.start === right.start ? left.speaker.localeCompare(right.speaker) : left.start - right.start,
    );
    const mergedTranscript = mergedSegments
      .map((segment) => {
        const sourceLabel = segment.source === "chat" ? " chat" : "";
        const suffix = segment.jumpUrl ? ` (${segment.jumpUrl})` : "";
        return `[${this.formatTimeSec(segment.start)}] [${segment.speaker}${sourceLabel}]: ${segment.text}${suffix}`;
      })
      .join("\n");

    const transcriptPayload = {
      sessionId: metadata.sessionId,
      guildId: metadata.guildId,
      channelId: metadata.channelId,
      startedAt: metadata.startedAt,
      endedAt: metadata.endedAt,
      timingEvents: metadata.timingEvents ?? [],
      speakerTranscripts,
      chatMessages,
      mergedSegments,
      mergedTranscript,
      skippedChunks,
    };

    const transcriptJsonPath = path.join(session.transcriptDir, "transcript.json");
    const transcriptMarkdownPath = path.join(session.transcriptDir, "transcript.md");
    const skippedChunkLines =
      skippedChunks.length > 0
        ? [
            "## Skipped Audio Chunks",
            "",
            ...skippedChunks.map((chunk) => `- ${chunk.speaker} chunk ${chunk.chunkIndex} (${chunk.fileName}): ${chunk.reason}`),
            "",
          ]
        : [];
    await fs.writeFile(transcriptJsonPath, `${JSON.stringify(transcriptPayload, null, 2)}\n`, "utf8");
    await fs.writeFile(
      transcriptMarkdownPath,
      [
        `# ${metadata.metadata.meeting.name || "Discord Meeting Transcript"}`,
        "",
        `- Session: \`${metadata.sessionId}\``,
        `- Guild: \`${metadata.guildId}\``,
        `- Channel: \`${metadata.channelId}\``,
        `- Started: ${new Date(metadata.startedAt).toISOString()}`,
        `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
        "",
        ...skippedChunkLines,
        mergedTranscript || "_No transcript content generated._",
        "",
      ].join("\n"),
      "utf8",
    );

    return {
      speakerTranscripts,
      chatMessages,
      mergedSegments,
      mergedTranscript,
      transcriptJsonPath,
      transcriptMarkdownPath,
      skippedChunks,
    };
  }

  private async buildLiveRecapTranscript(session: RecordingSession): Promise<SessionTranscriptArtifacts> {
    if (!this.voiceTranscriptionApiKey()) {
      throw new Error("VOICE_TRANSCRIPTION_API_KEY is required for meeting recaps");
    }

    const now = Date.now();
    const recapDir = path.join(session.rootDir, "recaps", new Date(now).toISOString().replace(/[:.]/g, "-"));
    const audioDir = path.join(recapDir, "audio");
    await fs.mkdir(audioDir, { recursive: true });

    const speakerTranscripts: SpeakerTranscript[] = [];
    const skippedChunks: SkippedTranscriptionChunk[] = [];

    for (const speaker of session.speakers.values()) {
      const rawStat = await fs.stat(speaker.rawPath).catch(() => null);
      if (!rawStat || rawStat.size < MIN_TRANSCRIBABLE_AUDIO_BYTES) {
        skippedChunks.push({
          speaker: speaker.username,
          speakerId: speaker.userId,
          chunkIndex: 0,
          fileName: path.basename(speaker.rawPath),
          reason: rawStat ? `audio too small (${rawStat.size} bytes)` : "audio missing",
        });
        continue;
      }

      const snapshotPath = path.join(audioDir, `${speaker.userId}-${sanitizeFileSegment(speaker.username)}-snapshot.ogg`);
      await fs.copyFile(speaker.rawPath, snapshotPath);
      const outputPattern = path.join(audioDir, `${speaker.userId}-${sanitizeFileSegment(speaker.username)}-chunk_%03d.flac`);
      try {
        await this.runFfmpeg(snapshotPath, outputPattern);
      } catch (error) {
        skippedChunks.push({
          speaker: speaker.username,
          speakerId: speaker.userId,
          chunkIndex: 0,
          fileName: path.basename(snapshotPath),
          reason: this.describeError(error),
        });
        continue;
      }

      const files = (await fs.readdir(audioDir))
        .filter((name) => name.startsWith(`${speaker.userId}-${sanitizeFileSegment(speaker.username)}-chunk_`) && name.endsWith(".flac"))
        .sort();
      const segments: TranscriptionSegment[] = [];
      for (const [index, fileName] of files.entries()) {
        const chunkPath = path.join(audioDir, fileName);
        const chunkStat = await fs.stat(chunkPath).catch(() => null);
        if (!chunkStat || chunkStat.size < MIN_TRANSCRIBABLE_AUDIO_BYTES) {
          skippedChunks.push({
            speaker: speaker.username,
            speakerId: speaker.userId,
            chunkIndex: index,
            fileName,
            reason: chunkStat ? `audio chunk too small (${chunkStat.size} bytes)` : "audio chunk missing",
          });
          continue;
        }

        let result: VoiceTranscriptionResponse;
        try {
          result = await this.transcribeChunk(chunkPath);
        } catch (error) {
          if (!this.isSkippableTranscriptionError(error)) {
            throw error;
          }
          skippedChunks.push({
            speaker: speaker.username,
            speakerId: speaker.userId,
            chunkIndex: index,
            fileName,
            reason: this.describeError(error),
          });
          continue;
        }

        const offsetSeconds = voiceOffsetSeconds(isoTimestamp(speaker.firstAudioAt ?? speaker.startedAt), session.startedAt)
          + index * this.ffmpegSegmentSeconds;
        const chunkSegments = (result.timestamps?.segment ?? [])
          .map((segment) => ({
            text: String(segment.text ?? "").trim(),
            start: Number(segment.start ?? 0) + offsetSeconds,
            end: Number(segment.end ?? 0) + offsetSeconds,
            speaker: speaker.username,
            speakerId: speaker.userId,
            chunkIndex: index,
            source: "voice" as const,
          }))
          .filter((segment) => segment.text);
        if (chunkSegments.length === 0) {
          const fallbackText = String(result.text ?? "").trim();
          if (fallbackText) {
            chunkSegments.push({
              text: fallbackText,
              start: offsetSeconds,
              end: offsetSeconds + Math.max(1, Number(result.duration ?? 0)),
              speaker: speaker.username,
              speakerId: speaker.userId,
              chunkIndex: index,
              source: "voice",
            });
          }
        }
        segments.push(...chunkSegments);
      }

      segments.sort((left, right) => left.start - right.start);
      if (segments.length > 0) {
        speakerTranscripts.push({
          userId: speaker.userId,
          username: speaker.username,
          text: segments.map((segment) => segment.text).join(" ").trim(),
          segments,
        });
      }
    }

    const chatMessages = await this.fetchVoiceChannelChatSegments(session, now);
    const mergedSegments = [...speakerTranscripts.flatMap((speaker) => speaker.segments), ...chatMessages].sort((left, right) =>
      left.start === right.start ? left.speaker.localeCompare(right.speaker) : left.start - right.start,
    );
    const mergedTranscript = mergedSegments
      .map((segment) => {
        const sourceLabel = segment.source === "chat" ? " chat" : "";
        const suffix = segment.jumpUrl ? ` (${segment.jumpUrl})` : "";
        return `[${this.formatTimeSec(segment.start)}] [${segment.speaker}${sourceLabel}]: ${segment.text}${suffix}`;
      })
      .join("\n");

    const transcriptJsonPath = path.join(recapDir, "transcript.json");
    const transcriptMarkdownPath = path.join(recapDir, "transcript.md");
    await fs.writeFile(
      transcriptJsonPath,
      `${JSON.stringify({
        sessionId: session.sessionId,
        guildId: session.guildId,
        channelId: session.channelId,
        generatedAt: new Date(now).toISOString(),
        speakerTranscripts,
        chatMessages,
        mergedSegments,
        mergedTranscript,
        skippedChunks,
      }, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      transcriptMarkdownPath,
      [
        `# ${session.channelName} Live Recap Transcript`,
        "",
        `- Session: \`${session.sessionId}\``,
        `- Generated: ${new Date(now).toISOString()}`,
        "",
        mergedTranscript || "_No transcript content generated._",
        "",
      ].join("\n"),
      "utf8",
    );

    return {
      speakerTranscripts,
      chatMessages,
      mergedSegments,
      mergedTranscript,
      transcriptJsonPath,
      transcriptMarkdownPath,
      skippedChunks,
    };
  }

  private async fetchVoiceChannelChatSegments(session: RecordingSession, endedAt: number): Promise<TranscriptionSegment[]> {
    try {
      const messages = await this.fetchDiscordMessages(session.channelId, new Date(session.startedAt), new Date(endedAt), this.voiceChatMaxMessages);
      const segments: TranscriptionSegment[] = [];
      for (const message of messages) {
        const timestampRaw = typeof message.timestamp === "string" ? message.timestamp : null;
        if (!timestampRaw) {
          continue;
        }
        const timestamp = parseIsoDate(timestampRaw);
        const author = message.author && typeof message.author === "object" && !Array.isArray(message.author) ? (message.author as JsonObject) : {};
        if (Boolean(author.bot) && this.ignoreVoiceChatBotMessages()) {
          continue;
        }
        const text = this.renderDiscordChatMessage(message);
        if (!text) {
          continue;
        }
        const messageId = typeof message.id === "string" ? message.id : undefined;
        segments.push({
          text,
          start: Math.max(0, (timestamp.getTime() - session.startedAt) / 1000),
          end: Math.max(0, (timestamp.getTime() - session.startedAt) / 1000),
          speaker: this.discordAuthorName(author),
          speakerId: typeof author.id === "string" ? author.id : "unknown",
          source: "chat",
          messageId,
          jumpUrl: messageId ? `https://discord.com/channels/${session.guildId}/${session.channelId}/${messageId}` : undefined,
          timestamp: timestamp.toISOString(),
        });
      }
      console.log(`[discord-adapter] voice chat transcript messages session=${session.sessionId} count=${segments.length}`);
      return segments.sort((left, right) => left.start - right.start);
    } catch (error) {
      console.warn(`[discord-adapter] voice chat transcript skipped session=${session.sessionId}: ${this.describeError(error)}`);
      return [];
    }
  }

  private async fetchDiscordMessages(channelId: string, since: Date, until: Date, maxMessages: number): Promise<JsonObject[]> {
    const collected: JsonObject[] = [];
    let before: string | undefined;
    while (collected.length < maxMessages) {
      const batch = await this.discordApiRequest<JsonObject[]>(`/channels/${channelId}/messages`, {
        limit: Math.min(100, maxMessages - collected.length),
        before,
      });
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }
      let stop = false;
      for (const candidate of batch) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          continue;
        }
        const timestampRaw = typeof candidate.timestamp === "string" ? candidate.timestamp : null;
        if (!timestampRaw) {
          continue;
        }
        const timestamp = parseIsoDate(timestampRaw);
        if (timestamp > until) {
          continue;
        }
        if (timestamp < since) {
          stop = true;
          break;
        }
        collected.push(candidate);
        if (collected.length >= maxMessages) {
          break;
        }
      }
      const oldest = batch.at(-1);
      before = oldest && typeof oldest.id === "string" ? oldest.id : undefined;
      if (stop || !before) {
        break;
      }
    }
    return collected.reverse();
  }

  private async discordApiRequest<T>(pathname: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
    if (!token) {
      throw new Error("DISCORD_BOT_TOKEN is required for voice chat transcript capture");
    }
    const url = new URL(`https://discord.com/api/v10${pathname}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && `${value}` !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "prism-source-adapter/0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`Discord API failed: ${response.status} ${pathname} ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  private renderDiscordChatMessage(message: JsonObject): string {
    const parts: string[] = [];
    const content = String(message.content ?? "").trim();
    if (content) {
      parts.push(content);
    }
    const attachments = Array.isArray(message.attachments) ? message.attachments.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)) : [];
    for (const attachment of attachments) {
      const filename = typeof attachment.filename === "string" ? attachment.filename : "attachment";
      const url = typeof attachment.url === "string" ? attachment.url : null;
      parts.push(url ? `[attachment: ${filename}] ${url}` : `[attachment: ${filename}]`);
    }
    const embeds = Array.isArray(message.embeds) ? message.embeds.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)) : [];
    for (const embed of embeds) {
      const embedParts = [embed.title, embed.description, embed.url]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim());
      if (embedParts.length > 0) {
        parts.push(`[embed] ${embedParts.join(" - ")}`);
      }
    }
    return parts.join("\n").trim();
  }

  private discordAuthorName(author: JsonObject): string {
    for (const key of ["global_name", "display_name", "username", "id"]) {
      const value = author[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "discord-user";
  }

  private ignoreVoiceChatBotMessages(): boolean {
    const raw = (process.env.VOICE_CHAT_IGNORE_BOT_MESSAGES ?? "true").trim().toLowerCase();
    return !["0", "false", "no", "off"].includes(raw);
  }

  private stripSkillFrontmatter(content: string): string {
    const normalized = content.replace(/^\uFEFF/, "");
    if (!normalized.startsWith("---")) {
      return normalized.trim();
    }
    const end = normalized.indexOf("\n---", 3);
    if (end < 0) {
      return normalized.trim();
    }
    return normalized.slice(end + 4).trim();
  }

  private async recordingSummaryProfile(): Promise<{ content: string; source: string }> {
    const cached = this.recordingSummaryProfileCache;
    if (cached && Date.now() - cached.loadedAt < 60_000) {
      return { content: cached.content, source: cached.source };
    }

    const baseUrl = this.prismHooksBaseUrl();
    const token = this.prismHookServiceToken();
    if (!baseUrl || !token) {
      const unavailable = { content: "", source: "unavailable" };
      this.recordingSummaryProfileCache = { ...unavailable, loadedAt: Date.now() };
      return unavailable;
    }

    try {
      const response = await fetch(`${baseUrl}/agent/skills/recording-summary-profile`, {
        headers: {
          "x-service-token": token,
        },
      });
      if (!response.ok) {
        const unavailable = { content: "", source: `unavailable:${response.status}` };
        this.recordingSummaryProfileCache = { ...unavailable, loadedAt: Date.now() };
        return unavailable;
      }
      const payload = await response.json() as { content?: unknown };
      const content = typeof payload.content === "string" ? this.stripSkillFrontmatter(payload.content) : "";
      const profile = { content, source: "site-skill" };
      this.recordingSummaryProfileCache = { ...profile, loadedAt: Date.now() };
      return profile;
    } catch (error) {
      console.warn(`[discord-adapter] recording summary profile unavailable: ${this.describeError(error)}`);
      const unavailable = { content: "", source: "unavailable" };
      this.recordingSummaryProfileCache = { ...unavailable, loadedAt: Date.now() };
      return unavailable;
    }
  }

  private async buildSummaryArtifacts(
    session: RecordingSession,
    metadata: RecordingSessionMetadata,
    transcriptArtifacts: SessionTranscriptArtifacts | null,
  ): Promise<SessionSummary | null> {
    if (!transcriptArtifacts?.mergedTranscript.trim()) {
      return null;
    }

    const profile = await this.recordingSummaryProfile();
    const prompt = [
      "You are a meeting synthesis assistant for Prism.",
      "Return valid JSON only. Do not include markdown fences or extra commentary.",
      "Summarize the meeting transcript and extract action items, notable quotes, and tags.",
      "The transcript may interleave spoken voice segments and Discord voice-channel chat messages marked with a `chat` source label.",
      "",
      `Workspace summary profile source: ${profile.source}`,
      profile.content || "No additional workspace summary profile is configured.",
      "",
      "Use exactly this JSON schema:",
      "{",
      '  "title": "descriptive title",',
      '  "tldr": "short summary",',
      '  "summary": "detailed summary",',
      '  "actionItems": [{"name":"string","description":"string","assignedTo":"string or null","dueDate":"YYYY-MM-DD or null","params":{}}],',
      '  "notableQuotes": [{"author":"string","quote":"string","paraphrase":"string"}],',
      '  "tags": ["tag-1","tag-2","tag-3"]',
      "}",
      "",
      "Meeting metadata:",
      `- Name: ${metadata.metadata.meeting.name || "Discord meeting"}`,
      `- Channel: ${metadata.metadata.meeting.location || metadata.channelId}`,
      `- Started: ${new Date(metadata.startedAt).toISOString()}`,
      `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
      `- Participants: ${metadata.participants.map((participant) => participant.username).join(", ") || "unknown"}`,
      "",
      "Transcript:",
      transcriptArtifacts.mergedTranscript.slice(0, 120_000),
    ].join("\n");

    const parsed = this.safeJsonParse(await this.runtimeRequest(prompt, metadata.sessionId));
    const summary: SessionSummary = {
      title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : metadata.metadata.meeting.name || "Meeting Summary",
      tldr: typeof parsed?.tldr === "string" ? parsed.tldr.trim() : "",
      summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
      actionItems: Array.isArray(parsed?.actionItems) ? parsed.actionItems : [],
      notableQuotes: Array.isArray(parsed?.notableQuotes) ? parsed.notableQuotes : [],
      tags: Array.isArray(parsed?.tags) ? parsed.tags.filter((item: unknown): item is string => typeof item === "string") : [],
      raw: parsed,
      summaryJsonPath: path.join(session.transcriptDir, "summary.json"),
      summaryMarkdownPath: path.join(session.transcriptDir, "summary.md"),
    };
    await fs.writeFile(summary.summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await fs.writeFile(summary.summaryMarkdownPath, this.renderSummaryMarkdown(metadata, summary), "utf8");
    return summary;
  }

  private async buildLiveRecap(
    session: RecordingSession,
    transcriptArtifacts: SessionTranscriptArtifacts,
    steering: string | null,
  ): Promise<SessionRecap> {
    const participants = [...session.participants.values()].map((participant) => participant.username).filter(Boolean);
    const profile = await this.recordingSummaryProfile();
    const prompt = [
      "You are producing an in-progress meeting recap for Prism.",
      "Return valid JSON only. Do not include markdown fences or extra commentary.",
      "Use only the transcript evidence provided. If the transcript is sparse or partial, say that plainly and set confidence to low.",
      "Keep the recap useful for someone joining the meeting now.",
      steering ? `Operator steering: ${steering}` : "Operator steering: none",
      "",
      `Workspace summary profile source: ${profile.source}`,
      profile.content || "No additional workspace summary profile is configured.",
      "",
      "Use exactly this JSON schema:",
      "{",
      '  "title": "short meeting title",',
      '  "recap": "concise current-state recap",',
      '  "keyPoints": ["point"],',
      '  "decisions": ["decision"],',
      '  "actionItems": [{"description":"string","owner":"string or null","dueDate":"YYYY-MM-DD or null"}],',
      '  "openQuestions": ["question"],',
      '  "confidence": "low|medium|high"',
      "}",
      "",
      "Meeting metadata:",
      `- Session: ${session.sessionId}`,
      `- Channel: ${session.channelName}`,
      `- Started: ${new Date(session.startedAt).toISOString()}`,
      `- Generated: ${new Date().toISOString()}`,
      `- Participants: ${participants.join(", ") || "unknown"}`,
      "",
      "Transcript so far:",
      transcriptArtifacts.mergedTranscript.slice(0, 120_000),
    ].join("\n");

    const parsed = this.safeJsonParse(await this.runtimeRequest(prompt, `voice-recap-${session.sessionId}`)) as Record<string, unknown>;
    const stringArray = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : [];
    const actionItems = Array.isArray(parsed.actionItems)
      ? parsed.actionItems
          .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
          .map((item) => ({
            description: typeof item.description === "string" && item.description.trim()
              ? item.description.trim()
              : typeof item.name === "string" && item.name.trim()
                ? item.name.trim()
                : "Action item",
            owner: typeof item.owner === "string" && item.owner.trim()
              ? item.owner.trim()
              : typeof item.assignedTo === "string" && item.assignedTo.trim()
                ? item.assignedTo.trim()
                : null,
            dueDate: typeof item.dueDate === "string" && item.dueDate.trim() ? item.dueDate.trim() : null,
          }))
      : [];
    const confidence = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : `${session.channelName} recap`,
      recap: typeof parsed.recap === "string" && parsed.recap.trim()
        ? parsed.recap.trim()
        : typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      keyPoints: stringArray(parsed.keyPoints),
      decisions: stringArray(parsed.decisions),
      actionItems,
      openQuestions: stringArray(parsed.openQuestions),
      confidence,
    };
  }

  private renderLiveRecapResponse(
    session: RecordingSession,
    recap: SessionRecap,
    transcriptArtifacts: SessionTranscriptArtifacts,
  ): string {
    const sections = [
      `**${recap.title || `${session.channelName} recap`}**`,
      "",
      recap.recap || "No recap generated.",
      "",
      recap.keyPoints.length ? ["**Key points**", ...recap.keyPoints.map((item) => `- ${item}`)].join("\n") : null,
      recap.decisions.length ? ["**Decisions**", ...recap.decisions.map((item) => `- ${item}`)].join("\n") : null,
      recap.actionItems.length
        ? [
            "**Action items**",
            ...recap.actionItems.map((item) => `- ${item.description}${item.owner ? ` (${item.owner})` : ""}${item.dueDate ? ` due ${item.dueDate}` : ""}`),
          ].join("\n")
        : null,
      recap.openQuestions.length ? ["**Open questions**", ...recap.openQuestions.map((item) => `- ${item}`)].join("\n") : null,
      "",
      `_Confidence: ${recap.confidence}. Transcript segments: ${transcriptArtifacts.mergedSegments.length}._`,
    ].filter((line): line is string => typeof line === "string" && line.length > 0);
    const content = sections.join("\n");
    return content.length <= 1900 ? content : `${content.slice(0, 1850).trim()}\n\n_Recap truncated for Discord._`;
  }

  private runtimeTimeoutMs(): number {
    const value = Number.parseInt(process.env.CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS ?? "660", 10);
    if (Number.isFinite(value) && value > 0) {
      return value * 1000;
    }
    return 660_000;
  }

  private async runtimeRequest(prompt: string, sessionId: string): Promise<string> {
    const result = await requestSiteRuntime({
      prompt,
      sessionId: `voice-summary-${sessionId}`,
      continuationId: null,
      recentHistory: [],
      metadata: {
        purpose: "voice_meeting_summary",
        source: "discord-voice",
        recordingSessionId: sessionId,
      },
      timeoutMs: this.runtimeTimeoutMs(),
    });
    return result.responseText;
  }

  private voiceTranscriptionApiKey(): string {
    return (process.env.VOICE_TRANSCRIPTION_API_KEY ?? "").trim();
  }

  private voiceTranscriptionApiUrl(): string {
    const url = process.env.VOICE_TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "") || "";
    if (!url) {
      throw new Error("VOICE_TRANSCRIPTION_BASE_URL is required when voice transcription is enabled");
    }
    return url;
  }

  private async transcribeChunk(filePath: string): Promise<VoiceTranscriptionResponse> {
    const model = (process.env.VOICE_TRANSCRIPTION_MODEL ?? "").trim();
    const responseFormat = (process.env.VOICE_TRANSCRIPTION_RESPONSE_FORMAT ?? "").trim() || "json";
    const timestamps = (process.env.VOICE_TRANSCRIPTION_TIMESTAMPS ?? "true").trim() || "true";
    const form = new FormData();
    const fileBuffer = await fs.readFile(filePath);
    form.append("file", new Blob([fileBuffer], { type: "audio/flac" }), path.basename(filePath));
    if (model) {
      form.append("model", model);
    }
    form.append("response_format", responseFormat);
    form.append("timestamps", timestamps);
    const language = (process.env.VOICE_TRANSCRIPTION_LANGUAGE ?? "").trim();
    if (language) {
      form.append("language", language);
    }

    const response = await fetch(this.voiceTranscriptionApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.voiceTranscriptionApiKey()}`,
      },
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Voice transcription failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
    return (await response.json()) as VoiceTranscriptionResponse;
  }

  private isSkippableTranscriptionError(error: unknown): boolean {
    const message = this.describeError(error).toLowerCase();
    return (
      message.includes("voice transcription failed: 422") ||
      message.includes("audio could not be processed") ||
      message.includes("zero-length") ||
      message.includes("silent") ||
      message.includes("corrupt")
    );
  }

  private formatTimeSec(value: number): string {
    const seconds = Math.max(0, Math.floor(value));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${remainder}`;
  }

  private safeJsonParse(input: string): any {
    const cleaned = input
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error("Failed to parse summary JSON response");
    }
  }

  private prismApiBaseUrl(): string {
    const baseUrl = (process.env.PRISM_API_BASE ?? "").trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("PRISM_API_BASE is required for Prism memory ingest");
    }
    return baseUrl;
  }

  private prismArtifactBaseUrl(): string {
    const publicBaseUrl = this.publicPrismArtifactBaseUrl();
    if (publicBaseUrl) {
      return publicBaseUrl;
    }
    return this.prismApiBaseUrl();
  }

  private publicPrismArtifactBaseUrl(): string | null {
    return (
      process.env.PRISM_ARTIFACT_PUBLIC_BASE_URL ??
      process.env.PRISM_MEMORY_PUBLIC_BASE_URL ??
      ""
    ).trim().replace(/\/+$/, "") || null;
  }

  private prismArtifactReference(artifactPath?: string): { id: string; url: string } | null {
    if (!artifactPath) {
      return null;
    }
    const filename = path.basename(artifactPath);
    const artifactId = filename.replace(/\.json$/i, "");
    if (!artifactId || artifactId === filename) {
      return null;
    }
    try {
      const baseUrl = this.prismArtifactBaseUrl();
      return {
        id: artifactId,
        url: `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`,
      };
    } catch {
      return null;
    }
  }

  private publicPrismArtifactReference(artifactPath?: string): { id: string; url: string } | null {
    const baseUrl = this.publicPrismArtifactBaseUrl();
    if (!baseUrl || !artifactPath) {
      return null;
    }
    const filename = path.basename(artifactPath);
    const artifactId = filename.replace(/\.json$/i, "");
    if (!artifactId || artifactId === filename) {
      return null;
    }
    return {
      id: artifactId,
      url: `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`,
    };
  }

  private prismApiKey(): string {
    const apiKey = (process.env.PRISM_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("PRISM_API_KEY is required for Prism memory ingest");
    }
    return apiKey;
  }

  private async prismMemoryInboxWrite(payload: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${this.prismApiBaseUrl()}/memory/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prism-Api-Key": this.prismApiKey(),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`PRISM_MEMORY_INBOX_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
    }
    const result = (await response.json()) as { path?: string };
    if (!result.path || typeof result.path !== "string") {
      throw new Error("PRISM_MEMORY_INBOX_MISSING_PATH");
    }
    return result.path;
  }

  private async ingestArtifactsToPrismMemory(
    metadata: RecordingSessionMetadata,
    transcriptArtifacts: SessionTranscriptArtifacts | null,
    summary: SessionSummary | null,
    options: {
      ingestTranscript: boolean;
      ingestSummary: boolean;
    },
  ): Promise<{ transcriptPath: string | null; summaryPath: string | null }> {
    const prismApiBase = (process.env.PRISM_API_BASE ?? "").trim();
    const prismApiKey = (process.env.PRISM_API_KEY ?? "").trim();
    if (!prismApiBase || !prismApiKey) {
      return { transcriptPath: null, summaryPath: null };
    }

    const participants = metadata.participants.map((participant) => participant.username).filter(Boolean);
    const basePayload = {
      source: "discord-voice",
      bucket_hint: "meetings",
      author: "Prism Voice Recorder",
      participants,
      participant_count: participants.length,
      timing_events: metadata.timingEvents ?? [],
      url: metadata.source.recordingBaseUrl ? `${metadata.source.recordingBaseUrl}/recordings/${metadata.sessionId}` : undefined,
    };

    let transcriptPath: string | null = null;
    let summaryPath: string | null = null;

    if (options.ingestTranscript && transcriptArtifacts?.mergedTranscript.trim()) {
      transcriptPath = await this.prismMemoryInboxWrite({
        ...basePayload,
        type: "meeting_transcript",
        ts: new Date(metadata.endedAt).toISOString(),
        content: [
          `# ${metadata.metadata.meeting.name || "Discord Meeting Transcript"}`,
          "",
          `- Session: ${metadata.sessionId}`,
          `- Channel: ${metadata.metadata.meeting.location || metadata.channelId}`,
          `- Started: ${new Date(metadata.startedAt).toISOString()}`,
          `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
          `- Participants: ${participants.join(", ") || "unknown"}`,
          "",
          transcriptArtifacts.mergedTranscript,
        ].join("\n"),
      });
    }

    if (options.ingestSummary && summary) {
      summaryPath = await this.prismMemoryInboxWrite({
        ...basePayload,
        type: "meeting_summary",
        ts: new Date(metadata.endedAt).toISOString(),
        metadata: {
          source_system: "discord-voice",
          source_type: "meeting_summary",
          source_id: metadata.sessionId,
          session_id: metadata.sessionId,
          channel_id: metadata.channelId,
          channel_name: metadata.metadata.meeting.location || metadata.channelId,
          meeting_name: metadata.metadata.meeting.name || "Discord meeting",
          started_at: new Date(metadata.startedAt).toISOString(),
          ended_at: new Date(metadata.endedAt).toISOString(),
          action_items: summary.actionItems,
          notable_quotes: summary.notableQuotes,
          tags: summary.tags,
        },
        content: this.renderSummaryMarkdown(metadata, summary),
      });
    }

    return { transcriptPath, summaryPath };
  }

  private renderSummaryMarkdown(metadata: RecordingSessionMetadata, summary: SessionSummary): string {
    const actionLines = summary.actionItems.length > 0
      ? summary.actionItems.map((item) => `- ${item.name}: ${item.description}${item.assignedTo ? ` (owner: ${item.assignedTo})` : ""}${item.dueDate ? ` (due: ${item.dueDate})` : ""}`).join("\n")
      : "- None captured.";
    const quoteLines = summary.notableQuotes.length > 0
      ? summary.notableQuotes.map((item) => `- ${item.author}: "${item.quote}"${item.paraphrase ? `\n  - ${item.paraphrase}` : ""}`).join("\n")
      : "- None captured.";

    return [
      `# ${summary.title || metadata.metadata.meeting.name || "Meeting Summary"}`,
      "",
      `- Session: ${metadata.sessionId}`,
      `- Channel: ${metadata.metadata.meeting.location || metadata.channelId}`,
      `- Started: ${new Date(metadata.startedAt).toISOString()}`,
      `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
      `- Participants: ${metadata.participants.map((participant) => participant.username).join(", ") || "unknown"}`,
      summary.tags.length > 0 ? `- Tags: ${summary.tags.join(", ")}` : "- Tags: none",
      "",
      "## TL;DR",
      "",
      summary.tldr || "No short summary generated.",
      "",
      "## Summary",
      "",
      summary.summary || "No detailed summary generated.",
      "",
      "## Action Items",
      "",
      actionLines,
      "",
      "## Notable Quotes",
      "",
      quoteLines,
      "",
    ].join("\n");
  }

  private async sendWebhook(metadata: RecordingSessionMetadata): Promise<void> {
    const url = (process.env.N8N_WEBHOOK_URL ?? "").trim();
    if (!url) {
      return;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
    if (!response.ok) {
      throw new Error(`N8N webhook failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
  }

  private prismHooksBaseUrl(): string {
    return (
      process.env.PRISM_HOOKS_BASE_URL ??
      process.env.PRISM_AGENT_API_BASE_URL ??
      process.env.APP_API_BASE_URL ??
      ""
    ).trim().replace(/\/+$/, "");
  }

  private prismHookServiceToken(): string {
    return (
      process.env.PRISM_HOOK_SERVICE_TOKEN ??
      process.env.PRISM_AGENT_SERVICE_TOKEN ??
      process.env.APP_API_SERVICE_TOKEN ??
      process.env.INTERNAL_SERVICE_TOKEN ??
      process.env.SERVICE_SHARED_TOKEN ??
      ""
    ).trim();
  }

  private recordingCompleteHookKey(): string {
    return (process.env.DISCORD_RECORDING_COMPLETE_HOOK_KEY ?? "recording-transcript-completed").trim();
  }

  private recordingCompleteHookEnabled(): boolean {
    const hookKey = this.recordingCompleteHookKey();
    return parseBooleanEnv("DISCORD_RECORDING_COMPLETE_HOOK_ENABLED", Boolean(hookKey));
  }

  private recordingCompleteHookTimeoutMs(): number {
    return parseIntegerEnv("DISCORD_RECORDING_COMPLETE_HOOK_TIMEOUT_MS", 10_000);
  }

  private recordingSummaryEnabled(): boolean {
    return parseBooleanEnv("DISCORD_RECORDING_SUMMARY_ENABLED", true);
  }

  private recordingSummaryMemoryIngestEnabled(): boolean {
    return parseBooleanEnv("DISCORD_RECORDING_SUMMARY_MEMORY_INGEST_ENABLED", true);
  }

  private recordingTranscriptMemoryIngestEnabled(): boolean {
    return parseBooleanEnv("DISCORD_RECORDING_TRANSCRIPT_MEMORY_INGEST_ENABLED", false);
  }

  private recordingCompleteHookIncludeTranscriptBody(): boolean {
    return parseBooleanEnv("DISCORD_RECORDING_COMPLETE_HOOK_INCLUDE_TRANSCRIPT_BODY", false);
  }

  private async readJsonArtifact(filePath?: string): Promise<unknown | null> {
    if (!filePath) {
      return null;
    }
    const raw = await fs.readFile(filePath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private async readTextArtifact(filePath?: string): Promise<string | null> {
    if (!filePath) {
      return null;
    }
    return fs.readFile(filePath, "utf8").catch(() => null);
  }

  private async recordingCompleteHookPayload(metadata: RecordingSessionMetadata, summary: SessionSummary | null): Promise<Record<string, unknown>> {
    const transcriptArtifact = this.publicPrismArtifactReference(metadata.artifacts?.prismMemoryTranscriptPath);
    const summaryArtifact = this.publicPrismArtifactReference(metadata.artifacts?.prismMemorySummaryPath);
    const recordingUrl = metadata.source.recordingBaseUrl ? `${metadata.source.recordingBaseUrl}/recordings/${metadata.sessionId}` : null;
    const includeTranscriptBody = this.recordingCompleteHookIncludeTranscriptBody() || !summary;
    const transcriptMarkdown = includeTranscriptBody ? await this.readTextArtifact(metadata.artifacts?.transcriptMarkdownPath) : null;
    const transcriptJson = includeTranscriptBody ? await this.readJsonArtifact(metadata.artifacts?.transcriptJsonPath) : null;
    const summaryMarkdown = summary ? await this.readTextArtifact(summary.summaryMarkdownPath) : null;
    const summaryJson = summary ? await this.readJsonArtifact(summary.summaryJsonPath) : null;
    const startedAt = new Date(metadata.startedAt).toISOString();
    const endedAt = new Date(metadata.endedAt).toISOString();
    return {
      source: "discord-source-adapter",
      event: summary ? "recording.summary.completed" : "recording.transcript.completed",
      occurredAt: endedAt,
      recording: {
        source: "discord-native",
        platform: "discord",
        service: "source-adapter",
        sessionId: metadata.sessionId,
        title: metadata.metadata.meeting.name || "Discord recording",
        location: metadata.metadata.meeting.location || metadata.channelId,
        startedAt,
        endedAt,
        recordingUrl,
      },
      discord: {
        guildID: metadata.guildId,
        channelID: metadata.channelId,
        channelName: metadata.metadata.meeting.name ?? null,
        threadID: null,
        messageID: null,
        scheduledEventID: metadata.scheduledEventId ?? null,
        scheduledEvent: metadata.scheduledEvent ?? null,
        recordingStartedAt: startedAt,
        recordingEndedAt: endedAt,
      },
      transcript: {
        status: "completed",
        markdown: transcriptMarkdown,
        json: transcriptJson,
        textOmitted: !includeTranscriptBody,
        storagePath: metadata.artifacts?.transcriptMarkdownPath ?? null,
        jsonStoragePath: metadata.artifacts?.transcriptJsonPath ?? null,
        sharingAllowed: Boolean(transcriptArtifact?.url),
        artifactUrl: transcriptArtifact?.url ?? null,
      },
      summary: summary ? {
        markdown: summaryMarkdown,
        json: summaryJson ?? summary,
        storagePath: summary.summaryMarkdownPath,
        jsonStoragePath: summary.summaryJsonPath,
        memoryPath: metadata.artifacts?.prismMemorySummaryPath ?? null,
        artifactUrl: summaryArtifact?.url ?? null,
      } : null,
      policy: {
        rawTranscriptSharingAllowed: Boolean(transcriptArtifact?.url),
      },
      sourceArtifacts: {
        recordingURL: recordingUrl,
        transcriptPath: metadata.artifacts?.transcriptMarkdownPath ?? null,
        transcriptJsonPath: metadata.artifacts?.transcriptJsonPath ?? null,
        summaryPath: metadata.artifacts?.summaryMarkdownPath ?? null,
        summaryJsonPath: metadata.artifacts?.summaryJsonPath ?? null,
      },
      artifacts: {
        artifactID: summaryArtifact?.id ?? transcriptArtifact?.id ?? null,
        recordingURL: recordingUrl,
        transcriptURL: transcriptArtifact?.url ?? null,
        summaryURL: summaryArtifact?.url ?? null,
        summaryText: summary?.tldr || summary?.summary?.slice(0, 2_000) || null,
      },
      participants: metadata.participants.map((participant) => ({
        discordUserID: participant.userId,
        username: participant.username,
        displayName: participant.username,
      })),
      operator: {
        notes: [],
        requestedOutputs: ["summary", "downstream-plan"],
      },
      metadata: {
        adapterInstance: process.env.RAILWAY_SERVICE_NAME || "source-adapter",
        confidence: "direct",
        notes: [],
        timingEvents: metadata.timingEvents ?? [],
      },
    };
  }

  private async triggerPrismHook(hookKey: string, payload: Record<string, unknown>, sessionId: string): Promise<void> {
    const baseUrl = this.prismHooksBaseUrl();
    const token = this.prismHookServiceToken();
    if (!baseUrl || !token) {
      console.warn(
        `[discord-adapter] recording complete hook skipped session=${sessionId}: missing ${[
          baseUrl ? null : "PRISM_HOOKS_BASE_URL or PRISM_AGENT_API_BASE_URL or APP_API_BASE_URL",
          token ? null : "PRISM_HOOK_SERVICE_TOKEN or PRISM_AGENT_SERVICE_TOKEN or APP_API_SERVICE_TOKEN",
        ].filter(Boolean).join(", ")}`,
      );
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.recordingCompleteHookTimeoutMs());
    try {
      const response = await fetch(`${baseUrl}/agent/hooks/${encodeURIComponent(hookKey)}/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": token,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn(
          `[discord-adapter] recording complete hook failed session=${sessionId} hook=${hookKey} status=${response.status} body=${(await response.text()).slice(0, 300)}`,
        );
        return;
      }
      console.log(`[discord-adapter] recording complete hook triggered session=${sessionId} hook=${hookKey}`);
    } catch (error) {
      console.warn(`[discord-adapter] recording complete hook failed session=${sessionId} hook=${hookKey}: ${this.describeError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async triggerRecordingCompleteHook(metadata: RecordingSessionMetadata, summary: SessionSummary | null): Promise<void> {
    if (!this.recordingCompleteHookEnabled()) {
      return;
    }
    const hookKey = this.recordingCompleteHookKey();
    if (!hookKey) {
      console.warn(`[discord-adapter] recording complete hook skipped session=${metadata.sessionId}: missing DISCORD_RECORDING_COMPLETE_HOOK_KEY`);
      return;
    }
    await this.triggerPrismHook(hookKey, await this.recordingCompleteHookPayload(metadata, summary), metadata.sessionId);
  }

  async resolveRecordingDownload(sessionId: string, fileName: string): Promise<{ filePath: string; contentType: string } | null> {
    const safeName = path.basename(fileName);
    const filePath = path.join(this.recordingsRoot, sessionId, "flac", safeName);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return null;
    }
    return { filePath, contentType: "audio/flac" };
  }
}
