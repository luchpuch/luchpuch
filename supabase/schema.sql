-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (everything is IF NOT EXISTS / OR REPLACE).

-- Generic key/value store, used for the product catalogue. Keeps the exact
-- same shape as Netlify Blobs (store.get("products") / store.setJSON(...)),
-- so products' shape doesn't need to be reverse-engineered into columns.
create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Orders get a real table because Postgres buys you something Blobs
-- couldn't: an atomic sequence for invoice numbers with zero race window,
-- even under real concurrent checkouts. `data` holds the full order object
-- (items, billing, tax breakdown, etc.); status/courier/awb/invoice_number
-- are ALSO indexed columns so order-status can update just those without
-- reading and rewriting the whole JSON blob.
create table if not exists orders (
  id text primary key,
  email text not null,
  status text not null default 'Confirmed',
  courier text,
  awb text,
  invoice_number text,
  total numeric,
  currency text,
  created_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists idx_orders_email on orders (lower(email));
create index if not exists idx_orders_created_at on orders (created_at desc);

-- Customer-initiated cancellation. cancel_reason is the reason the customer
-- picked/typed in the "Cancel order" flow; refund_status is a separate field
-- so an order can be Cancelled while the refund itself is still in progress
-- (Requested -> Processing -> Refunded), or Not Applicable for COD orders
-- that were never charged. Admin can move refund_status forward manually
-- via order-status; the customer-facing order-cancel function only ever
-- sets it to 'Requested'.
alter table orders add column if not exists cancel_reason text;
alter table orders add column if not exists refund_status text;

create sequence if not exists invoice_seq start 1;

-- Called via supabase.rpc("next_invoice_number") from the orders function.
-- nextval() is inherently safe under concurrency — Postgres guarantees no
-- two callers ever get the same number.
create or replace function next_invoice_number(prefix text default 'LP/2026/INV-')
returns text
language sql
as $$
  select prefix || lpad(nextval('invoice_seq')::text, 3, '0')
$$;

-- Used once by migrate-to-supabase.mjs to advance the sequence past
-- whatever invoice numbers already exist in your migrated order history,
-- so the first new order after cutover doesn't reuse an old number.
create or replace function set_invoice_seq(new_value bigint)
returns void
language sql
as $$
  select setval('invoice_seq', new_value)
$$;

-- IMPORTANT: unlike the Netlify version, these tables are now reachable
-- over the public internet via Supabase's auto-generated REST API (using
-- the anon/public key), not just through your own functions. Enabling RLS
-- with no policies denies ALL access via that public API by default — your
-- Edge Functions still work fine because they use the service role key,
-- which bypasses RLS entirely. This is what stops a stranger from finding
-- your project URL and reading every order directly.
alter table kv_store enable row level security;
alter table orders enable row level security;
