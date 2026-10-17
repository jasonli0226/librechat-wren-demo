"""Request model and prompt input for the AI dashboard arrangement."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .headline import TileType

MAX_TILES = 12
MAX_ALLOWED_TYPES = 5


class TileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chart_id: int
    type: TileType
    allowed_types: Annotated[list[TileType], Field(min_length=1, max_length=MAX_ALLOWED_TYPES)]

    @model_validator(mode="after")
    def _type_is_allowed(self) -> TileIn:
        if self.type not in self.allowed_types:
            raise ValueError("type must be one of allowed_types")
        return self


class ArrangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tiles: Annotated[list[TileIn], Field(min_length=1, max_length=MAX_TILES)]

    @model_validator(mode="after")
    def _unique_charts(self) -> ArrangeIn:
        ids = [tile.chart_id for tile in self.tiles]
        if len(set(ids)) != len(ids):
            raise ValueError("chart_id values must be unique")
        return self


def build_user_message(charts: list[Mapping], tiles: list[TileIn], headlines: dict[int, dict]) -> str:
    """JSON array, in tile order, of what the model may know about each chart."""
    return json.dumps(
        [
            {
                "chart_id": tile.chart_id,
                "title": chart["title"],
                "description": chart["description"],
                "tables": list(chart["tables"]),
                "type": tile.type,
                "allowed_types": tile.allowed_types,
                "columns": [chart["x_field"], *chart["y_fields"]],
                "headline": headlines[tile.chart_id],
            }
            for chart, tile in zip(charts, tiles, strict=True)
        ]
    )
