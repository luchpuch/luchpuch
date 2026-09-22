# LUCHPUCH Coupon System Implementation Guide

## Overview
This document explains how the coupon system works and how to use it.

## Files Modified/Created

### Database Schema
- `supabase/coupon_schema.sql` - Contains all coupon-related tables and modifications

### Backend Functions
- `supabase/functions/coupon-validate/index.ts` - Validates coupons and calculates discounts
- `supabase/functions/admin-coupons/index.ts` - Admin CRUD operations for coupons
- Modified: `supabase/functions/orders/index.ts` - Added coupon handling during order creation

### Frontend
- Modified: `index.html` - Added coupon UI and functionality

## How to Set Up

### 1. Apply Database Schema
Run the following SQL in your Supabase dashboard (SQL Editor):

```sql
-- Contents of supabase/coupon_schema.sql
-- Run this once to set up the coupon system
```

### 2. Deploy Functions
The coupon functions should already be deployed if you've deployed your Supabase functions recently. If not, deploy them:

```bash
supabase functions deploy coupon-validate
supabase functions deploy admin-coupons
```

### 3. Ensure Secrets Are Set
Make sure you have the required secrets set in Supabase:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (already set for other functions)
- `ADMIN_KEY` (for admin access to coupon functions)

## How to Use

### Creating Coupons (Admin)
1. Open the admin panel by navigating to `#admin` in the URL
2. Enter your admin passcode when prompted
3. You'll see a new "Coupons" tab alongside Products and Orders
4. To create a coupon:
   - Enter the coupon code (e.g., `LUCHI200`)
   - Select discount type (Fixed amount or Percentage)
   - Enter the discount value (e.g., 200 for ₹200 off, or 20 for 20%)
   - Optionally set minimum order value, expiry date, usage limits, etc.
   - Toggle "Active" to enable the coupon
   - Click "Create Coupon"

Example coupons you can create:
- **LUCHI10** → Fixed amount, ₹10 off
- **WELCOME200** → Fixed amount, ₹200 off  
- **LUCHPUCH500** → Fixed amount, ₹500 off
- **SAVE10** → Percentage, 10% off
- **WELCOME10** → Percentage, 10% off

### Using Coupons (Customer)
1. Add items to your cart
2. Open the cart drawer (click the bag icon)
3. Click "Apply" next to "Have a coupon?" to show the coupon input
4. Enter your coupon code and click "Apply"
5. If valid, you'll see:
   - Success message: "✓ Coupon CODE applied"
   - Updated totals showing:
     - Subtotal: Original amount
     - Discount: -₹[amount]
     - Total: Final amount to pay
6. Proceed to checkout - the payment gateway will receive the discounted amount
7. To remove a coupon, click "Remove Coupon"

### Validation Rules
The system validates coupons server-side for:
- Existence and active status
- Start/expiry dates
- Usage limits (total and per-customer)
- Minimum order value
- Product/category eligibility (if configured)
- Mathematical validity of discount

### Security Features
- All coupon validation and discount calculation happens server-side
- Frontend only sends the coupon code, never the discount amount
- Payment gateway receives the server-calculated final amount
- Coupon usage is only recorded after successful payment
- Old orders retain their original discount even if coupon is changed later

## Database Structure

### Coupons Table
- `id` - Unique identifier
- `code` - Coupon code (stored uppercase, case-insensitive)
- `description` - Optional description
- `discount_type` - 'fixed' or 'percentage'
- `discount_value` - Amount or percentage value
- `minimum_order_value` - Minimum cart value required
- `maximum_discount` - Max discount amount (for percentage coupons)
- `starts_at` - Coupon start time (null for immediate)
- `expires_at` - Coupon expiry time (null for no expiry)
- `usage_limit` - Total usage limit (null for unlimited)
- `per_customer_limit` - Usage limit per customer (default: 1)
- `is_active` - Whether coupon is active
- `applicable_products` - Array of product IDs this applies to (null for all)
- `applicable_categories` - Array of categories this applies to (null for all)
- `excluded_products` - Array of product IDs to exclude
- `excluded_categories` - Array of categories to exclude
- Timestamps for tracking

### Coupon Usage Table
- Tracks each time a coupon is successfully used
- Links to coupon, order, customer email, and discount amount

### Orders Table Modifications
- Added coupon_id, coupon_code, discount_type, discount_value, discount_amount fields

## Example Flows

### Creating a ₹200 Off Coupon
1. Admin panel → Coupons tab
2. Code: `LUCHI200`
3. Discount Type: Fixed amount
4. Discount Value: 200
5. Leave other fields as defaults (active, no min order, etc.)
6. Click Create Coupon

### Creating a 20% Off Coupon
1. Admin panel → Coupons tab
2. Code: `WELCOME20`
3. Discount Type: Percentage
4. Discount Value: 20
5. Optional: Set Maximum Discount to 500 if you want to cap at ₹500 off
6. Click Create Coupon

## How Discount Reaches Payment Gateway
1. Customer enters coupon code in UI
2. Frontend calls `/coupon-validate` endpoint with code and cart details
3. Backend validates coupon and calculates authoritative discount
4. Backend returns validated coupon info and final amount
5. Frontend updates UI to show discounted totals
6. When customer pays:
   - Frontend sends order data including coupon code to `/orders` endpoint
   - Backend re-validates coupon and calculates discount one final time
   - Backend stores coupon info with order and records usage
   - Backend creates payment order with the FINAL DISCOUNTED AMOUNT
   - Payment gateway charges the discounted amount

## Testing the System
Test these scenarios:
1. Valid fixed amount coupon
2. Valid percentage coupon
3. Percentage coupon with maximum discount
4. Invalid coupon code
5. Expired coupon
6. Coupon that hasn't started yet
7. Usage limit exceeded
8. Per-customer limit exceeded
9. Minimum order value not met
10. Payment with discounted amount

## Troubleshooting
- If coupons aren't working, check the browser console for errors
- Verify Supabase functions are deployed and returning expected responses
- Ensure database schema has been applied correctly
- Check that admin key is set for admin coupon functions