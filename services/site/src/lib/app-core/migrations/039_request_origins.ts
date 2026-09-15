export const requestOriginsMigration = {
  name: '039_request_origins',
  sql: `
    CREATE TABLE request_origins (
      request_id TEXT PRIMARY KEY REFERENCES change_requests(id) ON DELETE CASCADE,
      source_session_id TEXT,
      platform TEXT NOT NULL CHECK (platform IN ('site', 'discord', 'telegram', 'buzz', 'external', 'task', 'hook', 'system', 'unknown')),
      target_id TEXT,
      target_name TEXT,
      thread_id TEXT,
      interface_key TEXT,
      interaction_profile_key TEXT,
      interaction_profile_version INTEGER,
      actor_type TEXT CHECK (actor_type IS NULL OR actor_type IN ('user', 'external-subject', 'task', 'hook', 'system')),
      actor_id TEXT,
      actor_display_name TEXT,
      source_message_id TEXT,
      raw_source TEXT,
      backfill_status TEXT NOT NULL DEFAULT 'complete' CHECK (backfill_status IN ('complete', 'partial', 'unknown')),
      captured_at TEXT NOT NULL
    );

    CREATE INDEX idx_request_origins_platform_target
      ON request_origins(platform, target_id, captured_at DESC);

    CREATE INDEX idx_request_origins_profile
      ON request_origins(interaction_profile_key, captured_at DESC);

    CREATE INDEX idx_request_origins_actor
      ON request_origins(actor_type, actor_id, captured_at DESC);

    CREATE INDEX idx_request_origins_source_session
      ON request_origins(source_session_id);

    WITH ranked_sessions AS (
      SELECT
        s.*,
        ROW_NUMBER() OVER (
          PARTITION BY s.linked_change_request_id
          ORDER BY s.created_at ASC, s.id ASC
        ) AS request_rank
      FROM agent_sessions s
      WHERE s.linked_change_request_id IS NOT NULL
    ),
    ranked_messages AS (
      SELECT
        m.*,
        ROW_NUMBER() OVER (
          PARTITION BY m.session_id
          ORDER BY m.created_at DESC, m.id DESC
        ) AS session_rank
      FROM agent_messages m
      WHERE m.role = 'user'
    )
    INSERT INTO request_origins (
      request_id,
      source_session_id,
      platform,
      target_id,
      target_name,
      thread_id,
      interface_key,
      interaction_profile_key,
      interaction_profile_version,
      actor_type,
      actor_id,
      actor_display_name,
      source_message_id,
      raw_source,
      backfill_status,
      captured_at
    )
    SELECT
      cr.id,
      s.id,
      CASE
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) IN ('manual', 'admin', 'site', 'admin-console', 'chat') THEN 'site'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'discord%' THEN 'discord'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'telegram%' THEN 'telegram'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'buzz%' THEN 'buzz'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'external%' THEN 'external'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'task%' OR lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) = 'task-runner' THEN 'task'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'hook%' THEN 'hook'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'system%' OR lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'prism-doctor%' THEN 'system'
        ELSE 'unknown'
      END,
      CASE
        WHEN lower(COALESCE(s.source, '')) LIKE 'discord%' THEN s.discord_channel_id
        WHEN lower(COALESCE(s.source, '')) LIKE 'telegram%' THEN json_extract(s.meta_json, '$.chatId')
        WHEN lower(COALESCE(s.source, '')) LIKE 'buzz%' THEN json_extract(s.meta_json, '$.channelId')
        WHEN lower(COALESCE(s.source, '')) LIKE 'external%' THEN json_extract(s.meta_json, '$.externalInterfaceKey')
        ELSE NULL
      END,
      CASE
        WHEN lower(COALESCE(s.source, '')) LIKE 'discord%' THEN json_extract(s.meta_json, '$.channelName')
        WHEN lower(COALESCE(s.source, '')) LIKE 'telegram%' THEN json_extract(s.meta_json, '$.chatTitle')
        WHEN lower(COALESCE(s.source, '')) LIKE 'buzz%' THEN json_extract(s.meta_json, '$.channelName')
        WHEN lower(COALESCE(s.source, '')) LIKE 'external%' THEN json_extract(s.meta_json, '$.externalInterfaceKey')
        ELSE NULL
      END,
      s.discord_thread_id,
      CASE WHEN lower(COALESCE(s.source, '')) LIKE 'external%'
        THEN json_extract(s.meta_json, '$.externalInterfaceKey') ELSE NULL END,
      COALESCE(
        json_extract(s.meta_json, '$.interactionProfileKey'),
        json_extract(s.meta_json, '$.accessPolicy.interactionProfileKey')
      ),
      json_extract(s.meta_json, '$.interactionProfileVersion'),
      CASE
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'external%' THEN 'external-subject'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'task%' OR lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) = 'task-runner' THEN 'task'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'hook%' THEN 'hook'
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'system%' OR lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'prism-doctor%' THEN 'system'
        WHEN cr.requested_by_user_id IS NOT NULL OR s.id IS NOT NULL THEN 'user'
        ELSE NULL
      END,
      CASE
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'external%' THEN NULL
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'task:%' THEN substr(COALESCE(NULLIF(s.source, ''), cr.source), 6)
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'hook:%' THEN substr(COALESCE(NULLIF(s.source, ''), cr.source), 6)
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'system:%' THEN substr(COALESCE(NULLIF(s.source, ''), cr.source), 8)
        ELSE COALESCE(
          cr.requested_by_user_id,
          json_extract(m.meta_json, '$.authorId'),
          json_extract(m.meta_json, '$.authorPubkey')
        )
      END,
      CASE
        WHEN lower(COALESCE(NULLIF(s.source, ''), cr.source, '')) LIKE 'external%' THEN NULL
        ELSE COALESCE(p.display_name, json_extract(m.meta_json, '$.authorName'))
      END,
      m.source_message_id,
      cr.source,
      CASE
        WHEN s.id IS NOT NULL OR cr.requested_by_user_id IS NOT NULL THEN 'partial'
        ELSE 'unknown'
      END,
      cr.created_at
    FROM change_requests cr
    LEFT JOIN ranked_sessions s
      ON s.linked_change_request_id = cr.id AND s.request_rank = 1
    LEFT JOIN ranked_messages m
      ON m.session_id = s.id AND m.session_rank = 1
    LEFT JOIN profiles p ON p.user_id = cr.requested_by_user_id;
  `,
};
