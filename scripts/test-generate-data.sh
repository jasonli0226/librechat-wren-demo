#!/bin/bash
# Tests scripts/generate-data.sh against a throwaway Postgres seeded with init.sql.
# Checks referential integrity, business invariants, reproducibility and --reset.
set -euo pipefail
cd "$(dirname "$0")/.."

container=retail-gen-test-$$
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$container" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=retail \
  -e WREN_RO_PASSWORD=test \
  -v "$PWD/retail-db/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro" \
  -v "$PWD/retail-db/02-readonly-role.sh:/docker-entrypoint-initdb.d/02-readonly-role.sh:ro" \
  postgres:16-alpine >/dev/null
until docker logs "$container" 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done
until docker exec "$container" pg_isready -U postgres -d retail -q; do sleep 1; done

sql() { docker exec -i "$container" psql -U postgres -d retail -tAc "$1"; }
fail=0
check() {  # $1 = description, $2 = SQL returning a single boolean
  if [ "$(sql "$2")" = "t" ]; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi
}
gen() { PG_CONTAINER="$container" ./scripts/generate-data.sh "$@" >/dev/null; }

seed_orders=$(sql "SELECT count(*) FROM orders")
gen --orders 20000 --customers 2000 --seed 7

check "appends ~20000 orders to the seed" \
  "SELECT count(*) - $seed_orders BETWEEN 19900 AND 20100 FROM orders"
check "appends 2000 customers" "SELECT count(*) = 900 + 2000 FROM customers"
check "every order has items" \
  "SELECT NOT EXISTS (SELECT 1 FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.order_id))"
check "one payment and one shipment per order" \
  "SELECT (SELECT count(*) FROM payments) = (SELECT count(*) FROM orders)
      AND (SELECT count(*) FROM shipments) = (SELECT count(*) FROM orders)"
check "payment amount = discounted item total" \
  "SELECT bool_and(abs(p.amount - t.total) < 0.01) FROM payments p
   JOIN (SELECT o.order_id, round(sum(i.line_total) * (1 - o.discount_pct / 100), 2) AS total
         FROM orders o JOIN order_items i USING (order_id) GROUP BY o.order_id, o.discount_pct) t USING (order_id)"
check "one return per returned order, none for others" \
  "SELECT (SELECT count(*) FROM returns) = (SELECT count(*) FROM orders WHERE order_status = 'returned')
      AND NOT EXISTS (SELECT 1 FROM returns r JOIN order_items i USING (order_item_id)
                      JOIN orders o USING (order_id) WHERE o.order_status <> 'returned')"
check "returned/refunded payments line up" \
  "SELECT NOT EXISTS (SELECT 1 FROM orders o JOIN payments p USING (order_id)
                      WHERE o.order_status = 'returned' AND p.status <> 'refunded')"
check "no order before the customer's signup" \
  "SELECT NOT EXISTS (SELECT 1 FROM orders o JOIN customers c USING (customer_id)
                      WHERE o.order_date::date < c.signup_date)"
check "order dates inside the requested range" \
  "SELECT min(order_date) >= '2024-01-01' AND max(order_date) < '2026-01-01' FROM orders"
check "online orders have no employee" \
  "SELECT NOT EXISTS (SELECT 1 FROM orders o JOIN stores s USING (store_id)
                      WHERE s.store_type = 'online' AND o.employee_id IS NOT NULL AND o.order_id > $seed_orders)"
check "December busier than February (seasonality)" \
  "SELECT (SELECT count(*) FROM orders WHERE order_id > $seed_orders AND extract(month FROM order_date) = 12)
        > (SELECT count(*) FROM orders WHERE order_id > $seed_orders AND extract(month FROM order_date) = 2) * 1.5"
check "open orders only near the end of the range" \
  "SELECT NOT EXISTS (SELECT 1 FROM orders WHERE order_id > $seed_orders
                      AND order_status IN ('pending','paid','shipped') AND order_date < '2025-12-20')"
check "wren_ro can read generated rows" \
  "SELECT has_table_privilege('wren_ro', 'orders', 'SELECT')"


gen --reset --yes --orders 5000 --customers 0 --start 2025-01-01 --end 2025-03-31
check "--reset replaces orders" \
  "SELECT count(*) BETWEEN 4950 AND 5050 AND min(order_date) >= '2025-01-01' FROM orders"
check "--reset keeps customers" "SELECT count(*) = 2900 FROM customers"

gen --reset --yes --orders 20000 --customers 0 --seed 7
after=$(sql "SELECT md5(string_agg(order_date::text || customer_id || order_status, ',' ORDER BY order_id)) FROM orders")
# Customer pool differs from the first run (2900 vs 900 seeded), so compare a
# second identical run instead.
gen --reset --yes --orders 20000 --customers 0 --seed 7
again=$(sql "SELECT md5(string_agg(order_date::text || customer_id || order_status, ',' ORDER BY order_id)) FROM orders")
if [ "$after" = "$again" ]; then echo "PASS  same --seed gives identical data"; else echo "FAIL  same --seed gives identical data"; fail=1; fi


if PG_CONTAINER="$container" ./scripts/generate-data.sh --start 2025-02-01 --end 2025-01-01 >/dev/null 2>&1; then
  echo "FAIL  rejects start after end"; fail=1
else
  echo "PASS  rejects start after end"
fi

exit $fail
