import sqlite3

import pytest

from gallery.repository import ChartRepository, NewChart

T1, T2, T3 = "2026-10-16T10:00:00+00:00", "2026-10-16T11:00:00+00:00", "2026-10-16T12:00:00+00:00"


def make_repo(tmp_path, times=(T1, T2, T3)):
    clock = iter(times)
    repo = ChartRepository(str(tmp_path / "charts.db"), clock=lambda: next(clock))
    repo.init_schema()
    return repo


def chart(**overrides) -> NewChart:
    base = dict(
        dedup_key="k1",
        title="Revenue by store",
        description="Completed revenue per store.",
        chart_type="bar",
        x_field="store_name",
        y_fields=("revenue",),
        sql="SELECT store_name, revenue FROM x",
        normalized_sql="SELECT store_name, revenue FROM x",
        tables=("orders", "stores"),
        rows=({"store_name": "Central", "revenue": 10.5},),
    )
    return NewChart(**{**base, **overrides})


def test_first_save_is_created(tmp_path):
    repo = make_repo(tmp_path)
    assert repo.upsert(chart()) == (1, "created")


def test_same_key_updates_in_place_and_keeps_created_at(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    rows = ({"store_name": "Central", "revenue": 99.0},)
    assert repo.upsert(chart(title="Store revenue", rows=rows)) == (1, "updated")
    saved = repo.get(1)
    assert saved["title"] == "Store revenue"
    assert saved["rows"] == [{"store_name": "Central", "revenue": 99.0}]
    assert saved["created_at"] == T1
    assert saved["updated_at"] == T2


def test_new_key_creates_second_chart(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    assert repo.upsert(chart(dedup_key="k2")) == (2, "created")


def test_list_is_newest_first_without_rows_or_sql(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart(dedup_key="k1", title="Old"))
    repo.upsert(chart(dedup_key="k2", title="New"))
    summaries = repo.list_summaries()
    assert [s["title"] for s in summaries] == ["New", "Old"]
    assert set(summaries[0]) == {"id", "title", "description", "chart_type", "tables", "updated_at"}
    assert summaries[0]["tables"] == ["orders", "stores"]


def test_get_decodes_json_columns(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    saved = repo.get(1)
    assert saved["y_fields"] == ["revenue"]
    assert saved["tables"] == ["orders", "stores"]
    assert saved["sql"] == "SELECT store_name, revenue FROM x"
    assert "dedup_key" not in saved and "normalized_sql" not in saved


def test_get_missing_returns_none(tmp_path):
    assert make_repo(tmp_path).get(42) is None


def test_wal_mode_and_ping(tmp_path):
    repo = make_repo(tmp_path)
    assert repo.journal_mode() == "wal"
    assert repo.ping() is True


def test_init_schema_is_idempotent(tmp_path):
    repo = make_repo(tmp_path)
    repo.upsert(chart())
    repo.init_schema()
    assert repo.get(1) is not None


def test_rejects_unknown_chart_type(tmp_path):
    repo = make_repo(tmp_path)
    with pytest.raises(sqlite3.IntegrityError):
        repo.upsert(chart(chart_type="area"))
