-- Coupon system schema additions
-- Run this in Supabase SQL Editor after the existing schema

-- Coupons table to store discount codes
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, -- Case-insensitive unique coupon code (will be stored uppercase)
  description text,
  discount_type text not null check (discount_type in ('fixed', 'percentage')), -- fixed amount or percentage
  discount_value numeric not null, -- amount for fixed, percentage value for percentage
  minimum_order_value numeric default 0, -- minimum cart value required
  maximum_discount numeric, -- maximum discount amount (for percentage coupons)
  starts_at timestamptz, -- coupon start time (null for immediate)
  expires_at timestamptz, -- coupon expiry time (null for no expiry)
  usage_limit integer, -- total usage limit (null for unlimited)
  per_customer_limit integer default 1, -- usage limit per customer (null for unlimited)
  is_active boolean default true,
  applicable_products text[], -- array of product IDs this coupon applies to (null for all)
  applicable_categories text[], -- array of categories this coupon applies to (null for all)
  excluded_products text[], -- array of product IDs this coupon excludes
  excluded_categories text[], -- array of categories this coupon excludes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Coupon usage tracking
create table if not EXISTS coupon_usage (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid references coupons(id) on delete cascade,
  order_id text references orders(id) on delete cascade,
  customer_email text, -- email of customer who used the coupon
  discount_amount numeric not null, -- actual discount amount applied
  used_at timestamptz not null default now()
);

-- Enable RLS on new tables
alter table coupons enable row level security;
alter table coupon_usage enable row level security;

-- Policies for coupons (admin only for writes, public read for validation)
create policy "Coupons are viewable by everyone" on coupons
  for select using (true);

create policy "Coupon admin access" on coupons
  for all using (
    (select current_setting('app.user_role')::text) = 'admin'
  );

-- Policies for coupon usage (admin only)
create policy "Coupon usage admin access" on coupon_usage
  for all using (
    (select current_setting('app.user_role')::text) = 'admin'
  );

-- Indexes for performance
create index idx_coupons_code on coupons(upper(code));
create index idx_coupons_active on coupons(is_active) where is_active = true;
create index idx_coupon_usage_coupon on coupon_usage(coupon_id);
create index idx_coupon_usage_order on coupon_usage(order_id);
create index idx_coupon_usage_customer on coupon_usage(customer_email);

-- Add coupon fields to orders table
alter table orders add column if not exists coupon_id uuid references coupons(id);
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount_type text;
alter table orders add column if not exists discount_value numeric;
alter table orders add column if not exists discount_amount numeric;

-- Helper function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at on coupons
drop trigger if exists update_coupons_updated_at on coupons;
create trigger update_coupons_updated_at
  before update on coupons
  for each row
  execute function update_updated_at_column();

-- Grant usage on schema to anon and service_role for function access
grant usage on schema public to anon, service_role;