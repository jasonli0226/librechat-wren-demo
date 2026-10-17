"""Validated body of POST /internal/charts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .shape import MIN_SCATTER_ROWS, scatter_axes

ChartType = Literal["line", "bar", "pie", "scatter"]
MAX_ROWS = 200
MAX_Y_FIELDS = 5


class ChartIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    chart_type: ChartType
    x_field: str = Field(min_length=1, max_length=128)
    y_fields: list[str] = Field(min_length=1, max_length=MAX_Y_FIELDS)
    sql: str = Field(min_length=1, max_length=20_000)
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_ROWS)

    @model_validator(mode="after")
    def check_fields(self) -> ChartIn:
        if self.chart_type == "pie" and len(self.y_fields) != 1:
            raise ValueError("pie charts take exactly one y field")
        if len(set(self.y_fields)) != len(self.y_fields) or not all(self.y_fields):
            raise ValueError("y_fields must be unique, non-empty names")
        missing = [f for f in (self.x_field, *self.y_fields) if f not in self.rows[0]]
        if missing:
            raise ValueError(f"fields not in rows: {', '.join(missing)}")
        # The dashboard draws a scatter only in "x" mode; anything else would save and then show as a table.
        axes = scatter_axes(self.x_field, self.y_fields, self.rows) if self.chart_type == "scatter" else None
        if self.chart_type == "scatter" and (axes is None or axes["mode"] != "x"):
            raise ValueError(
                f"scatter charts need at least {MIN_SCATTER_ROWS} rows with a numeric, non-year x column; "
                "use a line chart for years"
            )
        return self
