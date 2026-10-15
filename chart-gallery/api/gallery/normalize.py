"""Canonical SQL text and table list, used only to build the chart dedup key."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class NormalizedSql:
    text: str
    tables: tuple[str, ...]


def normalize_sql(sql: str) -> NormalizedSql:
    """Re-emit SQL in canonical Postgres form; fall back to plain text cleanup if it won't parse."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except SqlglotError:
        return _fallback(sql)
    if len(statements) != 1:
        return _fallback(sql)
    tree = normalize_identifiers(statements[0], dialect="postgres")
    ctes = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    tables = {t.name.lower() for t in tree.find_all(exp.Table) if t.name} - ctes
    return NormalizedSql(text=tree.sql(dialect="postgres", comments=False), tables=tuple(sorted(tables)))


def dedup_key(normalized_text: str, chart_type: str) -> str:
    return hashlib.sha256(f"{normalized_text}|{chart_type}".encode()).hexdigest()


def _fallback(sql: str) -> NormalizedSql:
    text = _LINE_COMMENT.sub(" ", _BLOCK_COMMENT.sub(" ", sql))
    text = _WHITESPACE.sub(" ", text).strip().rstrip(";").strip().lower()
    return NormalizedSql(text=text, tables=())
