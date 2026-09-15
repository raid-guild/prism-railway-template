from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Protocol

from .storage import FilesystemStorageBackend


class StorageBackend(Protocol):
    def memory_latest(self) -> Any: ...
    def memory_dates(self, limit: int = 180) -> Dict[str, Any]: ...
    def memory_by_date(self, date_str: str) -> Any: ...
    def state_latest(self) -> Any: ...
    def state_projects(self) -> Any: ...
    def state_signals(
        self,
        anchor: Optional[str] = None,
        kind: Optional[str] = None,
        source: Optional[str] = None,
        objective_key: Optional[str] = None,
        throughline_key: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any: ...
    def state_objectives(
        self,
        status: Optional[str] = None,
        source: Optional[str] = None,
        external_system: Optional[str] = None,
        objective_key: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any: ...
    def state_throughlines(
        self,
        status: Optional[str] = None,
        throughline_key: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any: ...
    def upsert_state_project(self, project_key: str, payload: Dict[str, Any]) -> Dict[str, Any]: ...
    def patch_state_throughline(self, throughline_key: str, payload: Dict[str, Any]) -> Dict[str, Any]: ...
    def merge_state_throughline(self, throughline_key: str, payload: Dict[str, Any]) -> Dict[str, Any]: ...
    def delete_state_throughline(self, throughline_key: str) -> Dict[str, Any]: ...
    def digests_by_date(self, date_str: str) -> Dict[str, Any]: ...
    def digest_for_bucket(self, bucket: str, date_str: str) -> Any: ...
    def bucket_digest_asset(self, bucket: str, date_str: str, extension: str) -> tuple[str, Any]: ...
    def activity_recent(
        self,
        limit: int = 100,
        event_type: Optional[str] = None,
        bucket: Optional[str] = None,
        collector_key: Optional[str] = None,
    ) -> list[Dict[str, Any]]: ...
    def participant_activity(
        self,
        *,
        start: str,
        end: str,
        bucket: Optional[str] = None,
        limit: int = 25,
    ) -> Dict[str, Any]: ...
    def knowledge_doc(self, slug: str) -> Dict[str, Any]: ...
    def knowledge_search(
        self,
        query: Optional[str] = None,
        kind: Optional[str] = None,
        tag: Optional[str] = None,
        entity: Optional[str] = None,
        limit: int = 25,
    ) -> Dict[str, Any]: ...
    def knowledge_index(self, name: str) -> Any: ...
    def product_suggestion_latest(self) -> Any: ...
    def product_suggestion_by_date(self, date_str: str) -> Any: ...
    def product_suggestion_weekly(self, week_key: str) -> Any: ...
    def write_knowledge_inbox_entry(
        self,
        filename: str,
        content: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, str]: ...
    def write_memory_inbox_entry(self, payload: Dict[str, Any]) -> Dict[str, str]: ...


def create_storage_backend(*, backend: str, root: Path) -> StorageBackend:
    normalized = (backend or "filesystem").strip().lower()
    if normalized in {"filesystem", "fs", "file"}:
        return FilesystemStorageBackend(root)
    raise ValueError(f"Unsupported storage backend '{backend}'")
