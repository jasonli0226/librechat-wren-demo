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
