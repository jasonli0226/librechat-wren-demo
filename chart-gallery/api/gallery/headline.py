"""Headline numbers for dashboard tiles, computed from a chart's stored snapshot rows.

The LLM summary writer is given these values and the browser checks the summary's numbers
against them, so they are rounded once, here, and returned exactly as they will be shown.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Literal

TileType = Literal["stat", "line", "bar", "stackedBar", "table"]

SIGNIFICANT_DIGITS = 4
PCT_DECIMALS = 1


def _sig(value: float) -> float | int:
    rounded = float(f"{value:.{SIGNIFICANT_DIGITS}g}")
    return int(rounded) if rounded.is_integer() else rounded


def _pct(value: float) -> float:
    return round(value, PCT_DECIMALS)


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _points(chart: Mapping[str, Any]) -> list[tuple[Any, float]]:
    x_field = chart["x_field"]
    y_field = chart["y_fields"][0]
    return [
        (row.get(x_field), row[y_field])
        for row in chart["rows"]
        if _is_number(row.get(y_field))
    ]


def headline_for(chart: Mapping[str, Any], tile_type: TileType) -> dict[str, float | int | str]:
    n_rows = len(chart["rows"])
    points = _points(chart) if chart["y_fields"] else []
    if not points:
        return {"rows": n_rows}

    if tile_type == "stat":
        return {"value": _sig(points[0][1])}

    if tile_type == "line":
        first, last = points[0][1], points[-1][1]
        out: dict[str, Any] = {"first": _sig(first), "last": _sig(last), "points": len(points)}
        if first != 0:
            out["pct_change"] = _pct((last - first) / abs(first) * 100)
        return out

    top_x, top_y = max(points, key=lambda p: p[1])
    if tile_type == "table":
        return {"rows": n_rows, "top": top_x, "top_value": _sig(top_y)}

    total = sum(y for _, y in points)
    out = {"top": top_x, "top_value": _sig(top_y), "total": _sig(total), "rows": n_rows}
    if total != 0:
        out["top_share_pct"] = _pct(top_y / total * 100)
    return out
