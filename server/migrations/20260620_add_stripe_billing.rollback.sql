-- Rollback: remove Stripe billing tables in dependency order.

DROP TABLE IF EXISTS stripe_webhook_events;
DROP TABLE IF EXISTS billing_subscriptions;
DROP TABLE IF EXISTS billing_customers;
