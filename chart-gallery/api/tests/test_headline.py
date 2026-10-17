from gallery.headline import headline_for


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
