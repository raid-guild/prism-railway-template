import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Header, HTTPException


SERVICE_ROOT = Path(__file__).resolve().parents[1]
STARTER_BASE = os.environ.get("PRISM_API_BUNDLED_BASE", "prism_seed").strip() or "prism_seed"
BUNDLED_SPACE_SLUG = os.environ.get("PRISM_API_BUNDLED_SPACE", "default").strip() or "default"
SPACE_SLUG = os.environ.get("PRISM_API_SPACE", "community").strip() or "community"
CODE_ROOT = SERVICE_ROOT / STARTER_BASE / BUNDLED_SPACE_SLUG / "code"

if str(CODE_ROOT) not in sys.path:
    sys.path.insert(0, str(CODE_ROOT))

from community_memory_api.app import Settings, create_app  # noqa: E402
from community_memory_api.backends import create_storage_backend  # noqa: E402


def require_api_key(x_prism_api_key: str | None) -> None:
    expected = os.environ.get("PRISM_API_KEY", "").strip()
    if expected and x_prism_api_key != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def configured_volume_root() -> Path:
    configured = os.environ.get("PRISM_API_DATA_ROOT", "").strip()
    if configured:
        return Path(configured).resolve()
    return SERVICE_ROOT / "data"


def runtime_space_root() -> Path:
    root = configured_volume_root()
    if root.parent.name == STARTER_BASE and root.name == SPACE_SLUG:
        return root
    return root / STARTER_BASE / SPACE_SLUG


def bundled_space_root() -> Path:
    return SERVICE_ROOT / STARTER_BASE / BUNDLED_SPACE_SLUG


def rewrite_runtime_config(target_root: Path) -> None:
    config_path = target_root / "config" / "space.json"
    if not config_path.exists():
        return

    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["space_slug"] = SPACE_SLUG
    old_prefix = f"{STARTER_BASE}/{BUNDLED_SPACE_SLUG}/"
    new_prefix = f"{STARTER_BASE}/{SPACE_SLUG}/"

    def rewrite(value):
        if isinstance(value, str):
            return value.replace(old_prefix, new_prefix)
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        return value

    config_path.write_text(json.dumps(rewrite(config), indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def ensure_runtime_seeded(target_root: Path) -> None:
    source_root = bundled_space_root()
    target_root.parent.mkdir(parents=True, exist_ok=True)
    if not target_root.exists():
        import shutil

        shutil.copytree(source_root, target_root)
        rewrite_runtime_config(target_root)
        return

    import shutil

    for child in source_root.iterdir():
        destination = target_root / child.name
        if destination.exists():
            continue
        if child.is_dir():
            shutil.copytree(child, destination)
        else:
            shutil.copy2(child, destination)
    rewrite_runtime_config(target_root)


def ingest_log_path() -> Path:
    path = runtime_space_root() / "activity" / "ingest-log.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def append_ingest_record(record: dict) -> None:
    with ingest_log_path().open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=True) + "\n")


def active_space_config() -> dict:
    config_path = runtime_space_root() / "config" / "space.json"
    if not config_path.is_file():
        return {}
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def discord_category_to_bucket() -> dict[str, str]:
    config = active_space_config()
    discord = config.get("discord") if isinstance(config.get("discord"), dict) else {}
    mapping = discord.get("category_to_bucket") if isinstance(discord.get("category_to_bucket"), dict) else {}
    return {str(key).strip(): str(value).strip() for key, value in mapping.items() if str(key).strip() and str(value).strip()}


def resolve_discord_bucket_hint(candidate: dict, metadata: dict, mapping: dict[str, str]) -> str | None:
    explicit = metadata.get("bucketHint") or metadata.get("bucket") or candidate.get("bucketHint") or candidate.get("bucket")
    if explicit:
        return str(explicit).strip() or None
    candidates = [
        metadata.get("parentCategoryId"),
        metadata.get("parent_category_id"),
        candidate.get("parentCategoryId"),
        candidate.get("parent_category_id"),
        metadata.get("parentChannelId"),
        metadata.get("parent_channel_id"),
        candidate.get("parentChannelId"),
        candidate.get("parent_channel_id"),
        metadata.get("channelId"),
        metadata.get("channel_id"),
        candidate.get("channelId"),
        candidate.get("channel_id"),
    ]
    for raw in candidates:
        key = str(raw or "").strip()
        if key and key in mapping:
            return mapping[key]
    return None


def starter_settings() -> Settings:
    api_key = os.environ.get("PRISM_API_KEY", "").strip() or None
    read_key = os.environ.get("PRISM_API_READ_KEY", "").strip() or api_key
    write_key = os.environ.get("PRISM_API_WRITE_KEY", "").strip() or api_key
    ops_key = os.environ.get("PRISM_API_OPS_KEY", "").strip() or api_key
    storage_backend = os.environ.get("PRISM_API_STORAGE_BACKEND", "filesystem").strip() or "filesystem"

    return Settings(
        base_dir=SERVICE_ROOT,
        base=STARTER_BASE,
        space=SPACE_SLUG,
        code_space=BUNDLED_SPACE_SLUG,
        api_key=api_key,
        read_api_key=read_key,
        write_api_key=write_key,
        ops_api_key=ops_key,
        service_name="prism-memory",
        storage_backend=storage_backend,
        data_root_override=runtime_space_root(),
    )


ensure_runtime_seeded(runtime_space_root())
settings = starter_settings()
app = create_app(settings)
storage = create_storage_backend(backend=settings.storage_backend, root=settings.data_root)


@app.post("/ingest/messages", tags=["compat"])
def ingest_messages(payload: dict, x_prism_api_key: str | None = Header(default=None)):
    require_api_key(x_prism_api_key)

    space = str(payload.get("space") or settings.space).strip() or settings.space
    source = str(payload.get("source") or "unknown").strip() or "unknown"
    source_event_type = f"{source.lower().replace('-', '_').replace(' ', '_')}_message"
    batch_id = str(payload.get("batchId") or payload.get("batch_id") or "").strip() or None
    messages = payload.get("messages")

    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="messages must be an array")

    accepted = 0
    inbox_paths: list[str] = []
    normalized_messages = []
    bucket_mapping = discord_category_to_bucket() if source.lower() == "discord" else {}

    for index, candidate in enumerate(messages):
        if not isinstance(candidate, dict):
            raise HTTPException(status_code=400, detail=f"messages[{index}] must be an object")

        message_id = str(candidate.get("messageId") or candidate.get("message_id") or "").strip()
        channel_id = str(candidate.get("channelId") or candidate.get("channel_id") or "").strip()
        timestamp = str(
            candidate.get("timestamp")
            or candidate.get("createdAt")
            or candidate.get("created_at")
            or ""
        ).strip()

        if not message_id or not channel_id or not timestamp:
            raise HTTPException(
                status_code=400,
                detail=f"messages[{index}] requires messageId, channelId, and timestamp",
            )

        author = candidate.get("author") if isinstance(candidate.get("author"), dict) else {}
        metadata = candidate.get("metadata") if isinstance(candidate.get("metadata"), dict) else {}
        text = str(
            candidate.get("renderedText")
            or candidate.get("rendered_text")
            or candidate.get("text")
            or candidate.get("content")
            or ""
        ).strip()
        display_name = (
            str(
                author.get("displayName")
                or author.get("display_name")
                or author.get("username")
                or "unknown"
            ).strip()
            or "unknown"
        )

        inbox_payload = {
            "source": str(candidate.get("source") or source).strip() or source,
            "ts": timestamp,
            "type": source_event_type,
            "content": text or "(empty message)",
            "author": display_name,
            "url": metadata.get("messageUrl"),
            "participant_count": 1,
            "metadata": {
                **metadata,
                "guildId": candidate.get("guildId") or candidate.get("guild_id"),
                "channelId": channel_id,
                "threadId": candidate.get("threadId") or candidate.get("thread_id"),
                "messageId": message_id,
                "authorBot": bool(author.get("bot")),
            },
        }
        bucket_hint = resolve_discord_bucket_hint(candidate, metadata, bucket_mapping)
        if bucket_hint:
            inbox_payload["bucket_hint"] = bucket_hint

        inbox_path = storage.write_memory_inbox_entry(inbox_payload)
        inbox_paths.append(inbox_path)
        accepted += 1
        normalized_messages.append(
            {
                "source": inbox_payload["source"],
                "space": str(candidate.get("space") or space).strip() or space,
                "guildId": candidate.get("guildId") or candidate.get("guild_id"),
                "channelId": channel_id,
                "threadId": candidate.get("threadId") or candidate.get("thread_id"),
                "messageId": message_id,
                "text": text,
                "timestamp": timestamp,
                "author": author,
                "metadata": metadata,
                "inboxPath": inbox_path,
            }
        )

    stored_at = datetime.now(timezone.utc).isoformat()
    append_ingest_record(
        {
            "ingestedAt": stored_at,
            "space": space,
            "source": source,
            "batchId": batch_id,
            "messageCount": accepted,
            "messages": normalized_messages,
        }
    )

    return {
        "ok": True,
        "space": space,
        "source": source,
        "batchId": batch_id,
        "accepted": accepted,
        "storedAt": stored_at,
        "inboxCount": len(inbox_paths),
        "sampleInboxPaths": inbox_paths[:10],
        "logPath": str(ingest_log_path()),
    }
