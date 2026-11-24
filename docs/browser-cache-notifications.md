# Browser-cache notifications (cost-first MVP)

## Architecture: ZERO Supabase Realtime

- **No Supabase Realtime channels, sockets, change feeds, or subscriptions.**
- **Existing `webhook_inbox`** is the durable source of events; no duplicated notification-event rows.
- **IndexedDB** (`erplink-browser-notifications`) holds per-user, per-workspace notification history and read/unread flags. It is a local cache, not durable audit storage.
- **One small table** (`browser_push_subscriptions`) holds encrypted browser push endpoint credentials, workspace membership and a per-device cursor. The server needs this to deliver when the website is closed.
- **Existing authenticated `/api/cron/sync-queue`** drives a bounded Push worker. No new realtime hosting or Firebase fees. Push failures must not block Zid/Odoo synchronization.
- **Native Web Push (RFC 8291) + VAPID** through Node crypto, no new runtime package.
- When the app becomes visible, it reads a bounded feed from the **existing** inbox; periodic polling is limited to once per minute while visible. Push messages themselves notify active tabs. No realtime DB connection is opened.
- Browser permission prompt appears only after a user click.

## Deployment prerequisites

1. Apply `supabase/migrations/20261120173000_browser_push_subscriptions.sql` to the correct ERP Link database, only after verifying the actual schema. Migration is not applied automatically.
2. Generate one P-256 VAPID keypair and securely store these server environment variables:
   - `WEB_PUSH_VAPID_PUBLIC_KEY`
   - `WEB_PUSH_VAPID_PRIVATE_KEY`
   - `WEB_PUSH_SUBJECT` (mailto: or HTTPS URL identifying the application)
3. Configure Hostinger to run the existing authenticated `/api/cron/sync-queue` routinely. Push speed depends on cron cadence; this is not an instant-delivery guarantee.
4. Test Chrome push notification permission and background delivery on actual Windows/macOS devices, including the browser fully closed (which depends on Chrome and OS background settings).
5. Verify workspace isolation, two accounts on one browser, signout/device revocation, malformed subscriptions and duplicate webhooks.
6. Run `npm run type-check`, targeted Jest tests and production build. This PR has not yet passed those CI checks.

## Current MVP limitations / follow-ups

- Push events presently include order/product receipt and update events from Zid; status-of-Odoo-sync notification, returns, preference controls and advanced notification search are follow-up features.
- Local history is device-specific and can be cleared by browser data removal.
- No Realtime, but reading `webhook_inbox` and storing device subscriptions still consume modest Supabase database operations.
- The existing worker sends at cron frequency, not necessarily immediately after webhook ingestion.
- Because browsers share OS-level push registrations, revoke subscription on logout, user switch or lost membership on server, too, before considering a production rollout. Avoid confidential order/customer details in the push payload until that is validated.
- To scale to many thousands of devices, add claim-safe batching, stable cursors and delivery retries, rather than scanning a large device set on every queue cron.

## Design decision

Keep notification **history and read state** on the client, but keep only essential push routing metadata on the server. This is the smallest practical deployment without Supabase Realtime and without jeopardizing Zid/Odoo's durable queue.
