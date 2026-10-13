-- Mock retail database: 13 tables, seeded with ~24 months of data
-- Rebuild with: docker compose down -v && docker compose up -d retail-postgres

CREATE TABLE customers (
    customer_id   SERIAL PRIMARY KEY,
    first_name    VARCHAR(50) NOT NULL,
    last_name     VARCHAR(50) NOT NULL,
    email         VARCHAR(120) UNIQUE NOT NULL,
    phone         VARCHAR(30),
    signup_date   DATE NOT NULL,
    loyalty_tier  VARCHAR(20) NOT NULL DEFAULT 'bronze',  -- bronze/silver/gold/platinum
    city          VARCHAR(60),
    country       VARCHAR(60),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE product_categories (
    category_id   SERIAL PRIMARY KEY,
    category_name VARCHAR(60) NOT NULL UNIQUE,
    parent_id     INTEGER REFERENCES product_categories(category_id)
);

CREATE TABLE suppliers (
    supplier_id    SERIAL PRIMARY KEY,
    supplier_name  VARCHAR(100) NOT NULL,
    contact_email  VARCHAR(120),
    country        VARCHAR(60),
    lead_time_days INTEGER NOT NULL DEFAULT 14
);

CREATE TABLE products (
    product_id    SERIAL PRIMARY KEY,
    product_name  VARCHAR(120) NOT NULL,
    category_id   INTEGER NOT NULL REFERENCES product_categories(category_id),
    supplier_id   INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    unit_price    NUMERIC(10,2) NOT NULL,
    unit_cost     NUMERIC(10,2) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    launch_date   DATE
);

CREATE TABLE stores (
    store_id    SERIAL PRIMARY KEY,
    store_name  VARCHAR(80) NOT NULL,
    city        VARCHAR(60),
    country     VARCHAR(60),
    opened_date DATE,
    store_type  VARCHAR(30) NOT NULL DEFAULT 'physical'  -- physical/online
);

CREATE TABLE employees (
    employee_id  SERIAL PRIMARY KEY,
    full_name    VARCHAR(100) NOT NULL,
    store_id     INTEGER REFERENCES stores(store_id),
    role         VARCHAR(40) NOT NULL,       -- manager/salesperson/cashier/analyst
    hire_date    DATE NOT NULL,
    salary       NUMERIC(10,2)
);

CREATE TABLE inventory (
    inventory_id  SERIAL PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(product_id),
    store_id      INTEGER NOT NULL REFERENCES stores(store_id),
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 20,
    last_restocked DATE
);

CREATE TABLE orders (
    order_id      SERIAL PRIMARY KEY,
    customer_id   INTEGER NOT NULL REFERENCES customers(customer_id),
    store_id      INTEGER REFERENCES stores(store_id),
    employee_id   INTEGER REFERENCES employees(employee_id),
    order_date    TIMESTAMP NOT NULL,
    order_status  VARCHAR(20) NOT NULL,      -- pending/paid/shipped/delivered/cancelled/returned
    discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES orders(order_id),
    product_id    INTEGER NOT NULL REFERENCES products(product_id),
    quantity      INTEGER NOT NULL,
    unit_price    NUMERIC(10,2) NOT NULL,   -- price at time of sale
    line_total    NUMERIC(12,2) NOT NULL
);

CREATE TABLE payments (
    payment_id   SERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(order_id),
    paid_at      TIMESTAMP,
    amount       NUMERIC(12,2) NOT NULL,
    method       VARCHAR(20) NOT NULL,       -- credit_card/debit_card/paypal/cash/bank_transfer
    status       VARCHAR(20) NOT NULL        -- completed/pending/refunded/failed
);

CREATE TABLE shipments (
    shipment_id  SERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(order_id),
    shipped_at   TIMESTAMP,
    delivered_at TIMESTAMP,
    carrier      VARCHAR(40),
    tracking_no  VARCHAR(40),
    status       VARCHAR(20) NOT NULL        -- pending/in_transit/delivered/lost
);

CREATE TABLE returns (
    return_id    SERIAL PRIMARY KEY,
    order_item_id INTEGER NOT NULL REFERENCES order_items(order_item_id),
    returned_at  TIMESTAMP NOT NULL,
    reason       VARCHAR(40) NOT NULL,       -- defective/wrong_item/not_as_described/changed_mind
    refund_amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE promotions (
    promotion_id  SERIAL PRIMARY KEY,
    promo_name    VARCHAR(80) NOT NULL,
    discount_pct  NUMERIC(5,2) NOT NULL,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    channel       VARCHAR(30) NOT NULL       -- email/social/instore/search
);

-- The read-only wren_ro role is created by 02-readonly-role.sh (password from env)

-- ============================= SEED DATA =============================

INSERT INTO product_categories (category_name, parent_id) VALUES
 ('Electronics', NULL), ('Computers', 1), ('Mobile Phones', 1), ('Audio', 1),
 ('Home & Kitchen', NULL), ('Furniture', 5), ('Appliances', 5),
 ('Sports & Outdoors', NULL), ('Fitness', 8), ('Books', NULL), ('Toys & Games', NULL);

INSERT INTO suppliers (supplier_name, contact_email, country, lead_time_days)
SELECT
  'Supplier ' || g,
  'contact' || g || '@supplier' || g || '.com',
  (ARRAY['China','Vietnam','Germany','USA','Japan','Taiwan'])[1 + (g % 6)],
  7 + (g % 21)
FROM generate_series(1, 25) g;

INSERT INTO products (product_name, category_id, supplier_id, unit_price, unit_cost, launch_date)
SELECT
  (ARRAY['Wireless','Smart','Pro','Ultra','Classic','Eco','Max','Lite','Prime','Nova'])[1 + (g % 10)]
    || ' ' ||
  (ARRAY['Headphones','Laptop','Phone','Speaker','Blender','Desk','Chair','Watch','Camera','Tablet'])[1 + (g % 10)]
    || ' ' || (100 + (g * 7) % 900)::text,
  1 + (g % 11),
  1 + (g % 25),
  ROUND((20 + random() * 980)::numeric, 2),
  ROUND(((20 + random() * 980) * (0.45 + random() * 0.25))::numeric, 2),
  DATE '2021-01-01' + (random() * 1500)::int
FROM generate_series(1, 150) g;

INSERT INTO stores (store_name, city, country, opened_date, store_type) VALUES
 ('Flagship Central','Hong Kong','Hong Kong','2015-03-01','physical'),
 ('Kowloon West','Hong Kong','Hong Kong','2017-06-15','physical'),
 ('NT Plaza','Hong Kong','Hong Kong','2019-11-20','physical'),
 ('Web Store','Online','Global','2016-01-10','online'),
 ('Singapore Hub','Singapore','Singapore','2021-04-05','physical'),
 ('Taipei Express','Taipei','Taiwan','2022-09-01','physical');

INSERT INTO employees (full_name, store_id, role, hire_date, salary)
SELECT
  'Employee ' || g,
  1 + (g % 6),
  (ARRAY['manager','salesperson','cashier','analyst'])[1 + (g % 4)],
  DATE '2018-01-01' + (random() * 2000)::int,
  ROUND((18000 + random() * 32000)::numeric, 2)
FROM generate_series(1, 40) g;

INSERT INTO customers (first_name, last_name, email, phone, signup_date, loyalty_tier, city, country, is_active)
SELECT
  (ARRAY['Alex','Betty','Chris','Dana','Eddie','Fiona','Gary','Hana','Ivan','Julia'])[1 + (g % 10)],
  (ARRAY['Chan','Wong','Lee','Cheung','Lam','Ng','Ho','Tsang'])[1 + (g % 8)],
  'user' || g || '@example.com',
  '+852-6' || lpad(((g * 137) % 100000000)::text, 8, '0'),
  DATE '2023-01-01' + (random() * 730)::int,
  (ARRAY['bronze','bronze','bronze','silver','silver','gold','platinum'])[1 + (g % 7)],
  (ARRAY['Hong Kong','Shenzhen','Singapore','Taipei','Kowloon','Tokyo'])[1 + (g % 6)],
  (ARRAY['Hong Kong','China','Singapore','Taiwan','Japan'])[1 + (g % 5)],
  random() > 0.08
FROM generate_series(1, 900) g;

INSERT INTO promotions (promo_name, discount_pct, start_date, end_date, channel) VALUES
 ('Spring Sale 2024', 10.00, '2024-03-01', '2024-03-31', 'email'),
 ('Summer Blowout', 15.00, '2024-07-01', '2024-07-31', 'social'),
 ('Black Friday', 20.00, '2024-11-24', '2024-11-30', 'search'),
 ('Holiday Special', 12.50, '2024-12-15', '2024-12-31', 'email'),
 ('New Year Kickoff', 8.00, '2025-01-02', '2025-01-15', 'instore'),
 ('Anniversary Deal', 18.00, '2025-03-01', '2025-03-14', 'social'),
 ('Summer Flash', 10.00, '2025-07-01', '2025-07-15', 'search'),
 ('Year End Clearance', 25.00, '2025-12-01', '2025-12-31', 'email');

INSERT INTO orders (customer_id, store_id, employee_id, order_date, order_status, discount_pct)
SELECT
  1 + (g % 900),
  CASE WHEN random() < 0.35 THEN 4 ELSE 1 + (g % 3) END,
  1 + (g % 40),
  TIMESTAMP '2024-01-01 08:00' + (random() * 730 * 24) * interval '1 hour',
  (ARRAY['pending','paid','shipped','delivered','delivered','delivered','cancelled','returned'])[1 + (g % 8)],
  ROUND((ARRAY[0,0,0,5,10,15])[1 + (g % 6)]::numeric, 2)
FROM generate_series(1, 14000) g;

INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
SELECT
  o.order_id,
  p.product_id,
  1 + ((o.order_id + n) % 4),
  p.unit_price,
  ROUND((p.unit_price * (1 + ((o.order_id + n) % 4)))::numeric, 2)
FROM orders o
CROSS JOIN LATERAL generate_series(1, 1 + (o.order_id % 3)) AS n
JOIN products p ON p.product_id = ((o.order_id * 13 + n * 7) % 150) + 1;

INSERT INTO payments (order_id, paid_at, amount, method, status)
SELECT
  o.order_id,
  CASE WHEN o.order_status IN ('pending') THEN NULL ELSE o.order_date + interval '5 minutes' END,
  ROUND(SUM(oi.line_total) * (1 - o.discount_pct / 100), 2),
  (ARRAY['credit_card','credit_card','debit_card','paypal','cash','bank_transfer'])[1 + (o.order_id % 6)],
  CASE
    WHEN o.order_status = 'pending' THEN 'pending'
    WHEN o.order_status = 'cancelled' THEN (ARRAY['failed','refunded'])[1 + (o.order_id % 2)]
    WHEN o.order_status = 'returned' THEN 'refunded'
    ELSE 'completed'
  END
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY o.order_id, o.order_date, o.order_status, o.discount_pct;

INSERT INTO shipments (order_id, shipped_at, delivered_at, carrier, tracking_no, status)
SELECT
  o.order_id,
  o.order_date + interval '1 day',
  CASE WHEN o.order_status IN ('delivered','returned')
       THEN o.order_date + interval '4 day' ELSE NULL END,
  (ARRAY['SF Express','DHL','FedEx','UPS'])[1 + (o.order_id % 4)],
  'TRK' || lpad(o.order_id::text, 10, '0'),
  CASE
    WHEN o.order_status IN ('pending','paid') THEN 'pending'
    WHEN o.order_status = 'shipped' THEN 'in_transit'
    WHEN o.order_status = 'cancelled' THEN 'pending'
    WHEN o.order_status = 'returned' THEN 'delivered'
    ELSE 'delivered'
  END
FROM orders o;

-- returns: for orders marked 'returned', return 1 item (the first line)
INSERT INTO returns (order_item_id, returned_at, reason, refund_amount)
SELECT DISTINCT ON (o.order_id)
  oi.order_item_id,
  o.order_date + interval '10 day',
  (ARRAY['defective','wrong_item','not_as_described','changed_mind'])[1 + (oi.order_item_id % 4)],
  oi.line_total
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.order_status = 'returned'
ORDER BY o.order_id, oi.order_item_id;

INSERT INTO inventory (product_id, store_id, quantity_on_hand, reorder_level, last_restocked)
SELECT
  p.product_id,
  s.store_id,
  (random() * 300)::int,
  20 + (p.product_id % 5) * 10,
  DATE '2025-06-01' - (random() * 180)::int
FROM products p
CROSS JOIN stores s
WHERE s.store_type = 'physical';

-- A customer cannot order before signing up: pull signup back to the first order
UPDATE customers c
SET signup_date = f.first_order
FROM (SELECT customer_id, min(order_date)::date AS first_order FROM orders GROUP BY customer_id) f
WHERE f.customer_id = c.customer_id AND f.first_order < c.signup_date;

CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE INDEX idx_items_product ON order_items(product_id);
CREATE INDEX idx_payments_order ON payments(order_id);
