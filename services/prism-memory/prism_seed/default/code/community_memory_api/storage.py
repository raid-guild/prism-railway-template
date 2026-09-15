from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


_BUCKET_RE = re.compile(r"^[a-z0-9_-]+$")
_SAFE_DOC_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
_SAFE_ARTIFACT_ID_RE = re.compile(r"^[a-zA-Z0-9._~-]+$")


class StorageError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FilesystemStorageBackend:
    """Filesystem-backed storage backend for Prism Memory artifacts."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.knowledge_root = (self.root / "knowledge" / "kb").resolve()
        self.knowledge_docs = (self.knowledge_root / "docs").resolve()
        self.knowledge_metadata = (self.knowledge_root / "metadata").resolve()
        self.knowledge_indexes = (self.knowledge_root / "indexes").resolve()
        self.knowledge_inbox = (self.knowledge_root / "triage" / "inbox").resolve()
        self.memory_inbox = (self.root / "inbox" / "memory" / "incoming").resolve()
        self.external_knowledge_inbox = (self.root / "inbox" / "knowledge").resolve()
        self._root_prefix = tuple(self.root.parts[-2:])

    def _load_json(self, path: Path) -> Any:
        if not path.is_file():
            raise StorageError("not_found", f"File not found: {path}")
        try:
            with path.open("r", encoding="utf-8") as fh:
                return json.load(fh)
        except json.JSONDecodeError as exc:
            raise StorageError("malformed_json", f"Malformed JSON: {path.name}") from exc

    def memory_latest(self) -> Any:
        return self._load_json(self.root / "memory" / "rolling" / "latest.json")

    def memory_dates(self, limit: int = 180) -> Dict[str, Any]:
        rolling_root = self.root / "memory" / "rolling"
        candidates = sorted(
            (
                path
                for path in rolling_root.glob("????-??-??.json")
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", path.name)
            ),
            reverse=True,
        )
        items: List[Dict[str, Any]] = []
        for path in candidates[:limit]:
            try:
                payload = self._load_json(path)
            except StorageError:
                continue
            sections = payload.get("sections") if isinstance(payload, dict) else {}
            sections = sections if isinstance(sections, dict) else {}
            buckets = {
                str(entry.get("bucket")).strip()
                for entries in sections.values()
                if isinstance(entries, list)
                for entry in entries
                if isinstance(entry, dict) and str(entry.get("bucket") or "").strip()
            }
            source_paths = payload.get("source_digest_paths") if isinstance(payload, dict) else []
            for source_path in source_paths if isinstance(source_paths, list) else []:
                match = re.match(r"^buckets/([^/]+)/", str(source_path))
                if match:
                    buckets.add(match.group(1))
            items.append(
                {
                    "date": path.stem,
                    "section_count": sum(1 for entries in sections.values() if isinstance(entries, list) and entries),
                    "entry_count": sum(len(entries) for entries in sections.values() if isinstance(entries, list)),
                    "bucket_count": len(buckets),
                }
            )
        return {"dates": items, "total": len(candidates), "limit": limit}

    def memory_by_date(self, date_str: str) -> Any:
        self._validate_date(date_str)
        return self._load_json(self.root / "memory" / "rolling" / f"{date_str}.json")

    def state_latest(self) -> Any:
        return self._load_json(self.root / "state" / "latest.json")

    def state_projects(self) -> Any:
        return self._load_json(self.root / "state" / "current" / "projects.json")

    def state_signals(
        self,
        anchor: Optional[str] = None,
        kind: Optional[str] = None,
        source: Optional[str] = None,
        objective_key: Optional[str] = None,
        throughline_key: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any:
        payload = self._load_json(self.root / "state" / "current" / "signals.json")
        signals = [item for item in payload.get("signals", []) if isinstance(item, dict)]
        objective_signal_ids: set[str] = set()
        if objective_key:
            try:
                objectives_payload = self._load_json(self.root / "state" / "current" / "objectives.json")
            except StorageError:
                objectives_payload = {}
            objectives = objectives_payload.get("objectives", []) if isinstance(objectives_payload, dict) else []
            for objective in objectives:
                if not isinstance(objective, dict):
                    continue
                if str(objective.get("objective_key") or "") != objective_key:
                    continue
                objective_signal_ids = {
                    str(signal_id)
                    for signal_id in objective.get("signal_ids", [])
                    if str(signal_id).strip()
                }
                break
        if anchor:
            signals = [item for item in signals if str(item.get("anchor") or "") == anchor]
        if kind:
            signals = [item for item in signals if str(item.get("kind") or "") == kind]
        if source:
            signals = [item for item in signals if str(item.get("source") or "") == source]
        if objective_key:
            signals = [
                item for item in signals
                if str(item.get("objective_key") or "") == objective_key
                or str(item.get("signal_id") or "") in objective_signal_ids
            ]
        if throughline_key:
            signals = [item for item in signals if str(item.get("throughline_key") or "") == throughline_key]
        if limit is not None:
            signals = signals[-limit:]
        result = dict(payload)
        result["signals"] = signals
        result["total"] = len(signals)
        return result

    def state_objectives(
        self,
        status: Optional[str] = None,
        source: Optional[str] = None,
        external_system: Optional[str] = None,
        objective_key: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any:
        payload = self._load_json(self.root / "state" / "current" / "objectives.json")
        objectives = [item for item in payload.get("objectives", []) if isinstance(item, dict)]
        if status:
            objectives = [item for item in objectives if str(item.get("status") or "") == status]
        if source:
            objectives = [
                item for item in objectives
                if source in [str(value) for value in item.get("sources", [])]
            ]
        if external_system:
            objectives = [
                item for item in objectives
                if any(
                    isinstance(ref, dict) and str(ref.get("system") or "") == external_system
                    for ref in item.get("external_refs", [])
                )
            ]
        if objective_key:
            objectives = [item for item in objectives if str(item.get("objective_key") or "") == objective_key]
        if limit is not None:
            objectives = objectives[:limit]
        result = dict(payload)
        result["objectives"] = objectives
        result["total"] = len(objectives)
        return result

    def state_throughlines(
        self,
        status: Optional[str] = None,
        throughline_key: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any:
        payload = self._load_json(self.root / "state" / "current" / "throughlines.json")
        throughlines = [item for item in payload.get("throughlines", []) if isinstance(item, dict)]
        if status:
            throughlines = [item for item in throughlines if str(item.get("status") or "") == status]
        if throughline_key:
            throughlines = [item for item in throughlines if str(item.get("throughline_key") or "") == throughline_key]
        if limit is not None:
            throughlines = throughlines[:limit]
        result = dict(payload)
        result["throughlines"] = throughlines
        result["total"] = len(throughlines)
        return result

    def upsert_state_project(self, project_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized_key = self._safe_slug(project_key)
        if not normalized_key:
            raise StorageError("invalid_project_key", "project_key is required")

        current_path = self.root / "state" / "current" / "projects.json"
        latest_path = self.root / "state" / "latest.json"
        existing = {"generated_at": None, "as_of_date": None, "projects": []}
        if current_path.is_file():
            loaded = self._load_json(current_path)
            if isinstance(loaded, dict):
                existing.update(loaded)

        projects = [item for item in existing.get("projects", []) if isinstance(item, dict)]
        project = None
        for item in projects:
            if self._safe_slug(str(item.get("project_key", ""))) == normalized_key:
                project = item
                break
        if project is None:
            project = {
                "project_key": normalized_key,
                "display_name": normalized_key.replace("-", " ").title(),
                "description": "",
                "status": "inactive",
                "archived": False,
                "source_channels": [],
                "aliases": [],
                "tags": [],
                "owners": [],
                "last_direct_activity_at": None,
                "last_indirect_activity_at": None,
                "derived_from": ["manual"],
                "activity_score": 0.0,
                "review_by": None,
                "source": {"mode": "manual"},
            }
            projects.append(project)
        else:
            project.setdefault("display_name", normalized_key.replace("-", " ").title())
            project.setdefault("description", "")
            project.setdefault("aliases", [])
            project.setdefault("tags", [])
            project.setdefault("owners", [])
            project.setdefault("source_channels", [])
            project.setdefault("derived_from", [])
            project.setdefault("source", {"mode": "manual"})

        if "display_name" in payload and payload["display_name"] is not None:
            project["display_name"] = str(payload["display_name"]).strip() or project["display_name"]
        if "description" in payload and payload["description"] is not None:
            project["description"] = str(payload["description"]).strip()
        if "aliases" in payload and payload["aliases"] is not None:
            project["aliases"] = self._coerce_str_list(payload["aliases"])
        if "tags" in payload and payload["tags"] is not None:
            project["tags"] = self._coerce_str_list(payload["tags"])
        if "owners" in payload and payload["owners"] is not None:
            project["owners"] = self._coerce_str_list(payload["owners"])
        if "archived" in payload and payload["archived"] is not None:
            project["archived"] = bool(payload["archived"])

        generated_at = self._to_iso(datetime.now(timezone.utc))
        as_of_date = datetime.now(timezone.utc).date().isoformat()
        projects.sort(key=lambda item: str(item.get("project_key", "")))
        current_payload = {
            "generated_at": generated_at,
            "as_of_date": as_of_date,
            "projects": projects,
        }
        current_path.parent.mkdir(parents=True, exist_ok=True)
        with current_path.open("w", encoding="utf-8") as handle:
            json.dump(current_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        counts = {"active": 0, "watching": 0, "inactive": 0, "archived": 0}
        for item in projects:
            status = str(item.get("status") or "inactive")
            if bool(item.get("archived", False)):
                status = "archived"
            if status not in counts:
                status = "inactive"
            counts[status] += 1
        latest_payload = {
            "generated_at": generated_at,
            "domains": {
                "projects": {
                    "source_path": "state/current/projects.json",
                    "updated_at": generated_at,
                    "summary": (
                        f"{counts['active']} active, {counts['watching']} watching, "
                        f"{counts['inactive']} inactive, {counts['archived']} archived."
                    ),
                }
            },
            "recent_changes": [
                {
                    "domain": "projects",
                    "change_type": "updated",
                    "summary": f"Project '{normalized_key}' metadata updated.",
                    "updated_at": generated_at,
                    "source_path": "state/current/projects.json",
                }
            ],
        }
        latest_path.parent.mkdir(parents=True, exist_ok=True)
        with latest_path.open("w", encoding="utf-8") as handle:
            json.dump(latest_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        return {
            "path": str(current_path.relative_to(self.root)),
            "latest_path": str(latest_path.relative_to(self.root)),
            "project_key": normalized_key,
            "updated_at": generated_at,
            "project": project,
        }

    def patch_state_throughline(self, throughline_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        source_key = self._safe_state_key(throughline_key)
        if not source_key:
            raise StorageError("invalid_throughline_key", "throughline_key is required")

        target_key = self._safe_state_key(str(payload.get("throughline_key") or source_key))
        if not target_key:
            raise StorageError("invalid_throughline_key", "throughline_key is required")

        current_payload = self._load_throughlines_current()
        curation_payload = self._load_throughline_curation()
        throughlines = [
            item for item in current_payload.get("throughlines", [])
            if isinstance(item, dict)
        ]
        throughline = self._find_throughline(throughlines, source_key)
        if throughline is None:
            throughline = self._blank_throughline(source_key)
            throughlines.append(throughline)

        if target_key != source_key:
            existing_target = self._find_throughline(throughlines, target_key)
            if existing_target is not None:
                throughline = self._merge_throughline_items(existing_target, throughline)
                throughlines = [
                    item for item in throughlines
                    if self._safe_state_key(str(item.get("throughline_key", ""))) != source_key
                ]
            else:
                throughline["throughline_key"] = target_key
            self._record_throughline_merge(curation_payload, source_key, target_key)
            curation_payload.setdefault("throughlines", {}).pop(source_key, None)

        self._apply_throughline_patch(throughline, payload)
        curation_entry = self._curation_entry_from_patch(target_key, payload)
        throughline_overrides = curation_payload.setdefault("throughlines", {})
        existing_curation = throughline_overrides.get(target_key)
        if not isinstance(existing_curation, dict):
            existing_curation = {}
        existing_curation.update(curation_entry)
        throughline_overrides[target_key] = existing_curation

        if bool(existing_curation.get("hidden")):
            throughlines = [
                item for item in throughlines
                if self._safe_state_key(str(item.get("throughline_key", ""))) != target_key
            ]
            throughline = None

        return self._write_throughline_state(
            current_payload=current_payload,
            curation_payload=curation_payload,
            throughlines=throughlines,
            throughline_key=target_key,
            throughline=throughline,
        )

    def merge_state_throughline(self, throughline_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        source_key = self._safe_state_key(throughline_key)
        target_key = self._safe_state_key(str(payload.get("target_key") or ""))
        if not source_key or not target_key:
            raise StorageError("invalid_throughline_key", "source and target throughline keys are required")
        if source_key == target_key:
            raise StorageError("invalid_throughline_merge", "source and target throughline keys must differ")

        current_payload = self._load_throughlines_current()
        curation_payload = self._load_throughline_curation()
        throughlines = [
            item for item in current_payload.get("throughlines", [])
            if isinstance(item, dict)
        ]
        source = self._find_throughline(throughlines, source_key)
        target = self._find_throughline(throughlines, target_key)
        if source is None:
            source = self._blank_throughline(source_key)
        if target is None:
            target = self._blank_throughline(target_key)
            throughlines.append(target)

        target = self._merge_throughline_items(target, source)
        merge_patch = {
            "title": payload.get("title"),
            "summary": payload.get("summary"),
            "aliases": payload.get("aliases"),
        }
        self._apply_throughline_patch(target, merge_patch)
        throughlines = [
            item for item in throughlines
            if self._safe_state_key(str(item.get("throughline_key", ""))) != source_key
        ]

        self._record_throughline_merge(curation_payload, source_key, target_key)
        overrides = curation_payload.setdefault("throughlines", {})
        source_override = overrides.get(source_key)
        if not isinstance(source_override, dict):
            source_override = {}
        source_override.update({"hidden": True, "merge_into": target_key})
        if payload.get("reason"):
            source_override["notes"] = str(payload.get("reason") or "").strip()
        overrides[source_key] = source_override

        target_override = overrides.get(target_key)
        if not isinstance(target_override, dict):
            target_override = {}
        target_override.update(self._curation_entry_from_patch(target_key, merge_patch))
        target_aliases = self._coerce_str_list(target_override.get("aliases", []))
        for alias in [source_key, str(source.get("title") or "")]:
            alias = alias.strip()
            if alias and alias not in target_aliases:
                target_aliases.append(alias)
        target_override["aliases"] = target_aliases
        overrides[target_key] = target_override

        return self._write_throughline_state(
            current_payload=current_payload,
            curation_payload=curation_payload,
            throughlines=throughlines,
            throughline_key=target_key,
            throughline=target,
        )

    def delete_state_throughline(self, throughline_key: str) -> Dict[str, Any]:
        normalized_key = self._safe_state_key(throughline_key)
        if not normalized_key:
            raise StorageError("invalid_throughline_key", "throughline_key is required")

        current_payload = self._load_throughlines_current()
        curation_payload = self._load_throughline_curation()
        throughlines = [
            item for item in current_payload.get("throughlines", [])
            if isinstance(item, dict)
            and self._safe_state_key(str(item.get("throughline_key", ""))) != normalized_key
        ]
        overrides = curation_payload.setdefault("throughlines", {})
        existing = overrides.get(normalized_key)
        if not isinstance(existing, dict):
            existing = {}
        existing.update({"hidden": True, "archived": True, "status": "archived"})
        overrides[normalized_key] = existing

        return self._write_throughline_state(
            current_payload=current_payload,
            curation_payload=curation_payload,
            throughlines=throughlines,
            throughline_key=normalized_key,
            throughline=None,
        )

    def digests_by_date(self, date_str: str) -> Dict[str, Any]:
        self._validate_date(date_str)
        buckets_dir = self.root / "buckets"
        result: Dict[str, Any] = {}
        if not buckets_dir.is_dir():
            raise StorageError("not_found", "No buckets directory present")
        for bucket_path in buckets_dir.iterdir():
            if not bucket_path.is_dir():
                continue
            digest_path = bucket_path / "digests" / f"{date_str}.json"
            if digest_path.is_file():
                result[bucket_path.name] = self._load_json(digest_path)
        if not result:
            raise StorageError("not_found", f"No digests found for {date_str}")
        return {"date": date_str, "buckets": result}

    def digest_for_bucket(self, bucket: str, date_str: str) -> Any:
        self._validate_date(date_str)
        self._validate_bucket(bucket)
        digest_path = self.root / "buckets" / bucket / "digests" / f"{date_str}.json"
        return self._load_json(digest_path)

    def bucket_digest_asset(self, bucket: str, date_str: str, extension: str) -> tuple[str, Any]:
        self._validate_date(date_str)
        self._validate_bucket(bucket)
        ext = extension.lower().lstrip(".")
        if ext not in {"json", "md"}:
            raise StorageError("invalid_format", "Digest format must be 'json' or 'md'")
        digest_path = self.root / "buckets" / bucket / "digests" / f"{date_str}.{ext}"
        if ext == "json":
            return ("application/json", self._load_json(digest_path))
        if not digest_path.is_file():
            raise StorageError("not_found", f"File not found: {digest_path}")
        try:
            content = digest_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise StorageError("not_found", f"Unable to read digest: {digest_path}") from exc
        return ("text/markdown", content)

    def activity_recent(
        self,
        limit: int = 100,
        event_type: Optional[str] = None,
        bucket: Optional[str] = None,
        collector_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        log_path = self.root / "activity" / "activity.jsonl"
        if not log_path.is_file():
            raise StorageError("not_found", "activity log missing")
        try:
            lines = log_path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise StorageError("not_found", "Unable to read activity log") from exc
        entries: List[Dict[str, Any]] = []
        for raw in reversed(lines):
            raw = raw.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError:
                # skip malformed lines but keep processing
                continue
            if event_type and record.get("type") != event_type:
                continue
            if bucket and record.get("meta", {}).get("bucket") != bucket:
                continue
            if collector_key and record.get("meta", {}).get("collector_key") != collector_key:
                continue
            entries.append(record)
            if len(entries) >= limit:
                break
        return entries

    def participant_activity(
        self,
        *,
        start: str,
        end: str,
        bucket: Optional[str] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        start_dt = self._parse_iso_datetime(start, field="start")
        end_dt = self._parse_iso_datetime(end, field="end")
        if end_dt <= start_dt:
            raise StorageError("invalid_query", "end must be later than start")
        if bucket:
            self._validate_bucket(bucket)

        buckets_dir = self.root / "buckets"
        if not buckets_dir.is_dir():
            raise StorageError("not_found", "No buckets directory present")

        participant_map: Dict[str, Dict[str, Any]] = {}
        for raw_path in self._iter_raw_window_paths(start_dt, end_dt, bucket=bucket):
            payload = self._load_json(raw_path)
            bucket_name = str(payload.get("bucket") or raw_path.parts[-4])
            for channel in payload.get("channels", []):
                channel_name = str(channel.get("channel_name") or channel.get("channel_id") or "unknown")
                channel_topic = str(channel.get("channel_topic") or "")
                source_names = self._channel_sources(channel_name, channel_topic)
                for message in channel.get("messages", []):
                    created_raw = message.get("created_at")
                    if not created_raw:
                        continue
                    try:
                        created_dt = self._parse_iso_datetime(str(created_raw), field="created_at")
                    except StorageError:
                        continue
                    if created_dt < start_dt or created_dt >= end_dt:
                        continue
                    author_name = self._message_author(message)
                    if not author_name:
                        continue
                    entry = participant_map.setdefault(
                        author_name,
                        {
                            "participant": author_name,
                            "message_count": 0,
                            "first_seen": created_dt,
                            "last_seen": created_dt,
                            "buckets": set(),
                            "channels": set(),
                            "sources": set(),
                            "participant_mentions": 0,
                        },
                    )
                    entry["message_count"] += 1
                    if created_dt < entry["first_seen"]:
                        entry["first_seen"] = created_dt
                    if created_dt > entry["last_seen"]:
                        entry["last_seen"] = created_dt
                    entry["buckets"].add(bucket_name)
                    entry["channels"].add(channel_name)
                    entry["sources"].update(source_names)

                    metadata = message.get("metadata") or {}
                    for participant in self._coerce_str_list(metadata.get("participants")):
                        if participant == author_name:
                            continue
                        mention_entry = participant_map.setdefault(
                            participant,
                            {
                                "participant": participant,
                                "message_count": 0,
                                "first_seen": created_dt,
                                "last_seen": created_dt,
                                "buckets": set(),
                                "channels": set(),
                                "sources": set(),
                                "participant_mentions": 0,
                            },
                        )
                        if created_dt < mention_entry["first_seen"]:
                            mention_entry["first_seen"] = created_dt
                        if created_dt > mention_entry["last_seen"]:
                            mention_entry["last_seen"] = created_dt
                        mention_entry["buckets"].add(bucket_name)
                        mention_entry["channels"].add(channel_name)
                        mention_entry["sources"].update(source_names)
                        mention_entry["participant_mentions"] += 1

        results = [
            {
                "participant": item["participant"],
                "message_count": item["message_count"],
                "bucket_count": len(item["buckets"]),
                "channel_count": len(item["channels"]),
                "first_seen": self._to_iso(item["first_seen"]),
                "last_seen": self._to_iso(item["last_seen"]),
                "buckets": sorted(item["buckets"]),
                "channels": sorted(item["channels"]),
                "sources": sorted(item["sources"]),
                "participant_mentions": item["participant_mentions"],
            }
            for item in participant_map.values()
        ]
        results.sort(
            key=lambda item: (
                -item["message_count"],
                -item["participant_mentions"],
                item["participant"].lower(),
            )
        )
        return {
            "start": self._to_iso(start_dt),
            "end": self._to_iso(end_dt),
            "bucket": bucket,
            "limit": limit,
            "total_participants": len(results),
            "results": results[:limit],
        }

    def knowledge_doc(self, slug: str) -> Dict[str, Any]:
        normalized, entry = self._resolve_manifest_entry(slug)
        doc_path = self._rooted_path(entry["path"])
        meta_path = self._rooted_path(entry["meta_path"])
        if not doc_path.is_file():
            raise StorageError("not_found", f"Knowledge doc missing at {doc_path}")
        metadata = self._load_json(meta_path)
        try:
            content = doc_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise StorageError("not_found", f"Unable to read document body: {doc_path}") from exc
        doc_slug = metadata.get("slug") or normalized
        return {
            "slug": doc_slug,
            "path": str(doc_path.relative_to(self.root)),
            "meta_path": str(meta_path.relative_to(self.root)),
            "kind": metadata.get("kind"),
            "title": metadata.get("title"),
            "summary": metadata.get("summary"),
            "updated": metadata.get("updated"),
            "tags": metadata.get("tags"),
            "entities": metadata.get("entities"),
            "source_id": metadata.get("source_id"),
            "source_kind": metadata.get("source_kind"),
            "source_repo": metadata.get("source_repo"),
            "source_branch": metadata.get("source_branch"),
            "source_path": metadata.get("source_path"),
            "source_profile": metadata.get("source_profile"),
            "document_class": metadata.get("document_class"),
            "historical": metadata.get("historical"),
            "doc_url": f"/knowledge/view/{doc_slug}",
            "doc_api_url": f"/knowledge/docs/{doc_slug}",
            "source_url": self._source_url_for_metadata(metadata),
            "metadata": metadata,
            "content": content,
        }

    def knowledge_search(
        self,
        query: Optional[str] = None,
        kind: Optional[str] = None,
        tag: Optional[str] = None,
        entity: Optional[str] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        if not any([query, kind, tag, entity]):
            raise StorageError("invalid_query", "Provide at least one of q, kind, tag, or entity")
        normalized_query = (query or "").strip().lower()
        tokens = tuple(dict.fromkeys(token for token in normalized_query.split() if token))
        manifest = self._load_manifest()
        results: List[Dict[str, Any]] = []
        for entry in manifest:
            if kind and entry.get("kind") != kind:
                continue
            tags_list = entry.get("tags") or []
            entities_list = entry.get("entities") or []
            if tag and tag not in tags_list:
                continue
            if entity and entity not in entities_list:
                continue
            matched_tokens: Set[str] = set()
            match_sources: List[str] = []
            metadata_hits: Set[str] = set()
            body_hits: Set[str] = set()
            if tokens:
                haystack = " ".join(
                    [
                        entry.get("title", ""),
                        entry.get("summary", ""),
                        " ".join(tags_list),
                        " ".join(entities_list),
                    ]
                ).lower()
                metadata_hits = self._tokens_in_text(haystack, tokens)
                if metadata_hits:
                    matched_tokens.update(metadata_hits)
                    match_sources.append("metadata")
                if len(matched_tokens) < len(tokens):
                    body_hits = self._tokens_in_doc(entry, tokens)
                    if body_hits:
                        matched_tokens.update(body_hits)
                        match_sources.append("body")
                if not matched_tokens:
                    continue
                score = len(matched_tokens)
            else:
                score = 1
            slug_value = self._slug_from_entry(entry)
            results.append(
                {
                    "slug": slug_value,
                    "title": entry.get("title"),
                    "summary": entry.get("summary"),
                    "kind": entry.get("kind"),
                    "updated": entry.get("updated"),
                    "tags": tags_list,
                    "entities": entities_list,
                    "path": entry.get("path"),
                    "meta_path": entry.get("meta_path"),
                    "source_id": entry.get("source_id"),
                    "source_kind": entry.get("source_kind"),
                    "source_repo": entry.get("source_repo"),
                    "source_branch": entry.get("source_branch"),
                    "source_path": entry.get("source_path"),
                    "source_profile": entry.get("source_profile"),
                    "document_class": entry.get("document_class"),
                    "historical": entry.get("historical"),
                    "doc_url": f"/knowledge/view/{slug_value}",
                    "doc_api_url": f"/knowledge/docs/{slug_value}",
                    "source_url": self._source_url_for_entry(entry),
                    "score": score,
                    "match_tokens": sorted(matched_tokens) if matched_tokens else [],
                    "match_sources": match_sources,
                }
            )
        results.sort(key=lambda item: (-item["score"], item.get("title") or ""))
        return {
            "query": query,
            "filters": {
                "kind": kind,
                "tag": tag,
                "entity": entity,
            },
            "total": len(results),
            "results": results[:limit],
        }

    def knowledge_index(self, name: str) -> Any:
        allowed = {"manifest", "tags", "entities"}
        if name not in allowed:
            raise StorageError("invalid_query", f"Unsupported knowledge index '{name}'")
        path = self.knowledge_indexes / f"{name}.json"
        return self._load_json(path)

    def list_artifacts(
        self,
        *,
        artifact_type: Optional[str] = None,
        source: Optional[str] = None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        results: List[Dict[str, Any]] = []
        if category and category not in {"memory", "knowledge"}:
            raise StorageError("invalid_query", "category must be memory or knowledge")
        if not category or category == "memory":
            results.extend(self._list_memory_artifacts(artifact_type=artifact_type, source=source, status=status))
        if not category or category == "knowledge":
            results.extend(self._list_knowledge_artifacts(artifact_type=artifact_type, source=source, status=status))

        results.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return {
            "artifacts": results[:limit],
            "total": len(results),
            "limit": limit,
            "filters": {
                "type": artifact_type,
                "source": source,
                "status": status,
                "category": category,
            },
        }

    def artifact_detail(self, artifact_id: str) -> Dict[str, Any]:
        path, status, category = self._resolve_artifact_path(artifact_id)
        item = self._artifact_summary_from_path(path, status)
        if category == "memory":
            payload = self._load_json(path)
            item["content"] = str(payload.get("content") or "")
            item["payload"] = payload
        else:
            item["content"] = self._read_text(path)
            item["payload"] = self._knowledge_payload_for_path(path)
        return item

    def artifact_raw(self, artifact_id: str) -> Tuple[str, str]:
        path, _status, category = self._resolve_artifact_path(artifact_id)
        try:
            media_type = "application/json" if path.suffix.lower() == ".json" else "text/markdown; charset=utf-8"
            if category == "memory":
                media_type = "application/json"
            return (media_type, path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise StorageError("not_found", f"Unable to read artifact: {artifact_id}") from exc

    def product_suggestion_latest(self) -> Any:
        suggestions_dir = self.root / "products" / "suggestions"
        candidates = sorted(
            path
            for path in suggestions_dir.glob("????-??-??.json")
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", path.name)
        )
        if not candidates:
            raise StorageError("not_found", "No daily product suggestions found")
        return self._load_json(candidates[-1])

    def product_suggestion_by_date(self, date_str: str) -> Any:
        self._validate_date(date_str)
        path = self.root / "products" / "suggestions" / f"{date_str}.json"
        return self._load_json(path)

    def product_suggestion_weekly(self, week_key: str) -> Any:
        self._validate_week(week_key)
        path = self.root / "products" / "suggestions" / f"weekly-{week_key}.json"
        return self._load_json(path)

    def _load_throughlines_current(self) -> Dict[str, Any]:
        path = self.root / "state" / "current" / "throughlines.json"
        if path.is_file():
            loaded = self._load_json(path)
            if isinstance(loaded, dict):
                loaded.setdefault("throughlines", [])
                return loaded
        return {"generated_at": None, "as_of_date": None, "throughlines": []}

    def _load_throughline_curation(self) -> Dict[str, Any]:
        path = self.root / "state" / "curation" / "throughlines.json"
        if path.is_file():
            loaded = self._load_json(path)
            if isinstance(loaded, dict):
                loaded.setdefault("throughlines", {})
                loaded.setdefault("merges", {})
                return loaded
        return {"updated_at": None, "throughlines": {}, "merges": {}}

    def _write_throughline_state(
        self,
        *,
        current_payload: Dict[str, Any],
        curation_payload: Dict[str, Any],
        throughlines: List[Dict[str, Any]],
        throughline_key: str,
        throughline: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        generated_at = self._to_iso(datetime.now(timezone.utc))
        current_path = self.root / "state" / "current" / "throughlines.json"
        curation_path = self.root / "state" / "curation" / "throughlines.json"
        latest_path = self.root / "state" / "latest.json"

        throughlines = self._sort_throughlines(throughlines)
        current_payload.update(
            {
                "generated_at": generated_at,
                "as_of_date": current_payload.get("as_of_date") or datetime.now(timezone.utc).date().isoformat(),
                "throughlines": throughlines,
            }
        )
        curation_payload["updated_at"] = generated_at

        current_path.parent.mkdir(parents=True, exist_ok=True)
        with current_path.open("w", encoding="utf-8") as handle:
            json.dump(current_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        curation_path.parent.mkdir(parents=True, exist_ok=True)
        with curation_path.open("w", encoding="utf-8") as handle:
            json.dump(curation_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        latest_payload: Dict[str, Any] = {}
        if latest_path.is_file():
            loaded = self._load_json(latest_path)
            if isinstance(loaded, dict):
                latest_payload = loaded
        domains = latest_payload.get("domains") if isinstance(latest_payload.get("domains"), dict) else {}
        counts = {"active": 0, "watching": 0, "inactive": 0, "archived": 0}
        for item in throughlines:
            status = str(item.get("status") or "inactive")
            if status not in counts:
                status = "inactive"
            counts[status] += 1
        domains["throughlines"] = {
            "source_path": "state/current/throughlines.json",
            "updated_at": generated_at,
            "summary": (
                f"{counts['active']} active, {counts['watching']} watching, "
                f"{counts['inactive']} inactive, {counts['archived']} archived."
            ),
        }
        recent_changes = [
            item for item in latest_payload.get("recent_changes", []) if isinstance(item, dict)
        ] if isinstance(latest_payload.get("recent_changes"), list) else []
        recent_changes.insert(
            0,
            {
                "domain": "throughlines",
                "change_type": "curated",
                "summary": f"Throughline '{throughline_key}' curated.",
                "updated_at": generated_at,
                "source_path": "state/current/throughlines.json",
            },
        )
        latest_payload.update(
            {
                "generated_at": generated_at,
                "domains": domains,
                "recent_changes": recent_changes[:20],
            }
        )
        latest_path.parent.mkdir(parents=True, exist_ok=True)
        with latest_path.open("w", encoding="utf-8") as handle:
            json.dump(latest_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        return {
            "path": str(current_path.relative_to(self.root)),
            "curation_path": str(curation_path.relative_to(self.root)),
            "latest_path": str(latest_path.relative_to(self.root)),
            "throughline_key": throughline_key,
            "updated_at": generated_at,
            "throughline": throughline,
            "curation": curation_payload,
        }

    def _apply_throughline_patch(self, throughline: Dict[str, Any], payload: Dict[str, Any]) -> None:
        for field in ("title", "summary", "kind", "notes"):
            if field in payload and payload[field] is not None:
                throughline[field] = str(payload[field]).strip()
        if "status" in payload and payload["status"] is not None:
            status = str(payload["status"]).strip().lower()
            if status not in {"active", "watching", "inactive", "archived"}:
                raise StorageError("invalid_status", "status must be active, watching, inactive, or archived")
            throughline["status"] = status
        if "aliases" in payload and payload["aliases"] is not None:
            throughline["aliases"] = self._coerce_str_list(payload["aliases"])
        if "tags" in payload and payload["tags"] is not None:
            throughline["tags"] = self._coerce_str_list(payload["tags"])
        if "owners" in payload and payload["owners"] is not None:
            throughline["owners"] = self._coerce_str_list(payload["owners"])
        if "objective_keys" in payload and payload["objective_keys"] is not None:
            throughline["objective_keys"] = self._coerce_str_list(payload["objective_keys"])
        if "external_refs" in payload and payload["external_refs"] is not None:
            throughline["external_refs"] = [
                item for item in payload["external_refs"] if isinstance(item, dict)
            ]
        if "pinned" in payload and payload["pinned"] is not None:
            throughline["pinned"] = bool(payload["pinned"])
        if "archived" in payload and payload["archived"] is not None:
            throughline["archived"] = bool(payload["archived"])
            if bool(payload["archived"]):
                throughline["status"] = "archived"
        throughline["curation_applied"] = True

    def _curation_entry_from_patch(self, throughline_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        entry: Dict[str, Any] = {"throughline_key": throughline_key}
        for field in (
            "title",
            "summary",
            "status",
            "kind",
            "aliases",
            "tags",
            "owners",
            "objective_keys",
            "external_refs",
            "pinned",
            "archived",
            "hidden",
            "notes",
        ):
            if field in payload and payload[field] is not None:
                if field in {"aliases", "tags", "owners", "objective_keys"}:
                    entry[field] = self._coerce_str_list(payload[field])
                else:
                    entry[field] = payload[field]
        return entry

    def _record_throughline_merge(self, curation_payload: Dict[str, Any], source_key: str, target_key: str) -> None:
        merges = curation_payload.setdefault("merges", {})
        merges[source_key] = target_key

    def _find_throughline(self, throughlines: List[Dict[str, Any]], throughline_key: str) -> Optional[Dict[str, Any]]:
        for item in throughlines:
            if self._safe_state_key(str(item.get("throughline_key", ""))) == throughline_key:
                return item
        return None

    def _blank_throughline(self, throughline_key: str) -> Dict[str, Any]:
        return {
            "throughline_key": throughline_key,
            "title": throughline_key.replace("-", " ").title(),
            "summary": "",
            "status": "inactive",
            "objective_keys": [],
            "signal_ids": [],
            "last_signal_at": None,
            "enrichment_status": "manual",
            "activity_score": 0.0,
            "attention_score": 0.0,
            "score_reasons": ["manual curation"],
            "curation_applied": True,
        }

    def _merge_throughline_items(self, target: Dict[str, Any], source: Dict[str, Any]) -> Dict[str, Any]:
        target["throughline_key"] = self._safe_state_key(str(target.get("throughline_key") or ""))
        if not target.get("title"):
            target["title"] = source.get("title") or target["throughline_key"].replace("-", " ").title()
        if not target.get("summary") and source.get("summary"):
            target["summary"] = source.get("summary")
        for field in ("objective_keys", "signal_ids", "aliases", "tags", "owners"):
            merged = self._coerce_str_list(target.get(field, []))
            for item in self._coerce_str_list(source.get(field, [])):
                if item not in merged:
                    merged.append(item)
            if merged:
                target[field] = merged
        target["last_signal_at"] = self._max_iso(target.get("last_signal_at"), source.get("last_signal_at"))
        target["activity_score"] = max(float(target.get("activity_score") or 0.0), float(source.get("activity_score") or 0.0))
        target["attention_score"] = max(float(target.get("attention_score") or 0.0), float(source.get("attention_score") or 0.0))
        source_key = str(source.get("throughline_key") or "").strip()
        if source_key:
            aliases = self._coerce_str_list(target.get("aliases", []))
            if source_key not in aliases:
                aliases.append(source_key)
            target["aliases"] = aliases
        target["curation_applied"] = True
        return target

    def _sort_throughlines(self, throughlines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        status_rank = {"active": 3, "watching": 2, "inactive": 1, "archived": 0}
        return sorted(
            throughlines,
            key=lambda item: (
                bool(item.get("pinned")),
                status_rank.get(str(item.get("status") or "inactive"), 0),
                float(item.get("activity_score") or 0.0),
                float(item.get("attention_score") or 0.0),
                str(item.get("last_signal_at") or ""),
                str(item.get("throughline_key") or ""),
            ),
            reverse=True,
        )

    @staticmethod
    def _max_iso(first: Any, second: Any) -> Any:
        def parse(value: Any) -> Optional[datetime]:
            text = str(value or "").strip()
            if not text:
                return None
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            try:
                return datetime.fromisoformat(text).astimezone(timezone.utc)
            except ValueError:
                return None

        first_dt = parse(first)
        second_dt = parse(second)
        if first_dt is None:
            return second
        if second_dt is None:
            return first
        return first if first_dt >= second_dt else second

    def _artifact_summary_from_path(self, path: Path, status: str) -> Dict[str, Any]:
        if path.suffix.lower() == ".json":
            payload = self._load_json(path)
        else:
            payload = {}
        content = str(payload.get("content") or "")
        if not content and path.suffix.lower() in {".md", ".markdown", ".txt"}:
            content = self._read_text(path)
        stat = path.stat()
        created_at = str(payload.get("ts") or self._to_iso(datetime.fromtimestamp(stat.st_mtime, timezone.utc)))
        participants = self._coerce_str_list(payload.get("participants"))
        participant_count = payload.get("participant_count")
        if participant_count is not None:
            try:
                participant_count = int(participant_count)
            except (TypeError, ValueError):
                participant_count = None
        return {
            "id": self._artifact_id_for_path(path, status),
            "category": self._artifact_category_for_path(path),
            "status": status,
            "path": str(path.relative_to(self.root)),
            "filename": path.name,
            "source": str(payload.get("source")) if payload.get("source") is not None else self._artifact_source_for_path(path),
            "type": str(payload.get("type")) if payload.get("type") is not None else self._artifact_type_for_path(path),
            "created_at": created_at,
            "bucket": str(payload.get("bucket")) if payload.get("bucket") is not None else None,
            "author": str(payload.get("author")) if payload.get("author") is not None else None,
            "url": str(payload.get("url")) if payload.get("url") is not None else None,
            "participants": participants or None,
            "participant_count": participant_count,
            "content_length": len(content),
            "preview": content[:240],
        }

    def _resolve_artifact_path(self, artifact_id: str) -> Tuple[Path, str, str]:
        normalized = artifact_id.strip().removesuffix(".json")
        if not normalized or not _SAFE_ARTIFACT_ID_RE.fullmatch(normalized):
            raise StorageError("invalid_query", "Invalid artifact id")
        matches: List[Tuple[Path, str, str]] = []
        for status in ("incoming", "processed", "rejected"):
            candidate = self.root / "inbox" / "memory" / status / f"{normalized}.json"
            if candidate.is_file():
                matches.append((candidate, status, "memory"))
        for item in self._list_knowledge_artifacts():
            if item.get("id") == normalized:
                matches.append((self.root / str(item["path"]), str(item["status"]), "knowledge"))
        if not matches:
            raise StorageError("not_found", f"Artifact not found: {artifact_id}")
        if len(matches) > 1:
            raise StorageError("ambiguous_slug", f"Artifact id matched multiple files: {artifact_id}")
        return matches[0]

    def _list_memory_artifacts(
        self,
        *,
        artifact_type: Optional[str] = None,
        source: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        statuses = [status] if status else ["incoming", "processed", "rejected"]
        for item_status in statuses:
            if item_status not in {"incoming", "processed", "rejected"}:
                raise StorageError("invalid_query", "status must be incoming, processed, or rejected")
            inbox_dir = self.root / "inbox" / "memory" / item_status
            if not inbox_dir.is_dir():
                continue
            for path in sorted(inbox_dir.glob("*.json")):
                try:
                    item = self._artifact_summary_from_path(path, item_status)
                except StorageError:
                    continue
                if artifact_type and item.get("type") != artifact_type:
                    continue
                if source and item.get("source") != source:
                    continue
                results.append(item)
        return results

    def _list_knowledge_artifacts(
        self,
        *,
        artifact_type: Optional[str] = None,
        source: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        if status in {None, "processed"}:
            for path in sorted(self.knowledge_docs.rglob("*.md")) if self.knowledge_docs.is_dir() else []:
                item = self._artifact_summary_from_path(path, "processed")
                if artifact_type and item.get("type") != artifact_type:
                    continue
                if source and item.get("source") != source:
                    continue
                results.append(item)
        for item_status in ([status] if status else ["incoming", "processed", "rejected", "reviewed"]):
            if item_status not in {"incoming", "processed", "rejected", "reviewed"}:
                raise StorageError("invalid_query", "knowledge status must be incoming, processed, rejected, or reviewed")
            inbox_dirs = [
                self.external_knowledge_inbox / item_status,
                self.knowledge_root / "triage" / item_status,
            ]
            for inbox_dir in inbox_dirs:
                if not inbox_dir.is_dir():
                    continue
                for path in sorted([*inbox_dir.glob("*.md"), *inbox_dir.glob("*.json")]):
                    item = self._artifact_summary_from_path(path, item_status)
                    if artifact_type and item.get("type") != artifact_type:
                        continue
                    if source and item.get("source") != source:
                        continue
                    results.append(item)
        return results

    def _artifact_id_for_path(self, path: Path, status: str) -> str:
        category = self._artifact_category_for_path(path)
        if category == "memory":
            return path.stem
        try:
            if path.is_relative_to(self.knowledge_docs):
                relative = path.relative_to(self.knowledge_docs).with_suffix("").as_posix()
                return f"knowledge-doc--{relative.replace('/', '~')}"
            if path.is_relative_to(self.knowledge_metadata):
                relative = path.relative_to(self.knowledge_metadata).with_suffix("").as_posix()
                return f"knowledge-meta--{relative.replace('/', '~')}"
        except AttributeError:
            pass
        relative = path.relative_to(self.root).as_posix()
        safe_relative = relative.replace("/", "~")
        return f"knowledge-inbox--{status}--{safe_relative}"

    def _artifact_category_for_path(self, path: Path) -> str:
        try:
            path.relative_to(self.root / "inbox" / "memory")
            return "memory"
        except ValueError:
            return "knowledge"

    def _artifact_source_for_path(self, path: Path) -> Optional[str]:
        if self._artifact_category_for_path(path) == "knowledge":
            return "knowledge"
        return None

    def _artifact_type_for_path(self, path: Path) -> Optional[str]:
        if self._artifact_category_for_path(path) != "knowledge":
            return None
        if path.is_relative_to(self.knowledge_docs):
            return "knowledge_doc"
        if path.suffix.lower() == ".json":
            return "knowledge_metadata"
        return "knowledge_inbox"

    def _knowledge_payload_for_path(self, path: Path) -> Dict[str, Any]:
        if path.suffix.lower() == ".json":
            loaded = self._load_json(path)
            return loaded if isinstance(loaded, dict) else {"value": loaded}
        meta_candidates = [
            path.with_suffix(".meta.json"),
        ]
        try:
            if path.is_relative_to(self.knowledge_docs):
                rel = path.relative_to(self.knowledge_docs)
                meta_candidates.append((self.knowledge_metadata / rel).with_suffix(".json"))
        except AttributeError:
            pass
        for meta_path in meta_candidates:
            if meta_path.is_file():
                loaded = self._load_json(meta_path)
                return loaded if isinstance(loaded, dict) else {"value": loaded}
        return {}

    @staticmethod
    def _read_text(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise StorageError("not_found", f"Unable to read artifact: {path}") from exc

    def _source_url_for_entry(self, entry: Dict[str, Any]) -> Optional[str]:
        meta_path = self._rooted_path(entry["meta_path"])
        if not meta_path.is_file():
            return None
        metadata = self._load_json(meta_path)
        if not isinstance(metadata, dict):
            return None
        return self._source_url_for_metadata(metadata)

    @staticmethod
    def _source_url_for_metadata(metadata: Dict[str, Any]) -> Optional[str]:
        repo = str(metadata.get("source_repo") or "").strip()
        branch = str(metadata.get("source_branch") or "").strip()
        source_path = str(metadata.get("source_path") or "").strip()
        if not repo or not branch or not source_path:
            return None
        if repo.startswith("https://github.com/"):
            normalized_repo = repo[:-4] if repo.endswith(".git") else repo
            return f"{normalized_repo}/blob/{branch}/{source_path}"
        return None

    def _iter_raw_window_paths(
        self, start_dt: datetime, end_dt: datetime, *, bucket: Optional[str] = None
    ) -> List[Path]:
        days: List[str] = []
        cursor = start_dt.date()
        end_date = (end_dt - timedelta(seconds=1)).date()
        while cursor <= end_date:
            days.append(cursor.isoformat())
            cursor += timedelta(days=1)

        raw_paths: List[Path] = []
        bucket_names = [bucket] if bucket else sorted(
            path.name for path in (self.root / "buckets").iterdir() if path.is_dir()
        )
        for bucket_name in bucket_names:
            for day in days:
                day_dir = self.root / "buckets" / bucket_name / "raw" / day
                if not day_dir.is_dir():
                    continue
                raw_paths.extend(sorted(day_dir.glob("*.json")))
        return raw_paths

    @staticmethod
    def _message_author(message: Dict[str, Any]) -> str:
        author = message.get("author")
        if isinstance(author, dict):
            return str(author.get("display_name") or author.get("username") or "").strip()
        return str(author or "").strip()

    @staticmethod
    def _coerce_str_list(value: Any) -> List[str]:
        if not isinstance(value, list):
            return []
        items: List[str] = []
        seen: Set[str] = set()
        for raw in value:
            item = str(raw).strip()
            if not item or item in seen:
                continue
            seen.add(item)
            items.append(item)
        return items

    @staticmethod
    def _channel_sources(channel_name: str, channel_topic: str) -> Set[str]:
        sources: Set[str] = set()
        lowered_name = channel_name.lower()
        lowered_topic = channel_topic.lower()
        if lowered_name == "latest-meetings" or "latest-meetings" in lowered_topic:
            sources.add("meetings")
        elif lowered_name == "memory-inbox" or lowered_name.endswith("-inbox") or "inbox source=" in lowered_topic:
            sources.add("inbox")
        else:
            sources.add("discord")
        return sources

    @staticmethod
    def _parse_iso_datetime(value: str, *, field: str) -> datetime:
        raw = (value or "").strip()
        if not raw:
            raise StorageError("invalid_query", f"{field} is required")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise StorageError(
                "invalid_query",
                f"{field} must be an ISO-8601 datetime",
            ) from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _to_iso(value: datetime) -> str:
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace(
            "+00:00", "Z"
        )

    @staticmethod
    def _validate_date(date_str: str) -> None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
            raise StorageError("invalid_date", "Date must be YYYY-MM-DD")

    @staticmethod
    def _validate_bucket(bucket: str) -> None:
        if not _BUCKET_RE.fullmatch(bucket):
            raise StorageError("invalid_bucket", "Bucket may contain a-z, 0-9, '_' or '-' only")

    @staticmethod
    def _validate_week(week_key: str) -> None:
        if not re.fullmatch(r"\d{4}-W\d{2}", week_key):
            raise StorageError("invalid_date", "Week must be YYYY-WW")

    def write_knowledge_inbox_entry(
        self,
        filename: str,
        content: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, str]:
        normalized = Path(filename).name.strip()
        if not normalized:
            raise StorageError("invalid_filename", "Filename is required")
        stem, suffix = os.path.splitext(normalized)
        if not suffix:
            normalized = f"{normalized}.md"
        elif suffix.lower() != ".md":
            raise StorageError("invalid_filename", "Knowledge docs must use a .md extension")
        if not _SAFE_DOC_RE.fullmatch(normalized):
            raise StorageError("invalid_filename", "Filename may contain letters, numbers, '.', '_' or '-' only")

        inbox = self.knowledge_inbox
        inbox.mkdir(parents=True, exist_ok=True)
        doc_path = inbox / normalized
        if doc_path.exists():
            raise StorageError("file_exists", f"{doc_path.name} already exists")

        meta_path = doc_path.with_suffix(".meta.json")
        doc_path.write_text(content, encoding="utf-8")
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(metadata, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        return {
            "doc_path": str(doc_path.relative_to(self.root)),
            "meta_path": str(meta_path.relative_to(self.root)),
        }

    def write_memory_inbox_entry(self, payload: Dict[str, Any]) -> Dict[str, str]:
        required = ["source", "ts", "type", "content"]
        missing = [field for field in required if not str(payload.get(field, "")).strip()]
        if missing:
            raise StorageError("invalid_payload", f"Missing required inbox fields: {', '.join(missing)}")

        participants = payload.get("participants")
        if participants is not None:
            payload["participants"] = self._coerce_str_list(participants)
        participant_count = payload.get("participant_count")
        if participant_count is not None:
            try:
                payload["participant_count"] = int(participant_count)
            except (TypeError, ValueError) as exc:
                raise StorageError("invalid_payload", "participant_count must be an integer") from exc

        self.memory_inbox.mkdir(parents=True, exist_ok=True)
        source = str(payload["source"]).strip()
        slug = self._safe_slug(source)
        ts_value = str(payload["ts"]).strip()
        filename = f"{ts_value.replace(':', '').replace('-', '').replace('T', '_')}-{slug}-{uuid.uuid4().hex[:8]}.json"
        path = self.memory_inbox / filename
        artifact_id = path.stem
        artifact_url = f"/artifacts/{artifact_id}"
        if not str(payload.get("url") or "").strip():
            payload["url"] = artifact_url
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        return {
            "path": str(path.relative_to(self.root)),
            "artifact_id": artifact_id,
            "artifact_url": artifact_url,
        }

    @staticmethod
    def _safe_slug(value: str) -> str:
        slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower()
        return slug or "inbox"

    @staticmethod
    def _safe_state_key(value: str) -> str:
        return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower()

    def _resolve_manifest_entry(self, slug: str) -> Tuple[str, Dict[str, Any]]:
        normalized = self._normalize_slug(slug)
        manifest = self._load_manifest()
        matches: List[Tuple[Dict[str, Any], str]] = []
        for entry in manifest:
            rel_slug = self._relative_slug(entry)
            filename_slug = Path(rel_slug).name
            if normalized == rel_slug or normalized == filename_slug:
                matches.append((entry, rel_slug))
        if not matches:
            raise StorageError("not_found", f"No knowledge doc matched slug '{normalized}'")
        if len(matches) > 1:
            sample = matches[0][1]
            raise StorageError(
                "ambiguous_slug",
                f"Slug '{normalized}' matches multiple docs; try the full path like '{sample}'",
            )
        entry, rel_slug = matches[0]
        return rel_slug, entry

    def _normalize_slug(self, slug: str) -> str:
        cleaned = (slug or "").strip().strip("/")
        prefixes = [
            "knowledge/kb/docs/",
            "kb/docs/",
            "docs/",
        ]
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]
                break
        if cleaned.endswith(".md"):
            cleaned = cleaned[: -len(".md")]
        if not cleaned:
            raise StorageError("invalid_slug", "Slug is required")
        parts = [part for part in cleaned.split("/") if part]
        for part in parts:
            if part in {".", ".."} or "\\" in part or "\x00" in part:
                raise StorageError(
                    "invalid_slug",
                    "Slug contains invalid path components",
                )
        return "/".join(parts)

    def _relative_slug(self, entry: Dict[str, Any]) -> str:
        path = self._rooted_path(entry["path"])
        try:
            relative = path.relative_to(self.knowledge_docs)
        except ValueError:
            relative = path
        return relative.with_suffix("").as_posix()

    def _slug_from_entry(self, entry: Dict[str, Any]) -> str:
        path = self._rooted_path(entry["path"])
        try:
            relative = path.relative_to(self.knowledge_docs)
            return relative.with_suffix("").as_posix()
        except ValueError:
            return path.stem

    def _tokens_in_text(self, text: str, tokens: Tuple[str, ...]) -> Set[str]:
        if not text:
            return set()
        haystack = text.lower()
        return {token for token in tokens if token and token in haystack}

    def _tokens_in_doc(self, entry: Dict[str, Any], tokens: Tuple[str, ...]) -> Set[str]:
        if not tokens:
            return set()
        doc_path = self._rooted_path(entry["path"])
        if not doc_path.is_file():
            return set()
        try:
            content = doc_path.read_text(encoding="utf-8").lower()
        except OSError:
            return set()
        return {token for token in tokens if token and token in content}

    def _rooted_path(self, raw_path: Any) -> Path:
        path = Path(raw_path)
        if path.is_absolute():
            return path
        if self._root_prefix:
            prefix_len = len(self._root_prefix)
            if len(path.parts) >= prefix_len and tuple(path.parts[:prefix_len]) == self._root_prefix:
                path = Path(*path.parts[prefix_len:])
        return (self.root / path).resolve()

    def _load_manifest(self) -> List[Dict[str, Any]]:
        manifest_path = self.knowledge_indexes / "manifest.json"
        return self._load_json(manifest_path)


# Backward-compatible alias for older imports.
Storage = FilesystemStorageBackend
