"""Settings read from the environment. The service refuses to start without a strong token."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

MIN_TOKEN_LENGTH = 32
# Host headers accepted (DNS-rebinding protection): browser on the host, and wren-mcp in compose.
DEFAULT_ALLOWED_HOSTS = ("localhost", "127.0.0.1", "chart-gallery")
DEFAULT_WREN_MCP_URL = "http://wren-mcp:7080/mcp"
DEFAULT_LLM_MODEL = "z-ai/glm-4.5-air"


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    token: str
    db_path: str
    public_url: str
    static_dir: str | None = None
    allowed_hosts: tuple[str, ...] = DEFAULT_ALLOWED_HOSTS
    wren_mcp_url: str = DEFAULT_WREN_MCP_URL
    openrouter_key: str | None = None
    llm_model: str = DEFAULT_LLM_MODEL
    prompt_path: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        token = env.get("CHART_GALLERY_TOKEN", "")
        if len(token) < MIN_TOKEN_LENGTH:
            raise ConfigError(f"CHART_GALLERY_TOKEN must be set and at least {MIN_TOKEN_LENGTH} characters")
        return cls(
            token=token,
            db_path=env.get("GALLERY_DB_PATH", "charts.db"),
            public_url=env.get("GALLERY_PUBLIC_URL", "http://localhost:3090").rstrip("/"),
            static_dir=env.get("GALLERY_STATIC_DIR") or None,
            allowed_hosts=_split_hosts(env.get("GALLERY_ALLOWED_HOSTS", "")) or DEFAULT_ALLOWED_HOSTS,
            wren_mcp_url=env.get("WREN_MCP_URL") or DEFAULT_WREN_MCP_URL,
            openrouter_key=env.get("OPENROUTER_KEY") or None,
            llm_model=env.get("GALLERY_LLM_MODEL") or DEFAULT_LLM_MODEL,
            prompt_path=env.get("GALLERY_PROMPT_PATH") or None,
        )


def _split_hosts(value: str) -> tuple[str, ...]:
    return tuple(host.strip() for host in value.split(",") if host.strip())
