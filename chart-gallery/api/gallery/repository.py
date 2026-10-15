"""SQLite storage for charts. One writer (single Uvicorn worker); WAL lets reads run alongside it."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS charts (
    id             INTEGER PRIMARY KEY,
    dedup_key      TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL,
    chart_type     TEXT NOT NULL CHECK (chart_type IN ('line', 'bar', 'pie')),
    x_field        TEXT NOT NULL,
    y_fields       TEXT NOT NULL,
    sql            TEXT NOT NULL,
    normalized_sql TEXT NOT NULL,
    tables         TEXT NOT NULL,
    rows           TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
)
"""

_UPDATABLE = "title, description, chart_type, x_field, y_fields, sql, normalized_sql, tables, rows"


@dataclass(frozen=True)
class NewChart:
    dedup_key: str
    title: str
    description: str
    chart_type: str
    x_field: str
    y_fields: tuple[str, ...]
    sql: str
    normalized_sql: str
    tables: tuple[str, ...]
    rows: tuple[dict[str, Any], ...]


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class ChartRepository:
    def __init__(self, db_path: str, clock: Callable[[], str] = utc_now) -> None:
        self._db_path = db_path
        self._clock = clock

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, timeout=5, isolation_level=None)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            yield conn
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(SCHEMA)

    def journal_mode(self) -> str:
        with self._connect() as conn:
            return str(conn.execute("PRAGMA journal_mode").fetchone()[0])

    def ping(self) -> bool:
        try:
            with self._connect() as conn:
                conn.execute("SELECT 1 FROM charts LIMIT 1")
            return True
        except sqlite3.Error:
            return False

    def upsert(self, chart: NewChart) -> tuple[int, str]:
        now = self._clock()
        values = (
            chart.title,
            chart.description,
            chart.chart_type,
            chart.x_field,
            json.dumps(list(chart.y_fields)),
            chart.sql,
            chart.normalized_sql,
            json.dumps(list(chart.tables)),
            json.dumps(list(chart.rows)),
        )
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                existing = conn.execute("SELECT id FROM charts WHERE dedup_key = ?", (chart.dedup_key,)).fetchone()
                if existing is None:
                    cursor = conn.execute(
                        f"INSERT INTO charts ({_UPDATABLE}, dedup_key, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (*values, chart.dedup_key, now, now),
                    )
                    result = (int(cursor.lastrowid), "created")
                else:
                    assignments = ", ".join(f"{col.strip()} = ?" for col in _UPDATABLE.split(","))
                    conn.execute(
                        f"UPDATE charts SET {assignments}, updated_at = ? WHERE id = ?",
                        (*values, now, existing["id"]),
                    )
                    result = (int(existing["id"]), "updated")
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return result

    def list_summaries(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, title, description, chart_type, tables, updated_at "
                "FROM charts ORDER BY updated_at DESC, id DESC"
            ).fetchall()
        return [{**dict(row), "tables": json.loads(row["tables"])} for row in rows]

    def get(self, chart_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, title, description, chart_type, x_field, y_fields, sql, tables, rows, "
                "created_at, updated_at FROM charts WHERE id = ?",
                (chart_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            **dict(row),
            "y_fields": json.loads(row["y_fields"]),
            "tables": json.loads(row["tables"]),
            "rows": json.loads(row["rows"]),
        }
