"""Which chart shapes read as a line and which as a scatter, decided from stored snapshot rows.

Twin of web/src/chartShape.ts; both are pinned by fixtures/chart-shapes.json.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

# Same pattern as the web twin; [^...] stands in for JS's "." (no line terminators).
DATE_LIKE = re.compile(
    r"\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}[^\n\r\u2028\u2029]*)?", re.ASCII
)
MIN_LINE_ROWS = 2
YEAR_MIN = 1900
YEAR_MAX = 2100
MIN_SCATTER_ROWS = 5
MIN_PAIR_FIELDS = 2


def is_number(v: Any) -> bool:
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return False
    try:
        return math.isfinite(v)
    except OverflowError:  # int too large for a float; JS would see Infinity
        return False


def _is_year(v: Any) -> bool:
    return is_number(v) and float(v).is_integer() and YEAR_MIN <= v <= YEAR_MAX


def is_line_shaped(x_field: str, rows: Sequence[Mapping[str, Any]]) -> bool:
    return len(rows) >= MIN_LINE_ROWS and all(
        (isinstance(x, str) and DATE_LIKE.fullmatch(x) is not None) or _is_year(x)
        for x in (row.get(x_field) for row in rows)
    )


def scatter_axes(
    x_field: str, y_fields: Sequence[str], rows: Sequence[Mapping[str, Any]]
) -> dict[str, Any] | None:
    if len(rows) < MIN_SCATTER_ROWS or is_line_shaped(x_field, rows):
        return None
    ys = [f for f in y_fields if any(is_number(row.get(f)) for row in rows)]
    if ys and all(is_number(row.get(x_field)) for row in rows):
        return {"mode": "x", "x": x_field, "ys": ys}
    if len(ys) >= MIN_PAIR_FIELDS:
        return {"mode": "pair", "x": ys[0], "ys": [ys[1]], "label": x_field}
    return None
