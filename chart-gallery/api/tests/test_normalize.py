from gallery.normalize import NormalizedSql, dedup_key, normalize_sql

STORE_REVENUE = (
    "select s.store_name, sum(oi.line_total) as revenue -- per store\n"
    "FROM stores s JOIN orders o ON o.store_id=s.store_id "
    "JOIN order_items oi on oi.order_id = o.order_id group by 1"
)
STORE_REVENUE_RESTYLED = (
    "SELECT   S.Store_Name, SUM(OI.LINE_TOTAL) AS Revenue\n/* x */ from STORES s "
    "join ORDERS o on o.store_id = s.store_id join ORDER_ITEMS oi ON oi.order_id=o.order_id GROUP BY 1;"
)


def test_whitespace_case_and_comment_variants_normalize_identically():
    assert normalize_sql(STORE_REVENUE) == normalize_sql(STORE_REVENUE_RESTYLED)


def test_normalized_text_is_canonical_postgres():
    assert normalize_sql(STORE_REVENUE).text == (
        "SELECT s.store_name, SUM(oi.line_total) AS revenue FROM stores AS s "
        "JOIN orders AS o ON o.store_id = s.store_id "
        "JOIN order_items AS oi ON oi.order_id = o.order_id GROUP BY 1"
    )


def test_tables_are_sorted_lowercase_unique():
    assert normalize_sql(STORE_REVENUE).tables == ("order_items", "orders", "stores")


def test_quoted_identifiers_keep_their_case():
    assert normalize_sql('SELECT "Revenue" FROM orders').text == 'SELECT "Revenue" FROM orders'


def test_cte_names_are_not_tables():
    sql = "WITH m AS (SELECT count(*) AS n FROM orders) SELECT n FROM m"
    assert normalize_sql(sql).tables == ("orders",)


def test_schema_qualified_table_uses_table_name():
    assert normalize_sql("SELECT a FROM public.Orders").tables == ("orders",)


def test_table_functions_are_not_tables():
    assert normalize_sql("select * from generate_series(1, 3) g").tables == ()


def test_different_limit_is_different_sql():
    assert normalize_sql("SELECT x FROM orders LIMIT 10").text != normalize_sql("SELECT x FROM orders LIMIT 20").text


def test_unparseable_sql_falls_back_to_collapsed_lowercase():
    assert normalize_sql("SELEC  broken -- note\n (((") == NormalizedSql(text="selec broken (((", tables=())


def test_multiple_statements_fall_back():
    assert normalize_sql("SELECT 1; SELECT 2") == NormalizedSql(text="select 1; select 2", tables=())


def test_dedup_key_differs_by_chart_type_and_is_stable():
    text = normalize_sql(STORE_REVENUE).text
    assert dedup_key(text, "bar") != dedup_key(text, "pie")
    assert dedup_key(text, "bar") == dedup_key(text, "bar")
    assert len(dedup_key(text, "bar")) == 64


def test_fallback_keeps_quoted_text_verbatim():
    gold = normalize_sql("SELEC x WHERE t = 'Gold'  AND n = \"Name\" (((")
    assert gold.text == "selec x where t = 'Gold' and n = \"Name\" ((("
    assert gold != normalize_sql("SELEC x WHERE t = 'gold' AND n = \"Name\" (((")


def test_fallback_keeps_comment_markers_and_spaces_inside_literals():
    assert normalize_sql("SELEC x WHERE t = 'a  -- b /* c */' (((").text == "selec x where t = 'a  -- b /* c */' ((("


def test_fallback_handles_escaped_quotes():
    assert normalize_sql("SELEC x WHERE t = 'O''Brien' -- note\n (((").text == "selec x where t = 'O''Brien' ((("
