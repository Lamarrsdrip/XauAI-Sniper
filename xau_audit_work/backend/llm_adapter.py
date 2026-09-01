"""Small async compatibility layer for the optional emergentintegrations chat API.

The production application may still use emergentintegrations when it is
installed. This module keeps the same two call-site primitives available in a
clean install by speaking directly to the supported provider HTTP APIs.
Provider failures are raised to the existing route-level degraded/fallback
handling; they are never fabricated as successful AI decisions.
"""

from dataclasses import dataclass

import httpx


@dataclass
class UserMessage:
    text: str


class LlmChat:
    def __init__(self, *, api_key: str, session_id: str, system_message: str):
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message
        self.provider = ""
        self.model = ""

    def with_model(self, provider: str, model: str) -> "LlmChat":
        self.provider = provider.strip().lower()
        self.model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        if not self.api_key:
            raise RuntimeError("LLM provider key is not configured")
        if self.provider == "anthropic":
            return await self._anthropic(message.text)
        if self.provider == "openai":
            return await self._openai(message.text)
        raise RuntimeError(f"Unsupported LLM provider: {self.provider or 'unset'}")

    async def _anthropic(self, text: str) -> str:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self.model,
            "max_tokens": 1200,
            "system": self.system_message,
            "messages": [{"role": "user", "content": text}],
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages", headers=headers, json=payload
            )
            response.raise_for_status()
            body = response.json()
        blocks = body.get("content") or []
        rendered = "".join(
            str(block.get("text", "")) for block in blocks if block.get("type") == "text"
        )
        if not rendered:
            raise RuntimeError("Anthropic returned no text content")
        return rendered

    async def _openai(self, text: str) -> str:
        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_message},
                {"role": "user", "content": text},
            ],
            "max_tokens": 1200,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions", headers=headers, json=payload
            )
            response.raise_for_status()
            body = response.json()
        choices = body.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI returned no choices")
        rendered = str((choices[0].get("message") or {}).get("content") or "")
        if not rendered:
            raise RuntimeError("OpenAI returned no text content")
        return rendered
