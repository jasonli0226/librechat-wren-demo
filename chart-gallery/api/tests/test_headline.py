from gallery.headline import headline_for, headlines_for


def chart(pairs, x="k", y="v"):
    return {"rows": [{x: a, y: b} for a, b in pairs], "x_field": x, "y_fields": [y]}


def test_stat():
    c = chart([("all", 8_212_345.67)])
    assert headline_for(c, "stat") == {"value": 8_212_000}


def test_line_pct_change():
    c = chart([("a", 100), ("b", 90), ("c", 112)])
    assert headline_for(c, "line") == {"first": 100, "last": 112, "points": 3, "pct_change": 12.0}


def test_line_zero_first_omits_pct():
    c = chart([("a", 0), ("b", 5)])
    result = headline_for(c, "line")
    assert "pct_change" not in result
    assert result["first"] == 0 and result["last"] == 5


def test_bar_top_and_share():
    c = chart([("A", 30), ("B", 50), ("C", 20)])
    expected = {"top": "B", "top_value": 50, "total": 100, "top_share_pct": 50.0, "rows": 3}
    assert headline_for(c, "bar") == expected
    assert headline_for(c, "stackedBar") == expected


def test_ignores_null_and_string_values():
    c = chart([("A", None), ("B", "12"), ("C", 5)])
    result = headline_for(c, "bar")
    assert result["top"] == "C"
    assert result["total"] == 5


def test_ignores_bool_and_non_finite():
    c = chart([("A", True), ("B", float("nan")), ("C", float("inf")), ("D", 7)])
    result = headline_for(c, "bar")
    assert result["top"] == "D" and result["total"] == 7


def test_no_numeric_values():
    c = chart([("A", None), ("B", None)])
    assert headline_for(c, "bar") == {"rows": 2}


def test_table_top():
    c = chart([("A", 1.23456), ("B", 9.87654)])
    assert headline_for(c, "table") == {"rows": 2, "top": "B", "top_value": 9.877}


def test_bar_zero_total_omits_share():
    c = chart([("A", 0), ("B", 0)])
    assert "top_share_pct" not in headline_for(c, "bar")


def scatter_chart(xs, ys, x="x", y="y"):
    return {"rows": [{x: a, y: b} for a, b in zip(xs, ys)], "x_field": x, "y_fields": [y]}


def test_scatter_x_mode():
    c = scatter_chart([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
    assert headline_for(c, "scatter") == {
        "scatter_points": 5, "r": 1.0, "x_min": 1, "x_max": 5, "y_min": 2, "y_max": 10,
    }


def test_scatter_pair_mode_uses_first_two_y():
    rows = [{"name": f"n{i}", "a": i, "b": 10 - i} for i in range(6)]
    c = {"rows": rows, "x_field": "name", "y_fields": ["a", "b"]}
    assert headline_for(c, "scatter") == {
        "scatter_points": 6, "r": -1.0, "x_min": 0, "x_max": 5, "y_min": 5, "y_max": 10,
    }


def test_scatter_constant_axis_omits_r():
    result = headline_for(scatter_chart([3] * 5, [1, 2, 3, 4, 5]), "scatter")
    assert "r" not in result
    assert result["scatter_points"] == 5


def test_scatter_counts_only_rows_with_both_axes():
    result = headline_for(scatter_chart([1, 2, 3, 4, 5], [2, None, 6, 8, 10]), "scatter")
    assert result["scatter_points"] == 4


def test_scatter_without_axes_falls_back_to_rows():
    assert headline_for(scatter_chart([1, 2], [3, 4]), "scatter") == {"rows": 2}


def test_headlines_for_merges_without_conflict():
    c = chart([("A", 30), ("B", 50), ("C", 20)])
    merged = headlines_for(c, ["bar", "table"])
    singles = [headline_for(c, "bar"), headline_for(c, "table")]
    assert merged.keys() == singles[0].keys() | singles[1].keys()
    for single in singles:
        for key, value in single.items():
            assert merged[key] == value
