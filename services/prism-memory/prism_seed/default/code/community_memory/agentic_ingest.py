from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .activity import ActivityLogger
from .config_loader import AgenticIngestConfig, SpaceConfig
from .provider_client import call_json_provider


SYSTEM_PROMPT = """You classify Prism Memory inbox records for downstream synthesis.
Return JSON only.

Decide:
- interaction_kind: retrieval | ops | planning | decision_support | artifact_generation | discussion
- memory_relevance: low | review | high
- adoption_signal: none | candidate | adopted
- memory_include_default: true if this should be included in default digest and rolling-memory synthesis
- summary: one short sentence
- topics: short topic strings
- action_items: short action item strings
- reason: brief explanation

Guidance:
- Simple bot lookups, link requests, sync/debug chatter, and retrieval questions should usually be memory_include_default=false.
- Planning or decision-support threads should usually be memory_include_default=false unless there is clear adopted working state.
- Adopted outputs that materially change project state may be memory_include_default=true.
"""


@dataclass
class AgenticIngestEnricher:
    config: SpaceConfig
    activity: ActivityLogger

    def enrich(self, record: Dict[str, Any]) -> Dict[str, Any]:
        settings = self.config.agentic_ingest
        if not settings.enabled:
            return record
        if not self._matches_scope(record):
            return record
        if not settings.provider.base_url or not settings.provider.model:
            self.activity.log(
                "agentic_ingest.skipped",
                collector_key="inbox_memory",
                run_key=record.get("source_file", "unknown"),
                meta={
                    "reason": "provider_not_configured",
                    "enabled": settings.enabled,
                    "scope": settings.scope,
                },
            )
            return record
        try:
            derived = self._classify(record)
        except Exception as exc:  # pragma: no cover - defensive runtime path
            self.activity.log(
                "agentic_ingest.error",
                collector_key="inbox_memory",
                run_key=record.get("source_file", "unknown"),
                meta={"error": str(exc), "enabled": settings.enabled, "scope": settings.scope},
            )
            return record
        metadata = dict(record.get("metadata") or {})
        metadata["agentic_ingest"] = derived
        record["metadata"] = metadata
        self.activity.log(
            "agentic_ingest.classified",
            collector_key="inbox_memory",
            run_key=record.get("source_file", "unknown"),
            meta={
                "enabled": settings.enabled,
                "scope": settings.scope,
                "interaction_kind": derived.get("interaction_kind"),
                "memory_include_default": derived.get("memory_include_default"),
                "adoption_signal": derived.get("adoption_signal"),
            },
        )
        return record

    def _matches_scope(self, record: Dict[str, Any]) -> bool:
        settings = self.config.agentic_ingest
        if settings.scope == "all":
            return True
        source = str(record.get("source") or "").strip()
        bucket = str(record.get("bucket") or "").strip()
        metadata = record.get("metadata") or {}
        in_thread = bool(metadata.get("threadId") or metadata.get("discordThreadId"))
        author_bot = bool(metadata.get("authorBot"))
        if settings.scope == "bot_only":
            return source == "discord" and (author_bot or in_thread)
        if settings.scope == "scoped":
            return (settings.scoped_sources and source in settings.scoped_sources) or (
                settings.scoped_buckets and bucket in settings.scoped_buckets
            )
        return False

    def _classify(self, record: Dict[str, Any]) -> Dict[str, Any]:
        settings = self.config.agentic_ingest
        provider = settings.provider
        metadata = record.get("metadata") or {}
        user_payload = {
            "source": record.get("source"),
            "type": record.get("type"),
            "bucket": record.get("bucket"),
            "author": record.get("author"),
            "participant_count": record.get("participant_count"),
            "participants": record.get("participants"),
            "metadata": metadata,
            "content": record.get("content"),
        }
        policy_prompt = self._policy_prompt()
        parsed = call_json_provider(
            provider,
            system_prompt=(
                SYSTEM_PROMPT
                if not policy_prompt
                else f"{SYSTEM_PROMPT}\n\nCommunity policy:\n{policy_prompt}"
            ),
            user_payload=user_payload,
            session_id=f"agentic-ingest-{record.get('source_file', 'unknown')}",
            purpose="prism_memory_agentic_ingest",
        )
        return self._normalize_result(parsed)

    def _policy_prompt(self) -> str:
        policy = self.config.agentic_ingest.policy
        parts: List[str] = []
        if policy.priority_channels:
            parts.append(
                "Priority channels: " + ", ".join(policy.priority_channels[:20])
            )
        if policy.deprioritized_channels:
            parts.append(
                "Deprioritized channels: " + ", ".join(policy.deprioritized_channels[:20])
            )
        if policy.priority_topics:
            parts.append(
                "Priority topics: " + ", ".join(policy.priority_topics[:20])
            )
        if policy.deprioritized_topics:
            parts.append(
                "Deprioritized topics: " + ", ".join(policy.deprioritized_topics[:20])
            )
        if policy.channel_labels:
            labels = [
                f"{channel}={label}"
                for channel, label in sorted(policy.channel_labels.items())
            ]
            parts.append("Channel labels: " + ", ".join(labels[:20]))
        if policy.custom_guidance:
            parts.append("Custom guidance: " + policy.custom_guidance)
        return "\n".join(parts)

    @staticmethod
    def _normalize_result(raw: Dict[str, Any]) -> Dict[str, Any]:
        def _as_list(value: Any) -> List[str]:
            if not isinstance(value, list):
                return []
            out: List[str] = []
            for item in value:
                text = str(item).strip()
                if text:
                    out.append(text)
            return out[:12]

        interaction_kind = str(raw.get("interaction_kind") or "discussion").strip() or "discussion"
        memory_relevance = str(raw.get("memory_relevance") or "low").strip() or "low"
        adoption_signal = str(raw.get("adoption_signal") or "none").strip() or "none"
        memory_include_default = bool(raw.get("memory_include_default", False))
        return {
            "interaction_kind": interaction_kind,
            "memory_relevance": memory_relevance,
            "adoption_signal": adoption_signal,
            "memory_include_default": memory_include_default,
            "summary": str(raw.get("summary") or "").strip(),
            "reason": str(raw.get("reason") or "").strip(),
            "topics": _as_list(raw.get("topics")),
            "action_items": _as_list(raw.get("action_items")),
        }
