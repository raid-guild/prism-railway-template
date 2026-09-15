from __future__ import annotations

import json
import time
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ProviderHttpError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"provider_http_error:{status}:{detail}")
        self.status = status
        self.detail = detail


def call_json_provider(
    provider: Any,
    *,
    system_prompt: str,
    user_payload: Dict[str, Any],
    session_id: str,
    purpose: str,
) -> Dict[str, Any]:
    try:
        content = _call_chat_completions(provider, system_prompt=system_prompt, user_payload=user_payload)
    except ProviderHttpError as exc:
        if exc.status != 404:
            raise
        content = _call_codex_runtime(
            provider,
            system_prompt=system_prompt,
            user_payload=user_payload,
            session_id=session_id,
            purpose=purpose,
        )
    return _loads_json_text(content)


def _loads_json_text(content: str) -> Dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError("provider_json_not_object")
    return parsed


def extract_chat_message_content(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("provider_missing_choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise RuntimeError("provider_missing_message")
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "\n".join(parts)
    raise RuntimeError("provider_missing_content")


def _base_v1(base_url: str) -> str:
    base = base_url.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def _request_json(
    url: str,
    *,
    method: str = "POST",
    headers: Dict[str, str] | None = None,
    body: Dict[str, Any] | None = None,
    timeout: int,
) -> Dict[str, Any]:
    request = Request(
        url,
        method=method,
        headers=headers or {},
        data=json.dumps(body or {}, ensure_ascii=True).encode("utf-8") if body is not None else None,
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ProviderHttpError(exc.code, detail) from exc
    except URLError as exc:
        raise RuntimeError(f"provider_unreachable:{exc.reason}") from exc


def _call_chat_completions(provider: Any, *, system_prompt: str, user_payload: Dict[str, Any]) -> str:
    url = f"{_base_v1(provider.base_url)}/chat/completions"
    body = {
        "model": provider.model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if getattr(provider, "api_key", None):
        headers["Authorization"] = f"Bearer {provider.api_key}"
    payload = _request_json(url, headers=headers, body=body, timeout=provider.timeout_seconds)
    return extract_chat_message_content(payload)


def _runtime_input(
    *,
    system_prompt: str,
    user_payload: Dict[str, Any],
    session_id: str,
    purpose: str,
) -> Dict[str, Any]:
    return {
        "prompt": "\n".join(
            [
                system_prompt,
                "",
                "Return valid JSON only. Do not include markdown fences or extra commentary.",
                "",
                "Input JSON:",
                json.dumps(user_payload, ensure_ascii=True),
            ]
        ),
        "sessionId": session_id,
        "codexThreadId": None,
        "recentHistory": [],
        "metadata": {"purpose": purpose, "source": "prism-memory"},
    }


def _extract_runtime_response_text(payload: Dict[str, Any]) -> str:
    response = payload.get("response")
    job = payload.get("job")
    candidates: List[Any] = [payload]
    if isinstance(response, dict):
        candidates.append(response)
    if isinstance(job, dict):
        candidates.append(job)
        job_response = job.get("response")
        if isinstance(job_response, dict):
            candidates.append(job_response)
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        for key in ("responseText", "output_text"):
            value = candidate.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise RuntimeError("codex_runtime_empty_response")


def _call_codex_runtime(
    provider: Any,
    *,
    system_prompt: str,
    user_payload: Dict[str, Any],
    session_id: str,
    purpose: str,
) -> str:
    base = _base_v1(provider.base_url)
    timeout_seconds = max(1, int(provider.timeout_seconds or 30))
    started = time.monotonic()
    body = _runtime_input(
        system_prompt=system_prompt,
        user_payload=user_payload,
        session_id=session_id,
        purpose=purpose,
    )

    try:
        create_payload = _request_json(
            f"{base}/responses/jobs",
            headers={"Content-Type": "application/json"},
            body=body,
            timeout=min(30, timeout_seconds),
        )
    except ProviderHttpError as exc:
        if exc.status != 404:
            raise
        direct_payload = _request_json(
            f"{base}/responses",
            headers={"Content-Type": "application/json"},
            body=body,
            timeout=timeout_seconds,
        )
        return _extract_runtime_response_text(direct_payload)

    job_id = str(create_payload.get("jobId") or "")
    if not job_id:
        raise RuntimeError("codex_runtime_job_create_invalid_response")

    while True:
        elapsed = time.monotonic() - started
        if elapsed >= timeout_seconds:
            raise RuntimeError(f"codex_runtime_request_timeout:{timeout_seconds}")
        time.sleep(min(2, max(0.1, timeout_seconds - elapsed)))
        remaining = max(1, int(timeout_seconds - (time.monotonic() - started)))
        poll_payload = _request_json(
            f"{base}/responses/jobs/{job_id}",
            method="GET",
            timeout=min(30, remaining),
        )
        job = poll_payload.get("job") if isinstance(poll_payload.get("job"), dict) else {}
        status = str(job.get("status") or "")
        if status in ("queued", "running"):
            continue
        if status == "succeeded":
            return _extract_runtime_response_text(poll_payload)
        raise RuntimeError(f"codex_runtime_request_failed:{poll_payload.get('error') or job.get('error') or 'unknown'}")
