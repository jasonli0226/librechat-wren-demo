"""Settings read from the environment. The service refuses to start without a strong token."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

MIN_TOKEN_LENGTH = 32


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    token: str
    db_path: str
    public_url: str
    static_dir: str | None = None

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
        )
