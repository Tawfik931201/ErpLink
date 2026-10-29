-- Migration: Add invoice_action and picking_action to order_status_mappings
-- Allows per-status stock picking (create/validate/cancel) and invoice (create/post/cancel) actions

ALTER TABLE public.order_status_mappings
  ADD COLUMN IF NOT EXISTS invoice_action TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS picking_action TEXT DEFAULT NULL;

COMMENT ON COLUMN public.order_status_mappings.invoice_action IS 'Invoice action to perform: none, create, post, create_and_post, cancel';
COMMENT ON COLUMN public.order_status_mappings.picking_action IS 'Stock picking action to perform: none, create, validate, create_and_validate, cancel';
