"""Headline numbers for dashboard tiles, computed from a chart's stored snapshot rows.

The LLM summary writer is given these values and the browser checks the summary's numbers
against them, so they are rounded once, here, and returned exactly as they will be shown.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any, Literal

from .shape import is_number, scatter_axes

TileType = Literal["stat", "line", "bar", "stackedBar", "scatter", "table"]

SIGNIFICANT_DIGITS = 4
PCT_DECIMALS = 1
R_DECIMALS = 2
MIN_CORRELATION_POINTS = 2


def _sig(value: float) -> float | int:
    rounded = float(f"{value:.{SIGNIFICANT_DIGITS}g}")
    return int(rounded) if rounded.is_integer() else rounded


def _pct(value: float) -> float:
    return round(value, PCT_DECIMALS)


def _pearson_r(points: Sequence[tuple[float, float]]) -> float | None:
    """Pearson correlation, or None when it is undefined (too few points, or a flat axis)."""
    if len(points) < MIN_CORRELATION_POINTS:
        return None
    mean_x = math.fsum(x for x, _ in points) / len(points)
    mean_y = math.fsum(y for _, y in points) / len(points)
    cov = math.fsum((x - mean_x) * (y - mean_y) for x, y in points)
    var_x = math.fsum((x - mean_x) ** 2 for x, _ in points)
    var_y = math.fsum((y - mean_y) ** 2 for _, y in points)
    if var_x == 0 or var_y == 0:
        return None
    return cov / math.sqrt(var_x * var_y)


def _scatter_headline(chart: Mapping[str, Any]) -> dict[str, Any]:
    axes = scatter_axes(chart["x_field"], chart["y_fields"], chart["rows"])
    if axes is None:
        return {"rows": len(chart["rows"])}
    x_key, y_key = axes["x"], axes["ys"][0]
    points = [
        (row[x_key], row[y_key])
        for row in chart["rows"]
        if is_number(row.get(x_key)) and is_number(row.get(y_key))
    ]
    if not points:
        return {"rows": len(chart["rows"])}
    xs, ys = [x for x, _ in points], [y for _, y in points]
    out: dict[str, Any] = {"scatter_points": len(points)}
    r = _pearson_r(points)
    if r is not None:
        out["r"] = round(r, R_DECIMALS)
    out.update(x_min=_sig(min(xs)), x_max=_sig(max(xs)), y_min=_sig(min(ys)), y_max=_sig(max(ys)))
    return out


def _points(chart: Mapping[str, Any]) -> list[tuple[Any, float]]:
    x_field = chart["x_field"]
    y_field = chart["y_fields"][0]
    return [
        (row.get(x_field), row[y_field])
        for row in chart["rows"]
        if is_number(row.get(y_field))
    ]


def headline_for(chart: Mapping[str, Any], tile_type: TileType) -> dict[str, float | int | str]:
    if tile_type == "scatter":
        return _scatter_headline(chart)

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


def headlines_for(
    chart: Mapping[str, Any], types: Sequence[TileType]
) -> dict[str, float | int | str]:
    """Union of the headline facts for every type the tile may take.

    Shared keys (e.g. "rows") carry the same value in every type, so merge order is irrelevant.
    """
    merged: dict[str, float | int | str] = {}
    for tile_type in types:
        merged.update(headline_for(chart, tile_type))
    return merged
