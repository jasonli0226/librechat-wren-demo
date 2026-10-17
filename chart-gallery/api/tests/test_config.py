import pytest

from gallery.config import ConfigError, Settings


def test_rejects_missing_token():
    with pytest.raises(ConfigError, match="CHART_GALLERY_TOKEN"):
        Settings.from_env({})


def test_rejects_short_token():
    with pytest.raises(ConfigError, match="at least 32"):
        Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 31})


def test_defaults_and_trailing_slash():
    settings = Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32, "GALLERY_PUBLIC_URL": "http://gallery.test/"})
    assert settings.public_url == "http://gallery.test"
    assert settings.db_path == "charts.db"
    assert settings.static_dir is None


def test_reads_paths():
    settings = Settings.from_env(
        {"CHART_GALLERY_TOKEN": "x" * 40, "GALLERY_DB_PATH": "/data/c.db", "GALLERY_STATIC_DIR": "/app/static"}
    )
    assert (settings.db_path, settings.static_dir) == ("/data/c.db", "/app/static")


def test_allowed_hosts_default_and_override():
    assert Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32}).allowed_hosts == ("localhost", "127.0.0.1", "chart-gallery")
    settings = Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32, "GALLERY_ALLOWED_HOSTS": "a.test, b.test"})
    assert settings.allowed_hosts == ("a.test", "b.test")


def test_dashboard_settings_defaults():
    s = Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32})
    assert s.wren_mcp_url == "http://wren-mcp:7080/mcp"
    assert s.openrouter_key is None and s.prompt_path is None
    assert s.llm_model == "z-ai/glm-4.5-air"


def test_dashboard_settings_from_env():
    s = Settings.from_env(
        {
            "CHART_GALLERY_TOKEN": "x" * 32,
            "WREN_MCP_URL": "http://w/mcp",
            "OPENROUTER_KEY": "sk-or-1",
            "GALLERY_LLM_MODEL": "m/x",
            "GALLERY_PROMPT_PATH": "/p.md",
        }
    )
    assert (s.wren_mcp_url, s.openrouter_key, s.llm_model, s.prompt_path) == ("http://w/mcp", "sk-or-1", "m/x", "/p.md")


def test_empty_openrouter_key_means_disabled():
    assert Settings.from_env({"CHART_GALLERY_TOKEN": "x" * 32, "OPENROUTER_KEY": ""}).openrouter_key is None
