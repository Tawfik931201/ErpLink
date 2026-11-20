# ERP Link browser notifications (Chrome / desktop)
The in-app inbox is durable and scoped to the active workspace. Zid, Salla and Shopify webhook arrivals are recorded immediately after their durable receipt, independently of Odoo. Sync outcomes are recorded separately. The notification sender never writes to Odoo.

## Required production setup
1. Apply `supabase/migrations/20261120_browser_push_notifications.sql` before deploying code.
2. Generate an **ES256 / P-256 VAPID** key pair securely on the server. Store the uncompressed public point (65 bytes, leading 0x04) as unpadded base64url in `WEB_PUSH_VAPID_PUBLIC_KEY`, and the private scalar (32 bytes) as unpadded base64url in `WEB_PUSH_VAPID_PRIVATE_KEY`. Keep the private key in Hostinger environment variables, not in GitHub.
3. Set `WEB_PUSH_CONTACT=mailto:notifications@your-domain.example` to a real monitored admin address. Configure HTTPS on the application domain and restart the Node server.
4. An authenticated user clicks the bell inside ERP Link and chooses **تفعيل إشعارات Chrome**. Chrome requires a user gesture and explicit permission; automatic permission approval is not possible.
5. In Chrome OS settings, enable notification delivery for the browser/site to receive alerts while the ERP Link tab is closed.

The sender starts on a long-running Node server with VAPID configured, every 30 seconds. Serverless/Vercel deployments need a separate scheduled sender; this implementation intentionally does not claim background delivery for those deployments. Delivery failures are retried with backoff and expired subscriptions disabled. No service worker fetch handler is installed, so neither point-of-sale traffic nor Odoo mapping is intercepted.

## Performance
Telegram idle outbox polling defaults to 10 seconds (previously 2 seconds); optional `TELEGRAM_OUTBOX_POLL_INTERVAL_MS` may be set to 2000–60000. The Odoo synchronization interval is unchanged.

## Verification checklist
- Browser with permission granted: create a Zid order and verify "received" in the bell **before** the order sync reaches Odoo.
- Switch workspace: confirm no events or subscriptions from the previous workspace are returned.
- Shut the tab (leave Chrome allowed to run in background): new orders should produce a desktop notification after the sender processes the outbox.
- Simulate Odoo mapping failure: arrival still visible, followed by a failed status notification. Original queue and retry behavior must remain unchanged.
- Disable push: sender no longer targets that device. Re-enable and verify new events.
- Check Supabase logs and delivery retry rows after deployment. Keep actual send counts and latency under observation.
- Run `npm test -- --runInBand` and `npm run type-check` on the deployed commit.

If VAPID settings are missing, in-app notifications remain available; Chrome push is intentionally unavailable and the UI explains why. Never put VAPID secrets in public variables.
