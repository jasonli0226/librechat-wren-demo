"""OpenRouter chat-completions client used to arrange dashboards."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
LLM_TEMPERATURE = 0.2
LLM_MAX_TOKENS = 1500
DEFAULT_TIMEOUT_S = 8.0

# (system prompt, user message) -> the model's text.
LlmFn = Callable[[str, str], Awaitable[str]]


class LlmError(Exception):
    """The LLM call failed. Messages never contain the API key."""


def make_openrouter_llm(
    key: str,
    model: str,
    timeout: float = DEFAULT_TIMEOUT_S,
    transport: httpx.AsyncBaseTransport | None = None,
) -> LlmFn:
    async def call(system: str, user: str) -> str:
        payload = {
            "model": model,
            "temperature": LLM_TEMPERATURE,
            "max_tokens": LLM_MAX_TOKENS,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        try:
            # httpx timeouts are per phase; one deadline bounds connect, send and the full body read.
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
                    response = await client.post(
                        OPENROUTER_URL, json=payload, headers={"Authorization": f"Bearer {key}"}
                    )
        except httpx.TimeoutException as exc:
            raise TimeoutError("OpenRouter request timed out") from exc
        except httpx.HTTPError as exc:
            raise LlmError(f"OpenRouter request failed: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise LlmError(f"OpenRouter returned status {response.status_code}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise LlmError("OpenRouter returned an unexpected body") from None
        if not isinstance(content, str):
            raise LlmError("OpenRouter returned an unexpected body")
        return content

    return call
