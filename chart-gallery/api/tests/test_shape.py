import json
from pathlib import Path

import pytest

from gallery.shape import is_line_shaped, is_number, scatter_axes

CASES = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "chart-shapes.json").read_text()
)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture_case(case):
    chart = case["chart"]
    assert is_line_shaped(chart["x_field"], case["rows"]) is case["line_shaped"]
    assert (
        scatter_axes(chart["x_field"], chart["y_fields"], case["rows"])
        == case["scatter"]
    )


def test_no_case_is_both_line_and_scatter():
    assert [c["name"] for c in CASES if c["line_shaped"] and c["scatter"] is not None] == []


def test_is_number_rejects_int_too_large_for_float():
    assert is_number(10**400) is False
