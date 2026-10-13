-- Bulk data generator for the retail warehouse. Run via scripts/generate-data.sh,
-- which sets these psql variables:
--   orders, customers   rows to add
--   start_date, end_date  order date range (YYYY-MM-DD)
--   growth              order volume growth across the range (0.25 = +25%)
--   seed_frac           setseed() value in [0, 1] for reproducible output
--   reset               true = truncate transactional tables first
--
-- Appends by default. Catalog tables (products, stores, employees, suppliers,
-- promotions, inventory) are left as seeded by init.sql. Everything runs in one
-- transaction, so a failure leaves the database unchanged.

\set ON_ERROR_STOP on
\set QUIET on
BEGIN;
SELECT setseed(:seed_frac) \gset

\if :reset
TRUNCATE returns, shipments, payments, order_items, orders RESTART IDENTITY;
\echo 'reset: truncated orders, order_items, payments, shipments, returns'
\endif

SELECT COALESCE(MAX(order_id), 0) AS base_order FROM orders \gset
SELECT COALESCE(MAX(customer_id), 0) AS base_cust FROM customers \gset

-- ---------------------------------------------------------------- customers
INSERT INTO customers (first_name, last_name, email, phone, signup_date,
                       loyalty_tier, city, country, is_active)
SELECT
  (ARRAY['Alex','Betty','Chris','Dana','Eddie','Fiona','Gary','Hana','Ivan','Julia',
         'Kelvin','Lily','Marco','Nora','Oscar','Peggy','Quinn','Rita','Sam','Tina'])
    [1 + floor(random() * 20)::int],
  (ARRAY['Chan','Wong','Lee','Cheung','Lam','Ng','Ho','Tsang','Lau','Yip','Tan','Lim'])
    [1 + floor(random() * 12)::int],
  'customer' || (:base_cust + s.g) || '@example.com',
  '+852-' || lpad(floor(random() * 100000000)::bigint::text, 8, '0'),
  (:'start_date'::date - 365)
    + floor(random() * (:'end_date'::date - :'start_date'::date + 365))::int,
  (ARRAY['bronze','bronze','bronze','bronze','silver','silver','silver','gold','gold','platinum'])
    [1 + floor(random() * 10)::int],
  (ARRAY['Hong Kong','Kowloon','Shenzhen','Singapore','Taipei','Tokyo'])[s.k],
  (ARRAY['Hong Kong','Hong Kong','China','Singapore','Taiwan','Japan'])[s.k],
  random() > 0.08
FROM (
  SELECT g, 1 + floor(random() * 6)::int AS k
  FROM generate_series(1, :customers) g
) s;

-- ---------------------------------------------------------------- lookup context
CREATE TEMP TABLE gen_ctx ON COMMIT DROP AS
SELECT
  (SELECT array_agg(store_id ORDER BY store_id) FROM stores WHERE store_type = 'physical') AS phys,
  (SELECT min(store_id) FROM stores WHERE store_type = 'online') AS online,
  (SELECT array_agg(customer_id ORDER BY customer_id) FROM customers) AS custs,
  (SELECT array_agg(product_id ORDER BY product_id) FROM products) AS prods;

CREATE TEMP TABLE store_emps ON COMMIT DROP AS
SELECT store_id, array_agg(employee_id ORDER BY employee_id) AS emps
FROM employees GROUP BY store_id;

-- Orders per day: monthly seasonality x weekend lift x linear growth x noise,
-- scaled so the total is ~:orders.
CREATE TEMP TABLE gen_days ON COMMIT DROP AS
WITH d AS (
  SELECT day::date AS day,
         (ARRAY[0.85,0.80,0.95,0.95,1.00,1.05,1.10,1.05,0.95,1.00,1.35,1.50])
           [extract(month FROM day)::int]
         * CASE WHEN extract(isodow FROM day) IN (6, 7) THEN 1.15 ELSE 1 END
         * (1 + :growth * (day::date - :'start_date'::date)::numeric
                / GREATEST(:'end_date'::date - :'start_date'::date, 1))
         * (0.85 + 0.3 * random()) AS w
  FROM generate_series(:'start_date'::date, :'end_date'::date, interval '1 day') day
)
SELECT day, round(:orders * w / sum(w) OVER ())::int AS n FROM d;

-- ---------------------------------------------------------------- orders
-- Status depends on age relative to end_date (recent orders are still open);
-- return rates differ by store so "which store has the most returns" has an answer.
INSERT INTO orders (customer_id, store_id, employee_id, order_date, order_status, discount_pct)
SELECT
  x.cust,
  x.store_id,
  CASE WHEN x.store_id = c.online THEN NULL
       ELSE se.emps[1 + floor(random() * cardinality(se.emps))::int] END,
  x.ts,
  CASE
    WHEN :'end_date'::date - x.ts::date < 2 THEN CASE WHEN x.r < 0.5 THEN 'pending' ELSE 'paid' END
    WHEN :'end_date'::date - x.ts::date < 6 THEN CASE WHEN x.r < 0.2 THEN 'paid' ELSE 'shipped' END
    WHEN x.r < 0.05 THEN 'cancelled'
    WHEN x.r < 0.05 + CASE WHEN x.store_id = c.online THEN 0.11
                           ELSE 0.03 + (x.store_id % 4) * 0.015 END THEN 'returned'
    ELSE 'delivered'
  END,
  CASE WHEN promo.discount_pct IS NOT NULL AND random() < 0.7 THEN promo.discount_pct
       ELSE (ARRAY[0,0,0,0,0,5,10])[1 + floor(random() * 7)::int] END
FROM (
  SELECT
    d.day + (8 * 3600 + random() * 14 * 3600) * interval '1 second' AS ts,  -- 08:00-22:00
    c.custs[1 + floor(power(random(), 1.6) * cardinality(c.custs))::int] AS cust,
    CASE WHEN random() < 0.35 THEN c.online
         ELSE c.phys[1 + floor(power(random(), 1.3) * cardinality(c.phys))::int] END AS store_id,
    random() AS r
  FROM gen_days d
  CROSS JOIN LATERAL generate_series(1, d.n) i
  CROSS JOIN gen_ctx c
) x
CROSS JOIN gen_ctx c
LEFT JOIN store_emps se ON se.store_id = x.store_id
LEFT JOIN LATERAL (
  SELECT discount_pct FROM promotions
  WHERE x.ts::date BETWEEN start_date AND end_date
  ORDER BY discount_pct DESC LIMIT 1
) promo ON TRUE
ORDER BY x.ts;

-- ---------------------------------------------------------------- order_items
-- 1-4 lines per order (skewed low); popular products are picked more often.
INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
SELECT li.order_id, p.product_id, li.qty, p.unit_price, round(p.unit_price * li.qty, 2)
FROM (
  SELECT o.order_id,
         c.prods[1 + floor(power(random(), 1.5) * cardinality(c.prods))::int] AS pid,
         (ARRAY[1,1,1,1,2,2,3,4])[1 + floor(random() * 8)::int] AS qty
  FROM orders o
  CROSS JOIN gen_ctx c
  CROSS JOIN LATERAL generate_series(1, 1 + floor(power(random(), 2) * 4 + o.order_id * 0)::int) n
  WHERE o.order_id > :base_order
) li
JOIN products p ON p.product_id = li.pid;

-- ---------------------------------------------------------------- payments
INSERT INTO payments (order_id, paid_at, amount, method, status)
SELECT
  o.order_id,
  CASE WHEN o.order_status = 'pending' THEN NULL
       ELSE o.order_date + (1 + random() * 30) * interval '1 minute' END,
  round(SUM(oi.line_total) * (1 - o.discount_pct / 100), 2),
  (ARRAY['credit_card','credit_card','credit_card','debit_card','paypal','cash','bank_transfer'])
    [1 + floor(random() * 7)::int],
  CASE
    WHEN o.order_status = 'pending' THEN 'pending'
    WHEN o.order_status = 'cancelled' THEN CASE WHEN random() < 0.5 THEN 'failed' ELSE 'refunded' END
    WHEN o.order_status = 'returned' THEN 'refunded'
    ELSE 'completed'
  END
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.order_id > :base_order
GROUP BY o.order_id, o.order_date, o.order_status, o.discount_pct;

-- ---------------------------------------------------------------- shipments
-- Same status mapping as init.sql; transit time varies by carrier.
INSERT INTO shipments (order_id, shipped_at, delivered_at, carrier, tracking_no, status)
SELECT
  s.order_id,
  s.order_date + interval '1 day',
  CASE WHEN s.order_status IN ('delivered', 'returned')
       THEN s.order_date + interval '1 day' + (s.transit_days + random() * 2) * interval '1 day'
       ELSE NULL END,
  s.carrier,
  'TRK' || lpad(s.order_id::text, 10, '0'),
  CASE
    WHEN s.order_status IN ('pending', 'paid', 'cancelled') THEN 'pending'
    WHEN s.order_status = 'shipped' THEN 'in_transit'
    ELSE 'delivered'
  END
FROM (
  SELECT o.order_id, o.order_date, o.order_status, cr.carrier, cr.transit_days
  FROM orders o
  CROSS JOIN LATERAL (
    SELECT (ARRAY['SF Express','DHL','FedEx','UPS'])[k] AS carrier,
           (ARRAY[1, 3, 4, 5])[k] AS transit_days
    FROM (SELECT 1 + floor(random() * 4 + o.order_id * 0)::int AS k) pick
  ) cr
  WHERE o.order_id > :base_order
) s;

-- ---------------------------------------------------------------- returns
-- One returned item (the first line) per returned order.
INSERT INTO returns (order_item_id, returned_at, reason, refund_amount)
SELECT DISTINCT ON (o.order_id)
  oi.order_item_id,
  o.order_date + (7 + random() * 23) * interval '1 day',
  (ARRAY['defective','defective','wrong_item','not_as_described','changed_mind','changed_mind'])
    [1 + floor(random() * 6)::int],
  oi.line_total
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.order_status = 'returned' AND o.order_id > :base_order
ORDER BY o.order_id, oi.order_item_id;

-- A customer cannot order before signing up: pull signup back to the first order.
-- Covers all orders, which also repairs older data that predates this rule.
UPDATE customers c
SET signup_date = f.first_order
FROM (
  SELECT customer_id, min(order_date)::date AS first_order
  FROM orders GROUP BY customer_id
) f
WHERE f.customer_id = c.customer_id AND f.first_order < c.signup_date;

COMMIT;
ANALYZE;

\unset QUIET
\echo
\echo 'Rows added this run:'
SELECT
  (SELECT count(*) FROM customers WHERE customer_id > :base_cust) AS customers,
  (SELECT count(*) FROM orders WHERE order_id > :base_order) AS orders,
  (SELECT count(*) FROM order_items WHERE order_id > :base_order) AS order_items,
  (SELECT count(*) FROM returns r JOIN order_items oi USING (order_item_id)
    WHERE oi.order_id > :base_order) AS returns;

\echo 'Table totals:'
SELECT
  (SELECT count(*) FROM customers) AS customers,
  (SELECT count(*) FROM orders) AS orders,
  (SELECT count(*) FROM order_items) AS order_items,
  (SELECT count(*) FROM payments) AS payments,
  (SELECT count(*) FROM shipments) AS shipments,
  (SELECT count(*) FROM returns) AS returns,
  (SELECT min(order_date)::date || ' .. ' || max(order_date)::date FROM orders) AS order_dates;
