from __future__ import annotations

import asyncio
import json
import subprocess
import hashlib
import html
import logging
import os
import re
import secrets
import sys
import time
import io
import tarfile
from datetime import datetime, timedelta, timezone
from dataclasses import asdict, dataclass
from pathlib import Path
import shutil
from typing import Callable, Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from .backends import StorageBackend, create_storage_backend
from . import schemas
from .storage import StorageError

logger = logging.getLogger(__name__)


@dataclass
class Settings:
    base_dir: Path
    base: str = "prism_seed"
    space: str = "community"
    code_space: Optional[str] = "default"
    api_key: Optional[str] = None
    read_api_key: Optional[str] = None
    write_api_key: Optional[str] = None
    ops_api_key: Optional[str] = None
    service_name: str = "prism-memory-api"
    storage_backend: str = "filesystem"
    data_root_override: Optional[Path] = None
    root_path: str = ""
    strip_prefix: str = ""

    @property
    def data_root(self) -> Path:
        if self.data_root_override is not None:
            return self.data_root_override
        return self.base_dir / self.base / self.space


def create_app(settings: Settings) -> FastAPI:
    data_root = settings.data_root
    skills_root = settings.base_dir / "skills"
    code_space = settings.code_space or settings.space
    bundled_config_path = settings.base_dir / settings.base / code_space / "config" / "space.json"
    if settings.data_root_override is not None and not data_root.exists():
        bundled_root = settings.base_dir / settings.base / code_space
        if bundled_root.exists():
            shutil.copytree(bundled_root, data_root)
    data_root.mkdir(parents=True, exist_ok=True)
    storage: StorageBackend = create_storage_backend(
        backend=settings.storage_backend,
        root=data_root,
    )

    code_path = settings.base_dir / settings.base / code_space / "code"
    if str(code_path) not in sys.path:
        sys.path.append(str(code_path))
    try:
        from community_memory.config_loader import load_config as _load_config
        from community_knowledge.schemas import validate_metadata as _validate_metadata
        from community_knowledge.source_sync import (
            KnowledgeSourceError as _KnowledgeSourceError,
            KnowledgeSourceManager as _KnowledgeSourceManager,
        )
    except ModuleNotFoundError as exc:
        raise RuntimeError("community_memory or community_knowledge package not found") from exc

    config_path = data_root / "config" / "space.json"
    knowledge_constraints = None
    allowed_kinds: list[str] = []
    config_warning: str | None = None
    active_timezone = "UTC"

    def _reload_config_state() -> None:
        nonlocal knowledge_constraints, allowed_kinds, config_warning, active_timezone
        try:
            space_config = _load_config(config_path)
            knowledge_constraints = space_config.knowledge.constraints
            allowed_kinds = space_config.knowledge.constraints.allowed_kinds
            if space_config.knowledge.kinds:
                allowed_kinds = sorted(set(allowed_kinds + space_config.knowledge.kinds))
            active_timezone = space_config.timezone or "UTC"
            config_warning = None
        except FileNotFoundError:
            knowledge_constraints = None
            allowed_kinds = []
            active_timezone = "UTC"
            config_warning = f"Knowledge config not found at {config_path}; metadata validation disabled"
            logger.warning("Knowledge config not found at %s; metadata validation disabled", config_path)
        except Exception as exc:
            logger.exception("Failed to load active config at %s", config_path)
            try:
                space_config = _load_config(bundled_config_path)
                knowledge_constraints = space_config.knowledge.constraints
                allowed_kinds = space_config.knowledge.constraints.allowed_kinds
                if space_config.knowledge.kinds:
                    allowed_kinds = sorted(set(allowed_kinds + space_config.knowledge.kinds))
                active_timezone = space_config.timezone or "UTC"
                config_warning = (
                    f"Active config at {config_path} is invalid ({exc}); "
                    f"using bundled fallback at {bundled_config_path}"
                )
                logger.warning("%s", config_warning)
            except Exception as fallback_exc:
                knowledge_constraints = None
                allowed_kinds = []
                active_timezone = "UTC"
                config_warning = (
                    f"Active config at {config_path} is invalid ({exc}); "
                    f"bundled fallback at {bundled_config_path} also failed ({fallback_exc}); "
                    "metadata validation disabled"
                )
                logger.exception("Bundled fallback config failed at %s", bundled_config_path)

    _reload_config_state()

    def _absolute_url(request: Request, value: str | None) -> str | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        if raw.startswith(("http://", "https://")):
            return raw
        if not raw.startswith("/"):
            raw = f"/{raw}"
        encoded = quote(raw, safe="/-._~")
        return f"{str(request.base_url).rstrip('/')}{encoded}"

    def _with_absolute_links(request: Request, payload):
        if isinstance(payload, dict):
            result = dict(payload)
            for key in ("doc_url", "doc_api_url"):
                if key in result:
                    result[key] = _absolute_url(request, result.get(key))
            if "results" in result and isinstance(result["results"], list):
                result["results"] = [_with_absolute_links(request, item) for item in result["results"]]
            return result
        if isinstance(payload, list):
            return [_with_absolute_links(request, item) for item in payload]
        return payload

    def _load_active_config():
        try:
            return _load_config(config_path)
        except Exception:
            return _load_config(bundled_config_path)

    def _load_active_config_dict() -> dict:
        return asdict(_load_active_config())

    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _audit_log_path() -> Path:
        return data_root / "ops" / "audit" / "config-admin.jsonl"

    def _is_sensitive_key(key: str) -> bool:
        normalized = key.lower()
        return any(token in normalized for token in ("password", "secret", "token", "api_key", "apikey", "key"))

    def _redact_value(value):
        if isinstance(value, dict):
            return {
                str(key): ("<redacted>" if _is_sensitive_key(str(key)) else _redact_value(item))
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [_redact_value(item) for item in value]
        return value

    def _flatten_changed_keys(before, after, prefix: str = "") -> list[str]:
        if isinstance(before, dict) and isinstance(after, dict):
            changed: list[str] = []
            keys = sorted(set(before.keys()) | set(after.keys()))
            for key in keys:
                child_prefix = f"{prefix}.{key}" if prefix else str(key)
                if key not in before or key not in after:
                    changed.append(child_prefix)
                    continue
                changed.extend(_flatten_changed_keys(before[key], after[key], child_prefix))
            return changed
        if before != after:
            return [prefix] if prefix else []
        return []

    def _audit_actor(request: Request) -> str:
        return (
            request.headers.get("x-prism-actor")
            or request.headers.get("x-service-name")
            or request.headers.get("user-agent")
            or "api"
        ).strip()

    def _audit_reason(request: Request) -> str | None:
        raw = request.headers.get("x-prism-reason")
        return raw.strip() if raw and raw.strip() else None

    def _append_audit_entry(entry: dict) -> None:
        audit_path = _audit_log_path()
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=True) + "\n")

    def _audit_recent(limit: int) -> schemas.OpsAuditRecentResponse:
        audit_path = _audit_log_path()
        if not audit_path.is_file():
            return schemas.OpsAuditRecentResponse(entries=[], total=0, limit=limit)
        all_entries: list[schemas.OpsAuditEntry] = []
        with audit_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                all_entries.append(schemas.OpsAuditEntry(**payload))
        visible_entries = all_entries[-limit:]
        return schemas.OpsAuditRecentResponse(
            entries=list(reversed(visible_entries)),
            total=len(all_entries),
            limit=limit,
        )

    def _merge_patch(current: dict, patch: dict) -> dict:
        merged = dict(current)
        for key, value in patch.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = _merge_patch(dict(merged[key]), value)
            else:
                merged[key] = value
        return merged

    def _parse_local_date(value: str, *, field: str):
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD") from exc

    def _validate_bucket_name(value: str) -> str:
        bucket = value.strip()
        if not re.fullmatch(r"[a-z0-9_-]+", bucket):
            raise HTTPException(status_code=400, detail=f"Invalid bucket name: {value}")
        return bucket

    def _discord_mapping_from_request(mapping: Optional[dict[str, str]]) -> dict[str, str]:
        source = mapping
        if source is None:
            active = _load_active_config_dict()
            discord = active.get("discord") if isinstance(active.get("discord"), dict) else {}
            source = discord.get("category_to_bucket") if isinstance(discord.get("category_to_bucket"), dict) else {}
        cleaned: dict[str, str] = {}
        for raw_key, raw_bucket in dict(source or {}).items():
            key = str(raw_key).strip()
            if not key:
                continue
            cleaned[key] = _validate_bucket_name(str(raw_bucket))
        return cleaned

    def _raw_window_paths_for_dates(start_date, end_date) -> list[Path]:
        buckets_dir = data_root / "buckets"
        if not buckets_dir.is_dir():
            return []
        paths: list[Path] = []
        current = start_date
        while current <= end_date:
            paths.extend(sorted(buckets_dir.glob(f"*/raw/{current.isoformat()}/*.json")))
            current += timedelta(days=1)
        return sorted(paths)

    def _message_mapping_ids(channel: dict, message: dict) -> list[str]:
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        candidates = [
            metadata.get("parentCategoryId"),
            metadata.get("parent_category_id"),
            message.get("parentCategoryId"),
            message.get("parent_category_id"),
            channel.get("parentCategoryId"),
            channel.get("parent_category_id"),
            metadata.get("parentChannelId"),
            metadata.get("parent_channel_id"),
            message.get("parentChannelId"),
            message.get("parent_channel_id"),
            channel.get("parentChannelId"),
            channel.get("parent_channel_id"),
            channel.get("category_id"),
            metadata.get("channelId"),
            metadata.get("channel_id"),
            message.get("channelId"),
            message.get("channel_id"),
            channel.get("channel_id"),
        ]
        seen: set[str] = set()
        ids: list[str] = []
        for candidate in candidates:
            value = str(candidate or "").strip()
            if value and value not in seen:
                ids.append(value)
                seen.add(value)
        return ids

    def _target_bucket_for_raw_window(payload: dict, mapping: dict[str, str]) -> tuple[str | None, bool]:
        targets: set[str] = set()
        channels = payload.get("channels", [])
        if not isinstance(channels, list):
            return None, False
        for channel in channels:
            if not isinstance(channel, dict):
                continue
            messages = channel.get("messages", [])
            if not isinstance(messages, list):
                continue
            for message in messages:
                if not isinstance(message, dict):
                    continue
                for candidate in _message_mapping_ids(channel, message):
                    if candidate in mapping:
                        targets.add(mapping[candidate])
                        break
        if not targets:
            return None, False
        if len(targets) > 1:
            return None, True
        return next(iter(targets)), False

    def _unique_raw_destination(target_dir: Path, stem: str) -> tuple[Path, Path]:
        json_path = target_dir / f"{stem}.json"
        md_path = target_dir / f"{stem}.md"
        if not json_path.exists() and not md_path.exists():
            return json_path, md_path
        idx = 1
        while True:
            candidate_stem = f"{stem}-{idx}"
            json_path = target_dir / f"{candidate_stem}.json"
            md_path = target_dir / f"{candidate_stem}.md"
            if not json_path.exists() and not md_path.exists():
                return json_path, md_path
            idx += 1

    def _rewrite_raw_markdown_bucket(path: Path, bucket: str) -> None:
        if not path.is_file():
            return
        lines = path.read_text(encoding="utf-8").splitlines()
        updated = False
        for idx, line in enumerate(lines):
            if line.startswith("bucket: "):
                lines[idx] = f"bucket: {bucket}"
                updated = True
                break
        if not updated:
            lines.insert(1, f"bucket: {bucket}")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _remove_derived_outputs(dates: set[str], buckets: set[str]) -> list[str]:
        removed: list[str] = []
        for date_str in sorted(dates):
            for bucket in sorted(buckets):
                for suffix in ("md", "json"):
                    path = data_root / "buckets" / bucket / "digests" / f"{date_str}.{suffix}"
                    if path.is_file():
                        path.unlink()
                        removed.append(str(path.relative_to(data_root)))
        return removed

    def _normalize_space_config(config_payload: dict) -> dict:
        normalized = dict(config_payload)
        agentic = normalized.get("agentic_ingest")
        if isinstance(agentic, dict):
            agentic_normalized = dict(agentic)
            if "enabled" in agentic_normalized:
                agentic_normalized.pop("mode", None)
            normalized["agentic_ingest"] = agentic_normalized
        return normalized

    def _write_space_config(
        config_payload: dict,
        *,
        request: Request,
        action: str,
        before_config: dict | None = None,
    ) -> schemas.SpaceConfigUpdateResponse:
        config_payload = _normalize_space_config(config_payload)
        config_file = data_root / "config" / "space.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = config_file.with_suffix(".json.tmp")
        serialized = json.dumps(config_payload, indent=2) + "\n"
        tmp_file.write_text(serialized, encoding="utf-8")
        try:
            _load_config(tmp_file)
        except Exception as exc:
            tmp_file.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "code": "invalid_config",
                        "message": f"space.json validation failed: {exc}",
                    }
                },
            )

        tmp_file.replace(config_file)
        _reload_config_state()
        digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": action,
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok",
                "changed_keys": _flatten_changed_keys(before_config or {}, config_payload),
                "before": _redact_value(before_config) if before_config is not None else None,
                "after": _redact_value(config_payload),
                "details": {
                    "path": str(config_file),
                    "sha256": digest,
                },
            }
        )
        return schemas.SpaceConfigUpdateResponse(
            path=str(config_file),
            updated_at=datetime.now(timezone.utc).isoformat(),
            sha256=digest,
            knowledge_allowed_kinds=allowed_kinds,
            knowledge_allowed_tags=(
                list(knowledge_constraints.allowed_tags) if knowledge_constraints is not None else []
            ),
        )

    knowledge_source_manager = _KnowledgeSourceManager(
        data_root=data_root,
        workspace_root=(data_root.parent.parent if settings.data_root_override is not None else settings.base_dir),
        load_config=_load_active_config,
    )

    app = FastAPI(title="Prism Memory API", version="0.1.0", root_path=settings.root_path or "")

    def _normalize_prefix(value: str) -> str:
        value = value.rstrip("/")
        if not value.startswith("/"):
            value = f"/{value}"
        return value

    prefixes_to_strip: list[str] = []
    if settings.strip_prefix:
        prefixes_to_strip.append(_normalize_prefix(settings.strip_prefix))
    if settings.root_path:
        prefixes_to_strip.append(_normalize_prefix(settings.root_path))
    prefixes_to_strip = [p for p in prefixes_to_strip if p and p != "/"]

    if prefixes_to_strip:
        @app.middleware("http")
        async def strip_prefix_middleware(request: Request, call_next):
            path = request.scope.get("path", "") or "/"
            for prefix in prefixes_to_strip:
                if path == prefix:
                    path = "/"
                elif path.startswith(prefix + "/"):
                    new_path = path[len(prefix):]
                    if not new_path.startswith("/"):
                        new_path = f"/{new_path}"
                    path = new_path or "/"
            request.scope["path"] = path or "/"
            return await call_next(request)

    logger.info(
        "Starting Prism Memory API (service=%s, root=%s, auth=%s, root_path=%s)",
        settings.service_name,
        data_root,
        {
            "read": "enabled" if (settings.read_api_key or settings.api_key) else "disabled",
            "write": "enabled" if (settings.write_api_key or settings.api_key) else "disabled",
            "ops": "enabled" if (settings.ops_api_key or settings.api_key) else "disabled",
        },
        settings.root_path or "/",
    )

    @app.on_event("startup")
    async def _startup() -> None:  # pragma: no cover
        logger.info("data_root=%s root_path=%s", data_root, settings.root_path or "/")

    ops_workspace_root = (
        data_root.parent.parent if settings.data_root_override is not None else settings.base_dir
    )
    ops_base_arg = settings.base
    code_path = settings.base_dir / settings.base / code_space / "code"

    def _ops_env() -> dict[str, str]:
        env = dict(os.environ)
        existing = env.get("PYTHONPATH", "").strip()
        env["PYTHONPATH"] = (
            f"{code_path}:{existing}" if existing else str(code_path)
        )
        return env

    def _run_ops_command(operation: str, args: list[str]) -> schemas.OpsResponse:
        command = [sys.executable, *args]
        completed = subprocess.run(
            command,
            cwd=ops_workspace_root,
            env=_ops_env(),
            capture_output=True,
            text=True,
        )
        response = schemas.OpsResponse(
            ok=completed.returncode == 0,
            operation=operation,
            command=command,
            cwd=str(ops_workspace_root),
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )
        if completed.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": {
                        "code": "ops_failed",
                        "message": f"{operation} failed with exit code {completed.returncode}",
                    },
                    "result": response.model_dump(),
                },
            )
        return response

    async def _run_ops_command_async(operation: str, args: list[str]) -> schemas.OpsResponse:
        return await asyncio.to_thread(_run_ops_command, operation, args)

    def _error_response(code: str, message: str, status: int, headers: Optional[dict] = None) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={"error": {"code": code, "message": message}},
            headers=headers,
        )

    def _skill_slug(value: str) -> str:
        value = value.strip().strip("/")
        if not value or ".." in value:
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "invalid_skill", "message": "Invalid skill name"}},
            )
        return value

    def _resolve_skill_dir(slug: str) -> Path:
        normalized = _skill_slug(slug)
        candidates = [skills_root / normalized]
        for candidate in candidates:
            if candidate.is_dir() and (candidate / "SKILL.md").is_file():
                return candidate
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "message": f"Skill not found: {normalized}"}},
        )

    def _list_skills() -> list[dict[str, str]]:
        results: list[dict[str, str]] = []
        for skill_md in sorted(skills_root.glob("*/SKILL.md")):
            skill_dir = skill_md.parent
            name = skill_dir.name
            description = ""
            for line in skill_md.read_text(encoding="utf-8").splitlines():
                if line.startswith("description:"):
                    description = line.split(":", 1)[1].strip()
                    break
            results.append({"name": name, "path": str(skill_dir.relative_to(settings.base_dir)), "description": description})
        return results

    def _tar_skill_dir(skill_dir: Path) -> bytes:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            for path in sorted(skill_dir.rglob("*")):
                if path.is_file():
                    arcname = str(path.relative_to(skill_dir.parent))
                    archive.add(path, arcname=arcname)
        buffer.seek(0)
        return buffer.getvalue()

    def _scoped_keys() -> dict[str, list[str]]:
        keys: dict[str, list[str]] = {"read": [], "write": [], "ops": []}
        if settings.read_api_key:
            keys["read"].append(settings.read_api_key)
        if settings.write_api_key:
            keys["write"].append(settings.write_api_key)
        if settings.ops_api_key:
            keys["ops"].append(settings.ops_api_key)

        # Backward-compatible fallback for older deploys that still provide one shared key.
        if settings.api_key:
            for scope in ("read", "write", "ops"):
                keys[scope].append(settings.api_key)
        return keys

    scoped_keys = _scoped_keys()

    def require_api_key(
        allowed_scopes: tuple[str, ...],
        prism_key: Optional[str] = Header(default=None, alias="X-Prism-Api-Key"),
        legacy_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    ) -> None:
        api_key_value = prism_key or legacy_key
        if not any(scoped_keys[scope] for scope in allowed_scopes):
            scope_names = ", ".join(allowed_scopes)
            raise HTTPException(
                status_code=500,
                detail={
                    "error": {
                        "code": "api_key_not_configured",
                        "message": f"API key not configured for scope(s): {scope_names}",
                    }
                },
            )
        if not api_key_value:
            raise HTTPException(
                status_code=401,
                headers={"WWW-Authenticate": "API-Key"},
                detail={"error": {"code": "missing_api_key", "message": "X-Prism-Api-Key header required"}},
            )
        for scope in allowed_scopes:
            for expected_key in scoped_keys[scope]:
                if secrets.compare_digest(api_key_value, expected_key):
                    return
        logger.warning(
            "Invalid API key attempt sha256=%s allowed_scopes=%s",
            hashlib.sha256(api_key_value.encode()).hexdigest(),
            ",".join(allowed_scopes),
        )
        raise HTTPException(
            status_code=401,
            headers={"WWW-Authenticate": "API-Key"},
            detail={"error": {"code": "invalid_api_key", "message": "Invalid API key"}},
        )

    def require_read_api_key(
        prism_key: Optional[str] = Header(default=None, alias="X-Prism-Api-Key"),
        legacy_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    ) -> None:
        require_api_key(("read", "write", "ops"), prism_key, legacy_key)

    def require_write_api_key(
        prism_key: Optional[str] = Header(default=None, alias="X-Prism-Api-Key"),
        legacy_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    ) -> None:
        require_api_key(("write", "ops"), prism_key, legacy_key)

    def require_ops_api_key(
        prism_key: Optional[str] = Header(default=None, alias="X-Prism-Api-Key"),
        legacy_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    ) -> None:
        require_api_key(("ops",), prism_key, legacy_key)

    @app.middleware("http")
    async def access_log_middleware(request: Request, call_next: Callable):
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.info("%s %s -> %s (%sms)", request.method, request.url.path, status, duration_ms)

    @app.exception_handler(StorageError)
    async def storage_error_handler(_: Request, exc: StorageError):  # type: ignore[override]
        mapping = {
            "invalid_date": 400,
            "invalid_bucket": 400,
            "invalid_slug": 400,
            "ambiguous_slug": 400,
            "invalid_query": 400,
            "not_found": 404,
            "malformed_json": 500,
        }
        status = mapping.get(exc.code, 500)
        return _error_response(exc.code, exc.message, status)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):  # type: ignore[override]
        if isinstance(exc.detail, dict):
            return JSONResponse(status_code=exc.status_code, content=exc.detail, headers=exc.headers)
        return _error_response("error", str(exc.detail), exc.status_code, headers=exc.headers)

    @app.get("/health", response_model=schemas.HealthResponse, tags=["system"])
    async def health() -> schemas.HealthResponse:
        return schemas.HealthResponse(service=settings.service_name, space=settings.space)

    read_auth_dependency = Depends(require_read_api_key)
    write_auth_dependency = Depends(require_write_api_key)
    ops_auth_dependency = Depends(require_ops_api_key)

    @app.get("/memory/latest", dependencies=[read_auth_dependency], tags=["memory"])
    async def memory_latest():
        return storage.memory_latest()

    @app.get("/memory/dates", dependencies=[read_auth_dependency], tags=["memory"])
    async def memory_dates(limit: int = Query(180, ge=1, le=730)):
        return storage.memory_dates(limit=limit)

    @app.get("/latest", dependencies=[read_auth_dependency], tags=["memory"], include_in_schema=False)
    async def memory_latest_alias():
        return storage.memory_latest()

    @app.get("/memory/date/{date}", dependencies=[read_auth_dependency], tags=["memory"])
    async def memory_by_date(date: str):
        return storage.memory_by_date(date)

    @app.get("/state/latest", dependencies=[read_auth_dependency], tags=["state"])
    async def state_latest():
        return storage.state_latest()

    @app.get("/state/projects", dependencies=[read_auth_dependency], tags=["state"])
    async def state_projects():
        return storage.state_projects()

    @app.get("/state/signals", dependencies=[read_auth_dependency], tags=["state"])
    async def state_signals(
        anchor: Optional[str] = Query(None),
        kind: Optional[str] = Query(None),
        source: Optional[str] = Query(None),
        objective_key: Optional[str] = Query(None),
        throughline_key: Optional[str] = Query(None),
        limit: int = Query(250, ge=1, le=5000),
    ):
        return storage.state_signals(
            anchor=anchor,
            kind=kind,
            source=source,
            objective_key=objective_key,
            throughline_key=throughline_key,
            limit=limit,
        )

    @app.get("/state/objectives", dependencies=[read_auth_dependency], tags=["state"])
    async def state_objectives(
        status: Optional[str] = Query(None),
        source: Optional[str] = Query(None),
        external_system: Optional[str] = Query(None, alias="externalSystem"),
        objective_key: Optional[str] = Query(None),
        limit: int = Query(250, ge=1, le=5000),
    ):
        return storage.state_objectives(
            status=status,
            source=source,
            external_system=external_system,
            objective_key=objective_key,
            limit=limit,
        )

    @app.get("/state/throughlines", dependencies=[read_auth_dependency], tags=["state"])
    async def state_throughlines(
        status: Optional[str] = Query(None),
        throughline_key: Optional[str] = Query(None),
        limit: int = Query(250, ge=1, le=5000),
    ):
        return storage.state_throughlines(
            status=status,
            throughline_key=throughline_key,
            limit=limit,
        )

    @app.patch(
        "/state/throughlines/{throughline_key}",
        response_model=schemas.StateThroughlineMutationResponse,
        dependencies=[ops_auth_dependency],
        tags=["state"],
    )
    async def state_throughline_patch(
        request: Request,
        throughline_key: str,
        payload: schemas.StateThroughlinePatchRequest,
    ):
        before = storage.state_throughlines(throughline_key=throughline_key, limit=1)
        try:
            result = storage.patch_state_throughline(throughline_key, payload.model_dump(exclude_unset=True))
        except StorageError as exc:
            return _error_response(exc.code, exc.message, 400 if exc.code != "not_found" else 404)
        after = storage.state_throughlines(throughline_key=result["throughline_key"], limit=1)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "state.throughline.patch",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok",
                "changed_keys": _flatten_changed_keys(before, after),
                "before": _redact_value(before),
                "after": _redact_value(after),
                "details": {"throughline_key": throughline_key, "result_key": result["throughline_key"]},
            }
        )
        return schemas.StateThroughlineMutationResponse(**result)

    @app.post(
        "/state/throughlines/{throughline_key}/merge",
        response_model=schemas.StateThroughlineMutationResponse,
        dependencies=[ops_auth_dependency],
        tags=["state"],
    )
    async def state_throughline_merge(
        request: Request,
        throughline_key: str,
        payload: schemas.StateThroughlineMergeRequest,
    ):
        before = storage.state_throughlines(limit=5000)
        try:
            result = storage.merge_state_throughline(throughline_key, payload.model_dump(exclude_unset=True))
        except StorageError as exc:
            return _error_response(exc.code, exc.message, 400 if exc.code != "not_found" else 404)
        after = storage.state_throughlines(limit=5000)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "state.throughline.merge",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok",
                "changed_keys": _flatten_changed_keys(before, after),
                "before": None,
                "after": None,
                "details": {
                    "source_key": throughline_key,
                    "target_key": result["throughline_key"],
                    "changed_keys": _flatten_changed_keys(before, after),
                },
            }
        )
        return schemas.StateThroughlineMutationResponse(**result)

    @app.delete(
        "/state/throughlines/{throughline_key}",
        response_model=schemas.StateThroughlineMutationResponse,
        dependencies=[ops_auth_dependency],
        tags=["state"],
    )
    async def state_throughline_delete(request: Request, throughline_key: str):
        before = storage.state_throughlines(throughline_key=throughline_key, limit=1)
        try:
            result = storage.delete_state_throughline(throughline_key)
        except StorageError as exc:
            return _error_response(exc.code, exc.message, 400 if exc.code != "not_found" else 404)
        after = storage.state_throughlines(throughline_key=throughline_key, limit=1)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "state.throughline.delete",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok",
                "changed_keys": _flatten_changed_keys(before, after),
                "before": _redact_value(before),
                "after": _redact_value(after),
                "details": {"throughline_key": throughline_key},
            }
        )
        return schemas.StateThroughlineMutationResponse(**result)

    @app.put(
        "/state/projects/{project_key}",
        response_model=schemas.StateProjectUpsertResponse,
        dependencies=[ops_auth_dependency],
        tags=["state"],
    )
    async def state_project_upsert(project_key: str, payload: schemas.StateProjectUpsertRequest):
        try:
            result = storage.upsert_state_project(project_key, payload.model_dump(exclude_unset=True))
        except StorageError as exc:
            return _error_response(exc.code, exc.message, 400 if exc.code != "not_found" else 404)
        return schemas.StateProjectUpsertResponse(**result)

    @app.get(
        "/memory/participants",
        response_model=schemas.ParticipantActivityResponse,
        dependencies=[read_auth_dependency],
        tags=["memory"],
    )
    async def participant_activity(
        start: str = Query(..., description="Inclusive ISO-8601 start timestamp"),
        end: str = Query(..., description="Exclusive ISO-8601 end timestamp"),
        bucket: Optional[str] = Query(None, description="Optional bucket filter"),
        limit: int = Query(25, ge=1, le=500),
    ):
        return storage.participant_activity(start=start, end=end, bucket=bucket, limit=limit)

    @app.get("/date/{date}", dependencies=[read_auth_dependency], tags=["memory"], include_in_schema=False)
    async def memory_by_date_alias(date: str):
        return storage.memory_by_date(date)

    @app.get("/digests/date/{date}", dependencies=[read_auth_dependency], tags=["digests"])
    async def digests_by_date(date: str):
        return storage.digests_by_date(date)

    @app.get("/digests/bucket/{bucket}/date/{date}", dependencies=[read_auth_dependency], tags=["digests"])
    async def digest_for_bucket(bucket: str, date: str):
        return storage.digest_for_bucket(bucket, date)

    @app.get("/buckets/{bucket}/digests/{date}.{ext}", dependencies=[read_auth_dependency], tags=["digests"])
    async def bucket_digest_asset(bucket: str, date: str, ext: str):
        media_type, payload = storage.bucket_digest_asset(bucket, date, ext)
        if media_type == "text/markdown":
            return Response(content=payload, media_type=media_type)
        return payload

    @app.get("/activity/recent", dependencies=[read_auth_dependency], tags=["activity"])
    async def activity_recent(
        limit: int = Query(100, ge=1, le=1000),
        event_type: Optional[str] = Query(None, alias="type"),
        bucket: Optional[str] = None,
        collector_key: Optional[str] = None,
    ):
        return storage.activity_recent(limit=limit, event_type=event_type, bucket=bucket, collector_key=collector_key)

    @app.get("/config/space", dependencies=[read_auth_dependency], tags=["system"])
    async def config_space():
        config_file = data_root / "config" / "space.json"
        source_file = config_file if config_file.is_file() else bundled_config_path
        return storage._load_json(source_file)

    @app.get("/config/status", dependencies=[read_auth_dependency], tags=["system"])
    async def config_status():
        return {
            "path": str(config_path),
            "bundled_fallback_path": str(bundled_config_path),
            "warning": config_warning,
            "knowledge_validation_enabled": knowledge_constraints is not None,
            "knowledge_allowed_kinds": allowed_kinds,
            "knowledge_allowed_tags": (
                list(knowledge_constraints.allowed_tags) if knowledge_constraints is not None else []
            ),
        }

    @app.put(
        "/config/space",
        response_model=schemas.SpaceConfigUpdateResponse,
        dependencies=[ops_auth_dependency],
        tags=["system"],
    )
    async def config_space_update(request: Request, payload: schemas.SpaceConfigUpdateRequest):
        current = _load_active_config_dict()
        return _write_space_config(payload.config, request=request, action="config.put", before_config=current)

    @app.patch(
        "/config/space",
        response_model=schemas.SpaceConfigUpdateResponse,
        dependencies=[ops_auth_dependency],
        tags=["system"],
    )
    async def config_space_patch(request: Request, payload: schemas.SpaceConfigPatchRequest):
        config_file = data_root / "config" / "space.json"
        source_file = config_file if config_file.is_file() else bundled_config_path
        current_raw = json.loads(source_file.read_text(encoding="utf-8"))
        merged = _merge_patch(current_raw, payload.patch)
        return _write_space_config(merged, request=request, action="config.patch", before_config=current_raw)

    @app.get(
        "/ops/audit/recent",
        response_model=schemas.OpsAuditRecentResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_audit_recent(limit: int = Query(50, ge=1, le=500)):
        return _audit_recent(limit)

    @app.get("/skills", dependencies=[read_auth_dependency], tags=["system"])
    async def skills_list():
        return {"skills": _list_skills()}

    @app.get("/skills/{skill_name}/download", dependencies=[read_auth_dependency], tags=["system"])
    async def skills_download(skill_name: str):
        skill_dir = _resolve_skill_dir(skill_name)
        payload = _tar_skill_dir(skill_dir)
        filename = f"{skill_dir.name}.tar.gz"
        return Response(
            content=payload,
            media_type="application/gzip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/products/suggestions/latest", dependencies=[read_auth_dependency], tags=["products"])
    async def product_suggestion_latest():
        return storage.product_suggestion_latest()

    @app.get("/products/suggestions/date/{date}", dependencies=[read_auth_dependency], tags=["products"])
    async def product_suggestion_by_date(date: str):
        return storage.product_suggestion_by_date(date)

    @app.get("/products/suggestions/weekly/{week}", dependencies=[read_auth_dependency], tags=["products"])
    async def product_suggestion_weekly(week: str):
        return storage.product_suggestion_weekly(week)

    @app.get("/knowledge/docs/{slug:path}", dependencies=[read_auth_dependency], tags=["knowledge"])
    async def knowledge_doc(slug: str, request: Request):
        return _with_absolute_links(request, storage.knowledge_doc(slug))

    @app.get("/knowledge/view/{slug:path}", tags=["knowledge"], include_in_schema=False)
    async def knowledge_doc_html(slug: str, request: Request):
        doc = storage.knowledge_doc(slug)
        title = str(doc.get("title") or doc.get("slug") or "Knowledge doc")
        content = str(doc.get("content") or "")
        api_url = _absolute_url(request, f"/knowledge/docs/{str(doc.get('slug') or slug)}") or ""
        source_url = str(doc.get("source_url") or "").strip()
        source_link = f'<dt>Source</dt><dd><a href="{html.escape(source_url, quote=True)}">{html.escape(source_url)}</a></dd>' if source_url else ""
        page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 0; background: #f7f4ee; color: #1d2433; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 32px 20px 56px; }}
    header {{ border-bottom: 1px solid #ddd6cc; margin-bottom: 24px; padding-bottom: 18px; }}
    h1 {{ font-size: 28px; line-height: 1.2; margin: 0 0 12px; }}
    dl {{ display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; color: #5f6572; font-size: 14px; }}
    dt {{ font-weight: 700; color: #303747; }}
    dd {{ margin: 0; overflow-wrap: anywhere; }}
    article {{ background: #fffaf3; border: 1px solid #ddd6cc; border-radius: 12px; padding: 20px; box-shadow: 0 18px 48px -36px rgba(26,31,44,.55); }}
    pre {{ white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; margin: 0; }}
    a {{ color: #bb4d2a; }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <dl>
        <dt>Slug</dt><dd>{html.escape(str(doc.get('slug') or ''))}</dd>
        <dt>Kind</dt><dd>{html.escape(str(doc.get('kind') or ''))}</dd>
        <dt>Updated</dt><dd>{html.escape(str(doc.get('updated') or ''))}</dd>
        <dt>API</dt><dd><a href="{api_url}">{api_url}</a></dd>
        {source_link}
      </dl>
    </header>
    <article><pre>{html.escape(content)}</pre></article>
  </main>
</body>
</html>
"""
        return Response(content=page, media_type="text/html; charset=utf-8")

    @app.get("/knowledge/search", dependencies=[read_auth_dependency], tags=["knowledge"])
    async def knowledge_search(
        request: Request,
        q: Optional[str] = Query(None, min_length=1),
        kind: Optional[str] = None,
        tag: Optional[str] = None,
        entity: Optional[str] = None,
        limit: int = Query(25, ge=1, le=100),
    ):
        return _with_absolute_links(
            request,
            storage.knowledge_search(query=q, kind=kind, tag=tag, entity=entity, limit=limit),
        )

    @app.get("/knowledge/indexes/manifest", dependencies=[read_auth_dependency], tags=["knowledge"])
    async def knowledge_index_manifest():
        return storage.knowledge_index("manifest")

    @app.get("/knowledge/indexes/tags", dependencies=[read_auth_dependency], tags=["knowledge"])
    async def knowledge_index_tags():
        return storage.knowledge_index("tags")

    @app.get("/knowledge/indexes/entities", dependencies=[read_auth_dependency], tags=["knowledge"])
    async def knowledge_index_entities():
        return storage.knowledge_index("entities")

    @app.get(
        "/knowledge/sources",
        response_model=schemas.KnowledgeSourceListResponse,
        dependencies=[read_auth_dependency],
        tags=["knowledge"],
    )
    async def knowledge_sources_list():
        sources = knowledge_source_manager.list_sources()
        return schemas.KnowledgeSourceListResponse(sources=sources, total=len(sources))

    @app.post(
        "/knowledge/sources",
        response_model=schemas.KnowledgeSourceResponse,
        dependencies=[write_auth_dependency],
        tags=["knowledge"],
    )
    async def knowledge_sources_create(payload: schemas.KnowledgeSourceCreateRequest):
        try:
            return knowledge_source_manager.create_source(payload.model_dump())
        except _KnowledgeSourceError as exc:
            return _error_response(exc.code, exc.message, 400 if exc.code != "not_found" else 404)

    @app.get(
        "/knowledge/sources/{source_id}",
        response_model=schemas.KnowledgeSourceResponse,
        dependencies=[read_auth_dependency],
        tags=["knowledge"],
    )
    async def knowledge_sources_get(source_id: str):
        try:
            return knowledge_source_manager.get_source(source_id)
        except _KnowledgeSourceError as exc:
            return _error_response(exc.code, exc.message, 404 if exc.code == "not_found" else 400)

    @app.patch(
        "/knowledge/sources/{source_id}",
        response_model=schemas.KnowledgeSourceResponse,
        dependencies=[write_auth_dependency],
        tags=["knowledge"],
    )
    async def knowledge_sources_update(source_id: str, payload: schemas.KnowledgeSourceUpdateRequest):
        update = payload.model_dump(exclude_none=True)
        try:
            return knowledge_source_manager.update_source(source_id, update)
        except _KnowledgeSourceError as exc:
            return _error_response(exc.code, exc.message, 404 if exc.code == "not_found" else 400)

    @app.post(
        "/knowledge/sources/{source_id}/sync",
        response_model=schemas.KnowledgeSourceResponse,
        dependencies=[write_auth_dependency],
        tags=["knowledge"],
    )
    async def knowledge_sources_sync(source_id: str):
        try:
            return knowledge_source_manager.sync_source(source_id)
        except _KnowledgeSourceError as exc:
            return _error_response(exc.code, exc.message, 404 if exc.code == "not_found" else 400)

    @app.post(
        "/ops/knowledge/sources/sync",
        response_model=schemas.KnowledgeSourceSyncChangedResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops", "knowledge"],
    )
    async def ops_knowledge_sources_sync(request: Request):
        result = knowledge_source_manager.sync_changed_sources()
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "ops.knowledge.sources.sync",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok" if result["ok"] else "error",
                "changed_keys": [],
                "before": None,
                "after": None,
                "details": {
                    "checked": result["checked"],
                    "changed": result["changed"],
                    "synced": result["synced"],
                    "skipped": result["skipped"],
                    "failed": result["failed"],
                },
            }
        )
        if result["failed"]:
            return JSONResponse(status_code=500, content={**result, "operation": "knowledge.sources.sync_changed"})
        return {**result, "operation": "knowledge.sources.sync_changed"}

    @app.get("/api/artifacts", response_model=schemas.ArtifactListResponse, dependencies=[read_auth_dependency], tags=["artifacts"])
    async def artifacts_list(
        category: Optional[str] = Query(None, description="memory or knowledge"),
        type: Optional[str] = Query(None, description="Optional memory artifact type filter"),
        source: Optional[str] = Query(None, description="Optional source filter"),
        status: Optional[str] = Query(None, description="incoming, processed, or rejected"),
        limit: int = Query(50, ge=1, le=200),
    ):
        return storage.list_artifacts(artifact_type=type, source=source, status=status, category=category, limit=limit)

    @app.get("/api/artifacts/{artifact_id}", response_model=schemas.ArtifactDetail, dependencies=[read_auth_dependency], tags=["artifacts"])
    async def artifact_detail(artifact_id: str):
        return storage.artifact_detail(artifact_id)

    @app.get("/api/artifacts/{artifact_id}/raw", dependencies=[read_auth_dependency], tags=["artifacts"])
    async def artifact_raw(artifact_id: str):
        media_type, content = storage.artifact_raw(artifact_id)
        return Response(content=content, media_type=media_type)

    @app.get("/artifacts/{artifact_id}", tags=["artifacts"], include_in_schema=False)
    async def artifact_html(artifact_id: str):
        artifact = storage.artifact_detail(artifact_id)
        title = f"{artifact.get('type') or 'artifact'} / {artifact.get('source') or 'unknown'}"
        content = str(artifact.get("content") or "")
        raw_url = f"/api/artifacts/{html.escape(str(artifact.get('id') or artifact_id), quote=True)}/raw"
        page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 0; background: #f7f4ee; color: #1d2433; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 32px 20px 56px; }}
    header {{ border-bottom: 1px solid #ddd6cc; margin-bottom: 24px; padding-bottom: 18px; }}
    h1 {{ font-size: 28px; line-height: 1.2; margin: 0 0 12px; }}
    dl {{ display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; color: #5f6572; font-size: 14px; }}
    dt {{ font-weight: 700; color: #303747; }}
    dd {{ margin: 0; overflow-wrap: anywhere; }}
    article {{ background: #fffaf3; border: 1px solid #ddd6cc; border-radius: 12px; padding: 20px; box-shadow: 0 18px 48px -36px rgba(26,31,44,.55); }}
    pre {{ white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; margin: 0; }}
    a {{ color: #bb4d2a; }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <dl>
        <dt>ID</dt><dd>{html.escape(str(artifact.get('id') or ''))}</dd>
        <dt>Status</dt><dd>{html.escape(str(artifact.get('status') or ''))}</dd>
        <dt>Created</dt><dd>{html.escape(str(artifact.get('created_at') or ''))}</dd>
        <dt>Path</dt><dd>{html.escape(str(artifact.get('path') or ''))}</dd>
        <dt>Raw</dt><dd><a href="{raw_url}">{raw_url}</a></dd>
      </dl>
    </header>
    <article><pre>{html.escape(content)}</pre></article>
  </main>
</body>
</html>
"""
        return Response(content=page, media_type="text/html; charset=utf-8")

    @app.post(
        "/knowledge/inbox",
        response_model=schemas.KnowledgeInboxResponse,
        dependencies=[write_auth_dependency],
        tags=["knowledge"],
    )
    async def knowledge_inbox(payload: schemas.KnowledgeInboxRequest):
        if not payload.content.strip():
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "empty_content", "message": "Content cannot be empty"}},
            )

        warnings: list[str] = []
        if knowledge_constraints is not None:
            result = _validate_metadata(
                payload.metadata,
                constraints=knowledge_constraints,
                allowed_kinds=allowed_kinds,
            )
            if not result.ok:
                raise HTTPException(
                    status_code=400,
                    detail={"error": {"code": "invalid_metadata", "message": "; ".join(result.errors[:10])}},
                )
            warnings = result.warnings

        try:
            entry = storage.write_knowledge_inbox_entry(
                payload.filename,
                payload.content,
                payload.metadata,
            )
        except StorageError as exc:
            return _error_response(exc.code, exc.message, 400 if exc.code != "not_found" else 404)

        response = schemas.KnowledgeInboxResponse(
            path=entry["doc_path"],
            metadata_path=entry["meta_path"],
            warnings=warnings or None,
        )
        return response

    @app.post(
        "/memory/inbox",
        response_model=schemas.MemoryInboxResponse,
        dependencies=[write_auth_dependency],
        tags=["memory"],
    )
    async def memory_inbox(entry: schemas.MemoryInboxRequest):
        source = entry.source.strip()
        msg_type = entry.type.strip()
        content = entry.content.strip()
        if not source or not msg_type or not content:
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "invalid_payload", "message": "source, type, and content are required"}},
            )
        ts_value = entry.ts
        if ts_value.tzinfo is None:
            ts_value = ts_value.replace(tzinfo=timezone.utc)
        ts_value = ts_value.astimezone(timezone.utc)
        ts_iso = ts_value.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        payload = {
            "source": source,
            "type": msg_type,
            "content": content,
            "ts": ts_iso,
        }
        if entry.bucket:
            payload["bucket"] = entry.bucket
        if entry.bucket_hint:
            payload["bucket_hint"] = entry.bucket_hint
        if entry.author:
            payload["author"] = entry.author
        if entry.url:
            payload["url"] = entry.url
        if entry.participants:
            payload["participants"] = [item.strip() for item in entry.participants if item and item.strip()]
        if entry.participant_count is not None:
            payload["participant_count"] = entry.participant_count
        if entry.metadata:
            payload["metadata"] = entry.metadata
        stored = storage.write_memory_inbox_entry(payload)
        return schemas.MemoryInboxResponse(
            path=stored["path"],
            artifact_id=stored["artifact_id"],
            artifact_url=stored["artifact_url"],
        )

    @app.post(
        "/ops/memory/run",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_memory_run(
        request: Request,
        date: Optional[str] = Query(None, description="Optional YYYY-MM-DD target date for digest/memory/seeds"),
        force: bool = Query(False),
        backfill_hours: Optional[int] = Query(None, ge=1),
    ):
        target_date = date
        if target_date is None:
            target_date = datetime.now(ZoneInfo(active_timezone)).date().isoformat()

        args = [
            "-m",
            "community_memory.pipeline",
            "collect",
            "--base",
            ops_base_arg,
            "--space",
            settings.space,
        ]
        if force:
            args.append("--force")
        if backfill_hours is not None:
            args.extend(["--backfill-hours", str(backfill_hours)])
        await _run_ops_command_async("memory.collect", args)

        last_result: schemas.OpsResponse | None = None
        for stage in ("digest", "memory", "seeds"):
            stage_args = [
                "-m",
                "community_memory.pipeline",
                stage,
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
                "--date",
                target_date,
            ]
            if force:
                stage_args.append("--force")
            last_result = await _run_ops_command_async(f"memory.{stage}", stage_args)

        if last_result is not None:
            _append_audit_entry(
                {
                    "ts": _now_iso(),
                    "action": "ops.memory.run",
                    "actor": _audit_actor(request),
                    "reason": _audit_reason(request),
                    "status": "ok" if last_result.exit_code == 0 else "error",
                    "changed_keys": [],
                    "before": None,
                    "after": None,
                    "details": {
                        "date": target_date,
                        "force": force,
                        "backfill_hours": backfill_hours,
                        "last_operation": last_result.operation,
                        "exit_code": last_result.exit_code,
                    },
                }
            )
        return last_result

    @app.post(
        "/ops/state/run",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_state_run(
        request: Request,
        date: Optional[str] = Query(None, description="Optional YYYY-MM-DD target date for generated state"),
        force: bool = Query(False),
    ):
        target_date = date
        if target_date is None:
            target_date = datetime.now(ZoneInfo(active_timezone)).date().isoformat()

        args = [
            "-m",
            "community_memory.pipeline",
            "state",
            "--base",
            ops_base_arg,
            "--space",
            settings.space,
            "--date",
            target_date,
        ]
        if force:
            args.append("--force")
        result = await _run_ops_command_async("state.run", args)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "ops.state.run",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok" if result.exit_code == 0 else "error",
                "changed_keys": [],
                "before": None,
                "after": None,
                "details": {
                    "date": target_date,
                    "force": force,
                    "operation": result.operation,
                    "exit_code": result.exit_code,
                },
            }
        )
        return result

    @app.post(
        "/ops/state/backfill",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_state_backfill(
        request: Request,
        days: int = Query(30, ge=1, le=180, description="Number of days of generated state to rebuild"),
        force: bool = Query(True),
    ):
        local_today = datetime.now(ZoneInfo(active_timezone)).date()
        start_date = local_today - timedelta(days=days - 1)
        end_date = local_today
        args = [
            "-m",
            "community_memory.pipeline",
            "state",
            "--base",
            ops_base_arg,
            "--space",
            settings.space,
            "--date",
            end_date.isoformat(),
            "--from-date",
            start_date.isoformat(),
            "--to-date",
            end_date.isoformat(),
        ]
        if force:
            args.append("--force")
        result = await _run_ops_command_async("state.backfill", args)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "ops.state.backfill",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok" if result.exit_code == 0 else "error",
                "changed_keys": [],
                "before": None,
                "after": None,
                "details": {
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                    "days": days,
                    "force": force,
                    "operation": result.operation,
                    "exit_code": result.exit_code,
                },
            }
        )
        return result

    @app.post(
        "/ops/memory/backfill",
        response_model=schemas.OpsBackfillResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_memory_backfill(
        request: Request,
        days: int = Query(30, ge=1, le=90, description="Number of days to fully recompute"),
        force: bool = Query(True, description="Force-rebuild digest, memory, and seeds for each day"),
    ):
        local_today = datetime.now(ZoneInfo(active_timezone)).date()
        start_date = local_today - timedelta(days=days - 1)
        end_date = local_today

        collect_args = [
            "-m",
            "community_memory.pipeline",
            "collect",
            "--base",
            ops_base_arg,
            "--space",
            settings.space,
            "--backfill-hours",
            str(days * 24),
        ]
        if force:
            collect_args.append("--force")
        collect_result = await _run_ops_command_async("memory.collect", collect_args)

        results: list[schemas.OpsResponse] = []
        current = start_date
        while current <= end_date:
            current_iso = current.isoformat()
            for stage in ("digest", "memory", "seeds"):
                stage_args = [
                    "-m",
                    "community_memory.pipeline",
                    stage,
                    "--base",
                    ops_base_arg,
                    "--space",
                    settings.space,
                    "--date",
                    current_iso,
                ]
                if force:
                    stage_args.append("--force")
                results.append(await _run_ops_command_async(f"memory.{stage}", stage_args))
            current += timedelta(days=1)

        ok = collect_result.exit_code == 0 and all(result.exit_code == 0 for result in results)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "ops.memory.backfill",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok" if ok else "error",
                "changed_keys": [],
                "before": None,
                "after": None,
                "details": {
                    "days": days,
                    "force": force,
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                    "collect_exit_code": collect_result.exit_code,
                    "result_count": len(results),
                },
            }
        )
        return schemas.OpsBackfillResponse(
            ok=ok,
            operation="memory.backfill",
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
            days=days,
            collect=collect_result,
            results=results,
        )

    @app.post(
        "/ops/memory/repair-discord-buckets",
        response_model=schemas.DiscordBucketRepairResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_memory_repair_discord_buckets(
        request: Request,
        payload: schemas.DiscordBucketRepairRequest,
    ):
        start_date = _parse_local_date(payload.from_date, field="from_date")
        end_date = _parse_local_date(payload.to_date, field="to_date")
        if end_date < start_date:
            raise HTTPException(status_code=400, detail="to_date must be on or after from_date")

        mapping = _discord_mapping_from_request(payload.category_to_bucket)
        if not mapping:
            raise HTTPException(status_code=400, detail="No Discord category_to_bucket mapping configured")

        changes: list[dict] = []
        warnings: list[str] = []
        affected_dates: set[str] = set()
        affected_buckets: set[str] = set()
        reclassified_files = 0
        unchanged_files = 0
        unmapped_files = 0
        split_required_files = 0
        raw_paths = _raw_window_paths_for_dates(start_date, end_date)
        scanned_files = len(raw_paths)

        for raw_path in raw_paths:
            try:
                raw_payload = json.loads(raw_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                warnings.append(f"Skipped malformed raw window: {raw_path.relative_to(data_root)}")
                continue
            if not isinstance(raw_payload, dict):
                warnings.append(f"Skipped non-object raw window: {raw_path.relative_to(data_root)}")
                continue

            try:
                current_bucket = str(raw_payload.get("bucket") or raw_path.parts[-4]).strip()
                target_bucket, split_required = _target_bucket_for_raw_window(raw_payload, mapping)
                date_str = raw_path.parent.name
                if split_required:
                    split_required_files += 1
                    changes.append(
                        {
                            "path": str(raw_path.relative_to(data_root)),
                            "status": "split_required",
                            "current_bucket": current_bucket,
                        }
                    )
                    continue
                if not target_bucket:
                    unmapped_files += 1
                    changes.append(
                        {
                            "path": str(raw_path.relative_to(data_root)),
                            "status": "unmapped",
                            "current_bucket": current_bucket,
                        }
                    )
                    continue
                if target_bucket == current_bucket and raw_payload.get("bucket") == target_bucket:
                    unchanged_files += 1
                    continue

                affected_dates.add(date_str)
                affected_buckets.update({current_bucket, target_bucket})
                target_dir = data_root / "buckets" / target_bucket / "raw" / date_str
                target_json = target_dir / raw_path.name
                target_md = target_dir / f"{raw_path.stem}.md"
                source_md = raw_path.with_suffix(".md")

                change = {
                    "path": str(raw_path.relative_to(data_root)),
                    "status": "would_reclassify" if payload.dry_run else "reclassified",
                    "from_bucket": current_bucket,
                    "to_bucket": target_bucket,
                    "date": date_str,
                    "target_path": str(target_json.relative_to(data_root)),
                }
                changes.append(change)
                reclassified_files += 1

                if payload.dry_run:
                    continue

                target_dir.mkdir(parents=True, exist_ok=True)
                if target_json.resolve() == raw_path.resolve():
                    raw_payload["bucket"] = target_bucket
                    raw_path.write_text(
                        json.dumps(raw_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8",
                    )
                    _rewrite_raw_markdown_bucket(source_md, target_bucket)
                    continue
                if target_json.exists() or target_md.exists():
                    target_json, target_md = _unique_raw_destination(target_dir, raw_path.stem)
                    change["target_path"] = str(target_json.relative_to(data_root))
                raw_payload["bucket"] = target_bucket
                raw_path.write_text(
                    json.dumps(raw_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                shutil.move(str(raw_path), str(target_json))
                if source_md.is_file():
                    _rewrite_raw_markdown_bucket(source_md, target_bucket)
                    shutil.move(str(source_md), str(target_md))
            except Exception as exc:
                warnings.append(
                    f"Skipped raw window after unexpected repair error: {raw_path.relative_to(data_root)} ({exc})"
                )
                continue

        rebuild_results: list[schemas.OpsResponse] = []
        if not payload.dry_run and payload.rebuild and affected_dates:
            removed = _remove_derived_outputs(affected_dates, affected_buckets)
            if removed:
                warnings.append(f"Removed {len(removed)} stale digest file(s) before rebuild")
            for date_str in sorted(affected_dates):
                for stage in ("digest", "memory", "seeds"):
                    stage_args = [
                        "-m",
                        "community_memory.pipeline",
                        stage,
                        "--base",
                        ops_base_arg,
                        "--space",
                        settings.space,
                        "--date",
                        date_str,
                        "--force",
                    ]
                    rebuild_results.append(await _run_ops_command_async(f"memory.{stage}", stage_args))

        ok = not rebuild_results or all(result.exit_code == 0 for result in rebuild_results)
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "ops.memory.repair_discord_buckets",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "dry_run" if payload.dry_run else ("ok" if ok else "error"),
                "changed_keys": [],
                "before": None,
                "after": None,
                "details": {
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                    "dry_run": payload.dry_run,
                    "rebuild": payload.rebuild,
                    "scanned_files": scanned_files,
                    "reclassified_files": reclassified_files,
                    "unchanged_files": unchanged_files,
                    "unmapped_files": unmapped_files,
                    "split_required_files": split_required_files,
                    "affected_dates": sorted(affected_dates),
                    "affected_buckets": sorted(affected_buckets),
                },
            }
        )

        return schemas.DiscordBucketRepairResponse(
            ok=ok,
            dry_run=payload.dry_run,
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
            scanned_files=scanned_files,
            reclassified_files=reclassified_files,
            unchanged_files=unchanged_files,
            unmapped_files=unmapped_files,
            split_required_files=split_required_files,
            affected_dates=sorted(affected_dates),
            affected_buckets=sorted(affected_buckets),
            changes=changes,
            warnings=warnings,
            rebuild_results=rebuild_results,
        )

    @app.post(
        "/ops/knowledge/promote",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_knowledge_promote():
        return await _run_ops_command_async(
            "knowledge.promote",
            [
                "-m",
                "community_knowledge",
                "promote",
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
            ],
        )

    @app.post(
        "/ops/knowledge/validate",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_knowledge_validate():
        return await _run_ops_command_async(
            "knowledge.validate",
            [
                "-m",
                "community_knowledge",
                "validate",
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
            ],
        )

    @app.post(
        "/ops/knowledge/index",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_knowledge_index():
        return await _run_ops_command_async(
            "knowledge.index",
            [
                "-m",
                "community_knowledge",
                "index",
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
            ],
        )

    @app.post(
        "/ops/knowledge/run",
        response_model=schemas.OpsResponse,
        dependencies=[ops_auth_dependency],
        tags=["ops"],
    )
    async def ops_knowledge_run(request: Request):
        promote_result = await _run_ops_command_async(
            "knowledge.promote",
            [
                "-m",
                "community_knowledge",
                "promote",
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
            ],
        )
        validate_result = await _run_ops_command_async(
            "knowledge.validate",
            [
                "-m",
                "community_knowledge",
                "validate",
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
            ],
        )
        index_result = await _run_ops_command_async(
            "knowledge.index",
            [
                "-m",
                "community_knowledge",
                "index",
                "--base",
                ops_base_arg,
                "--space",
                settings.space,
            ],
        )
        _append_audit_entry(
            {
                "ts": _now_iso(),
                "action": "ops.knowledge.run",
                "actor": _audit_actor(request),
                "reason": _audit_reason(request),
                "status": "ok" if index_result.exit_code == 0 else "error",
                "changed_keys": [],
                "before": None,
                "after": None,
                "details": {
                    "stages": [promote_result.operation, validate_result.operation, index_result.operation],
                    "exit_codes": {
                        promote_result.operation: promote_result.exit_code,
                        validate_result.operation: validate_result.exit_code,
                        index_result.operation: index_result.exit_code,
                    },
                },
            }
        )
        return index_result

    return app
