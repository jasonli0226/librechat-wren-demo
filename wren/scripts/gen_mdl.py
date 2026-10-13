#!/usr/bin/env python3
"""Generate Wren MDL (models/*.yml + relationships.yml) from a live Postgres schema.

Introspects information_schema in the retail database and emits Wren model
metadata files, so the MDL always matches the DB. Re-run on every container
start (idempotent). Business descriptions come from COLUMN_DOCS below —
edit that dict to enrich the semantic layer.
"""
import os
import sys
from pathlib import Path

import psycopg2
import yaml

PROJECT_DIR = Path(os.environ.get("MDL_OUT_DIR", "/wren/project"))

# (table, column) -> business description. Extend freely.
COLUMN_DOCS = {
    ("customers", "loyalty_tier"): "bronze/silver/gold/platinum membership tier",
    ("orders", "order_status"): "pending/paid/shipped/delivered/cancelled/returned",
    ("orders", "discount_pct"): "percent discount 0-100 applied to the whole order",
    ("order_items", "line_total"): "unit_price * quantity at time of sale",
    ("payments", "status"): "completed/pending/refunded/failed",
    ("products", "unit_cost"): "procurement cost per unit, for margin analysis",
    ("returns", "refund_amount"): "amount refunded to the customer",
}

TABLE_DOCS = {
    "customers": "One row per registered customer.",
    "products": "One row per sellable product, with unit price and cost.",
    "orders": "One row per customer order (header).",
    "order_items": "One row per product line within an order.",
    "payments": "One payment event per order.",
    "returns": "One row per returned order item.",
    "inventory": "Stock on hand per product per physical store.",
}

TYPE_MAP = {
    "smallint": "INTEGER", "integer": "INTEGER", "bigint": "INTEGER",
    "numeric": "DOUBLE", "decimal": "DOUBLE", "real": "DOUBLE",
    "double precision": "DOUBLE", "money": "DOUBLE",
    "character varying": "STRING", "character": "STRING", "text": "STRING", "citext": "STRING",
    "boolean": "BOOLEAN",
    "timestamp without time zone": "TIMESTAMP", "timestamp with time zone": "TIMESTAMP",
    "date": "DATE",
}


def wren_type(pg_type: str) -> str:
    t = pg_type.lower()
    for key, wtype in TYPE_MAP.items():
        if t == key or t.startswith(key + "(") or t.startswith(key + " "):
            return wtype
    return "STRING"


def main() -> None:
    conn = psycopg2.connect(
        host=os.environ["PG_HOST"], port=os.environ["PG_PORT"],
        dbname=os.environ["PG_DB"], user=os.environ["PG_USER"],
        password=os.environ["PG_PASSWORD"],
    )
    cur = conn.cursor()

    cur.execute("""
        SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position
    """)
    tables: dict[str, list[tuple]] = {}
    for tbl, col, dtype, nullable in cur.fetchall():
        tables.setdefault(tbl, []).append((col, dtype, nullable == "NO"))

    models_dir = PROJECT_DIR / "models"
    if models_dir.exists():
        for child in models_dir.iterdir():
            if child.is_dir():
                for f in child.iterdir():
                    f.unlink()
                child.rmdir()
    models_dir.mkdir(exist_ok=True)

    for tbl, cols in sorted(tables.items()):
        cur.execute("""
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = format('public.%%I', %s)::regclass AND i.indisprimary
        """, (tbl,))
        pk_rows = [r[0] for r in cur.fetchall()]
        pk = pk_rows[0] if len(pk_rows) == 1 else None

        col_entries = []
        for col, dtype, not_null in cols:
            entry = {
                "name": col,
                "type": wren_type(dtype),
                "is_calculated": False,
                "not_null": not_null,
                "properties": {},
            }
            if (tbl, col) in COLUMN_DOCS:
                entry["properties"]["description"] = COLUMN_DOCS[(tbl, col)]
            col_entries.append(entry)

        meta = {
            "name": tbl,
            "table_reference": {"catalog": "", "schema": "public", "table": tbl},
            "properties": {"description": TABLE_DOCS.get(tbl, f"Table {tbl}.")},
            "columns": col_entries,
        }
        if pk:
            meta["primary_key"] = pk
            meta["cached"] = False

        (models_dir / tbl).mkdir()
        with open(models_dir / tbl / "metadata.yml", "w") as f:
            yaml.dump(meta, f, sort_keys=False)

    # Relationships from single-column foreign keys. Uses pg_catalog because
    # information_schema.constraint_column_usage only lists tables the current
    # role owns, which hides every FK from the read-only wren_ro role.
    cur.execute("""
        SELECT src.relname, sa.attname, ref.relname, ra.attname
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = src.relnamespace
        JOIN pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = con.conkey[1]
        JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
        WHERE con.contype = 'f' AND ns.nspname = 'public'
          AND array_length(con.conkey, 1) = 1
        ORDER BY src.relname, sa.attname
    """)
    relationships = []
    seen = set()
    for tbl, col, ref_table, ref_col in cur.fetchall():
        if tbl not in tables or ref_table not in tables:
            continue
        if tbl == ref_table:
            # Self-referencing FK (e.g. product_categories.parent_id): a relationship
            # needs two distinct models, so leave hierarchy joins to hand-written SQL.
            print(f"[gen_mdl] skipping self-referencing FK {tbl}.{col}")
            continue
        name = f"{tbl}_{ref_table}"
        if name in seen:
            continue
        seen.add(name)
        # An FK always references a unique key, so the FK side is the "many" side.
        relationships.append({
            "name": name,
            "models": [tbl, ref_table],
            "join_type": "MANY_TO_ONE",
            "condition": f"{tbl}.{col} = {ref_table}.{ref_col}",
        })

    with open(PROJECT_DIR / "relationships.yml", "w") as f:
        yaml.dump({"relationships": relationships}, f, sort_keys=False)
    conn.close()

    if not tables:
        sys.exit("[gen_mdl] no tables visible to the connecting role - check GRANT SELECT")

    print(f"[gen_mdl] wrote {len(tables)} models, {len(relationships)} relationships -> {PROJECT_DIR}")


if __name__ == "__main__":
    sys.exit(main())
