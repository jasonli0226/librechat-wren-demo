"""Canonical SQL text and table list, used only to build the chart dedup key."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers

# A quoted string or identifier (group 1, kept verbatim), or a comment (dropped).
_FALLBACK_TOKEN = re.compile(r"""('(?:[^']|'')*'|"(?:[^"]|"")*")|--[^\n]*|/\*.*?\*/""", re.DOTALL)
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
    """Drop comments, collapse whitespace and lowercase, but only outside quotes:
    'Gold' and 'gold' are different values and must not share a dedup key."""
    pieces: list[str] = []
    unquoted = ""
    position = 0
    for match in _FALLBACK_TOKEN.finditer(sql):
        unquoted += sql[position : match.start()]
        position = match.end()
        if match.group(1) is None:
            unquoted += " "
        else:
            pieces += [_clean(unquoted), match.group(1)]
            unquoted = ""
    pieces.append(_clean(unquoted + sql[position:]))
    text = "".join(pieces).strip().rstrip(";").strip()
    return NormalizedSql(text=text, tables=())


def _clean(unquoted: str) -> str:
    return _WHITESPACE.sub(" ", unquoted).lower()
