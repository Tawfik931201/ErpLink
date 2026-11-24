# Agent 7: Accounts, Workspaces & Support Findings

> **Audit Date:** 2026-11-24  
> **Auditor:** Agent 7 — Accounts, Workspaces & Support Specialist  
> **Target Scope:** Customer onboarding, Clerk authentication, workspace management & switching, team members & RBAC permissions, manual subscriptions & free trial lifecycle, support tickets (Odoo Studio Helpdesk), contact inbox, user profile settings, and administrative capabilities.

---

## 1. Executive Summary & Core Architectural Principles

ERP Link implements a multi-tenant, multi-workspace B2B architecture designed specifically for e-commerce merchants integrating platforms like Zid, Salla, and Shopify with Odoo ERP. 

Key architectural pillars identified during code inspection:
1. **Authentication via Clerk**: Clerk handles primary user authentication (`userId` string). Clerk webhooks and internal database helpers synchronize user profiles into Supabase `users`.
2. **Multi-Workspace Isolation**: Workspaces (`workspaces` table) serve as the fundamental isolation boundary. Integration credentials, field mappings, queue items, and sync logs are strictly bound to `workspace_id`.
3. **Workspace Ownership & Granular RBAC**: Each workspace has a single Owner (`workspaces.user_id`) and zero or more Members (`workspace_members`). Member access is regulated via 9 granular page-level permissions.
4. **Manual-Only Subscriptions & 7-Day Free Trial**: The affiliate system was permanently cancelled (2026-09-10). Payments are 100% manual (wire transfer/offline) without payment gateways. Every new workspace receives an automatic 7-day free trial derived from its creation timestamp. Expired workspaces (trial or subscription) trigger an app access gate (`workspaceClosed`).
5. **Decoupled Support Infrastructure (Central Odoo Studio)**: Support tickets and contact messages **do not touch Supabase**. They are managed in a dedicated central Odoo Studio instance (`x_erplink_support_ticket` and `x_erplink_contact_inbox`), featuring real-time SSE streams, Odoo chatter synchronization, read receipts, and file attachments.
6. **Platform Administration & Controlled Impersonation**: Platform administrators are identified via the `ADMIN_USER_IDS` environment variable. Admins can view cross-tenant statistics, manage manual billing, review client statements, and impersonate client users with an automatic 15-minute time-bound cookie and enforced read-only write blocks.

---

## 2. Customer Onboarding & Authentication Flow

### 2.1 Sign-Up and Sign-In Routing
- **Public Routes**:
  - Sign-In: `/(public)/sign-in/[[...sign-in]]/page.tsx` rendering [`sign-in-client.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(public)/sign-in/[[...sign-in]]/sign-in-client.tsx)
  - Sign-Up: `/(public)/sign-up/[[...sign-up]]/page.tsx` rendering [`sign-up-client.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(public)/sign-up/[[...sign-up]]/sign-up-client.tsx)
- **Component Wrapper & Theming**:
  - Wrapped in [`EmbeddedStorageGate`](file:///e:/توفيق/zid/zidlink2/src/components/embedded-storage-gate.tsx) to handle browser storage access restrictions in embedded iframe contexts.
  - Theming is dynamic via [`getClerkAppearance`](file:///e:/توفيق/zid/zidlink2/src/lib/clerk-appearance.ts), syncing with `next-themes` (Dark/Light).
  - Defaults: `fallbackRedirectUrl="/app/dashboard"`. If launched via Zid OAuth redirect, `forceRedirectUrl="/connect/zid"`.

### 2.2 Middleware Protection & Route Resolution
All requests pass through [`src/middleware.ts`](file:///e:/توفيق/zid/zidlink2/src/middleware.ts):
- **Protected Paths**: `/app(.*)`, `/admin((?!/api).*)`, and `/onboarding(.*)` require authentication via `await auth.protect()`.
- **Legacy Route Redirection**: Old bookmarks and OAuth callbacks targeting `/dashboard/*` are 307/308 redirected or internally rewritten to `/app/*` (e.g., `/dashboard/workspace` &rarr; `/app/settings/workspace`).
- **Mutation Safety**: POST/PUT/DELETE requests carrying Server Action headers (`next-action`, `x-action-forwarded`, `rsc`) are never 307 redirected to avoid corrupting request payloads and socket timeouts.
- **Zid Embedded Launch**: Inbound requests carrying `?token=<uuid>` (from the Zid App Marketplace iframe) are redirected to `/embedded`, where the token is exchanged for a one-time session ticket to bypass cross-site third-party cookie blocks.
- **Shopify Launch**: Inbound visits with `shop` and `hmac` query parameters are forwarded to `/api/shopify/connect`.

### 2.3 User Provisioning & Webhooks
User identity synchronization operates on dual paths:
1. **Svix-Verified Clerk Webhook** ([`src/app/api/webhooks/clerk/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/webhooks/clerk/route.ts)):
   - Listens for `user.created` events.
   - Enforces HMAC-SHA256 signature verification using `CLERK_WEBHOOK_SECRET` and timestamp freshness (within 5 minutes).
   - Inserts row into `users` (`id`, `email`, `name`).
   - Automatically invokes `ensureDefaultWorkspace(userId)` to bootstrap a "Default" workspace.
2. **Lazy Runtime Provisioning** ([`src/lib/users.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/users.ts#L8-L97)):
   - `getOrCreateDbUser(userId)` runs on every server action.
   - Uses a lean column select (`id,email,name,active_workspace_id,created_at`). Note: `phone` is explicitly excluded to avoid schema mismatches across environments.
   - Uses race-safe `upsert(..., { onConflict: 'id', ignoreDuplicates: true })` to prevent 409 collisions during parallel server component renders.
   - Ensures an active workspace is assigned via [`ensureDefaultWorkspace`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-defaults.ts).

### 2.4 User Profile & Interface Preferences
- **Clerk Profile Modal**: Accessed via [`UserMenu`](file:///e:/توفيق/zid/zidlink2/src/components/user-menu.tsx#L109-L115), invoking `openUserProfile` with themed modal styling.
- **Language Toggle**: Fast switch between Arabic (`ar`) and English (`en`). Persists to `users.language` and the `lang` cookie via [`updateUserSettings`](file:///e:/توفيق/zid/zidlink2/src/app/actions/settings.ts#L43-L75). Sets direction (`dir="rtl"` vs `dir="ltr"`).
- **Theme Switcher**: Fast switch between Light and Dark mode. Persists to `users.theme` and `next-themes`.
- **General Settings Page**: Located at [`/app/settings`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/page.tsx).

---

## 3. Workspace Architecture & Switching

### 3.1 Workspace Lifecycle & Creation Policy
The workspace lifecycle is managed in [`src/app/actions/workspaces.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/workspaces.ts) and [`src/lib/workspace-defaults.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-defaults.ts):
- **Default Workspace Creation Rules**:
  1. Checks if `users.active_workspace_id` points to a valid, accessible workspace.
  2. If none, checks if user owns any workspace (`workspaces.user_id == userId`).
  3. If none, checks if user is a member of any workspace (`workspace_members`).
  4. If user has 0 workspaces: checks `audit_logs` for `action = 'workspace.delete'`. If the user intentionally deleted all workspaces, it **does not recreate** one. If brand new (never deleted), it creates a workspace named `"Default"`.
- **Creating a Workspace (`createWorkspace`)**:
  - Any authenticated user can create new workspaces at `/app/settings/workspace`.
  - Automatically activates the newly created workspace if the user's current workspace is closed (expired trial/subscription) or unselected.
  - Each newly created workspace starts its own independent 7-day free trial from `created_at`.
- **Updating Workspace (`updateWorkspace`)**:
  - Restricted strictly to the workspace owner (`workspace.user_id === user.id`).
- **Deep Purge Deletion (`deleteWorkspace`)**:
  - Restricted strictly to the workspace owner.
  - Executes comprehensive cascading cleanup via [`purgeWorkspaceData`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-purge.ts):
    - Purges sync logs (`sync_logs`), sync queues (`sync_queue`), archived queue items (`sync_queue_archive`).
    - Purges merchant tokens (`merchant_tokens`), Salla tokens (`salla_tokens`), Shopify tokens (`shopify_tokens`).
    - Purges ERP connections (`erp_connections`), field mappings (`field_mappings`), static mappings (`static_mappings`), entity links (`entity_links`).
    - Purges Telegram bots (`telegram_bots`), chat subscriptions (`telegram_chat_subscriptions`).
    - Unregisters store webhooks on Zid, Salla, and Shopify (best-effort).
    - Nulls out `active_workspace_id` for all users referencing this workspace.
    - Records an audit log entry (`workspace.delete`).

### 3.2 Workspace Switching Mechanism
- **Active Workspace Storage**: Persisted in `users.active_workspace_id`.
- **Access Revalidation**: [`accessibleWorkspaceId`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-access.ts) confirms that the requesting user is either the workspace owner or recorded in `workspace_members`.
- **UI Switcher**:
  - Embedded in the bottom-left [`UserMenu`](file:///e:/توفيق/zid/zidlink2/src/components/user-menu.tsx#L178-L231) flyout.
  - Displays all owned and member workspaces with real-time checkmark indicator on active workspace.
  - Selecting a workspace calls `setActiveWorkspace(id)` and triggers `window.location.reload()` to refresh Server Component layouts, tokens, and active workspace scopes.
- **Dedicated Management Page**: Located at [`/app/settings/workspace`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/workspace/page.tsx), showing workspace ID, creation date, Zid connection badge (store name / status), and ERP connection badge.

---

## 4. Team Members & Granular Access Control (RBAC)

### 4.1 Roles Architecture
The team and permission system is defined in [`src/app/actions/workspace-members.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/workspace-members.ts) and [`src/lib/workspace-members-constants.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-members-constants.ts):
- **Workspace Owner (`owner`)**:
  - The creator of the workspace (`workspaces.user_id`).
  - Has permanent, unrestricted access to all 9 system pages (`ALL_PAGES`).
  - Sole authority to invite members, revoke invitations, change member permissions, update workspace name, and delete the workspace.
- **Workspace Member (`member`)**:
  - Recorded in `workspace_members` with `workspace_id`, `user_id`, `role='member'`, and `permissions: string[]`.
  - Access is restricted exclusively to the pages enabled by the owner.

### 4.2 The 9 Page-Level Permissions
Permissions are configured per member as an array of string keys:

| Permission Key | English Label | Arabic Label | Protected Route / Resource |
| :--- | :--- | :--- | :--- |
| `dashboard` | Dashboard | لوحة التحكم | `/app/dashboard` |
| `connect-store` | Connect Store | ربط المتجر | `/app/connect-store` & sub-routes |
| `connect-odoo` | Connect ERP | ربط نظام الـ ERP | `/app/connect-odoo` |
| `mapping-center` | Mapping Center | مركز الربط | `/app/mapping-center`, `/app/mapping-center/*`, `/app/queue`, `/app/logs` |
| `transfers` | Data Transfer | نقل البيانات | `/app/initial-transfer` |
| `tickets` | Support Tickets | تذاكر الدعم | `/app/tickets` |
| `settings` | General Settings | الإعدادات العامة | `/app/settings` |
| `settings-notifications` | Notifications | الإشعارات | `/app/settings/notifications` |
| `settings-team` | Team | فريق العمل | `/app/settings/team` |

> [!NOTE]
> `/app/settings/workspace` and `/app/settings/billing` are exempt from permission restriction. Any member can access workspace switching and view billing details without owner permission.

### 4.3 Invitation & Acceptance Workflow
Located at [`/app/settings/team`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/team/page.tsx):
1. **Inviting a Member (`inviteMember`)**:
   - Owner enters Name, Email, and checks required permissions.
   - **Internal User Path**: If the email already exists in `users`, the user is immediately added to `workspace_members`.
   - **External User Path**: If the email is not registered, the system invokes Clerk's invitation API (`clerk.invitations.createInvitation`) with redirect target `/dashboard`, and creates a record in `workspace_invitations` with `status = 'pending'`.
2. **Automatic Invitation Claim (`checkPendingInvitations`)**:
   - Runs automatically on app load in [`AppLayout`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/layout.tsx#L77-L80).
   - Reads the verified email from the current Clerk session (ignoring unauthenticated external arguments).
   - Automatically claims all matching `pending` invitations, creates `workspace_members` records, and updates status to `'accepted'`.
3. **Revocation & Removal**:
   - Pending invitations can be revoked via `revokeInvitation(invitationId)`.
   - Active members can be removed via `removeMember(workspaceId, memberUserId)`.
   - Member permissions can be modified in real-time via `updateMemberPermissions(workspaceId, memberUserId, permissions)`.

### 4.4 Layout Guard Enforcement
In [`src/app/(app)/app/layout.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/layout.tsx#L100-L114):
- Routes are mapped to permission keys via `permissionMap`.
- Deep routes like `/app/logs/[id]`, `/app/queue/*`, and `/app/mapping-center/custom/*` resolve dynamically to `'mapping-center'`.
- If `!isOwner && !permissions.includes(permissionKey)`, the page content is replaced with a standard warning screen: `"ليس لديك صلاحية / No Permission"`.
- Unauthorized navigation items are completely filtered out of [`SidebarNav`](file:///e:/توفيق/zid/zidlink2/src/components/sidebar-nav.tsx) and [`MobileNav`](file:///e:/توفيق/zid/zidlink2/src/components/mobile-nav.tsx).

---

## 5. Subscriptions, Trials & Manual Billing

### 5.1 Business Model & Policy
- **Manual Billing Only**: No Stripe, no credit card processing, no automated recurrent charges.
- **Affiliate System Cancelled**: Permanently disabled (2026-09-10). All commission tables (`partner_commissions`), attribution triggers, and affiliate pickers are deprecated.
- **Client Billing Identifiers**: Every workspace is assigned a distinct `subscription_number` (e.g. displayed at `/app/settings/billing`). Clients copy this code and send it to administration along with manual bank transfer receipts.

### 5.2 The 7-Day Free Trial Engine
Implemented in [`src/lib/workspace-trial.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-trial.ts):
- Every workspace automatically qualifies for a 7-day free trial starting at its `workspaces.created_at`.
- `trialEndMs(createdAt)` = `created_at + 7 * 86,400,000 ms`.
- `trialRemainingMs(createdAt, now)` = `Math.max(0, trialEndMs - now)`.
- **Fail-Open Policy**: A workspace with a `null` or unparseable `created_at` returns `null` (unknown), which is never treated as expired.
- **Precedence Rule**: The moment a paid subscription row is registered by an admin, the subscription lifecycle completely supersedes the trial (`trial` becomes `null`).

### 5.3 Top Alert Strip (`SubscriptionBanner`)
Located in [`src/components/subscription/SubscriptionBanner.tsx`](file:///e:/توفيق/zid/zidlink2/src/components/subscription/SubscriptionBanner.tsx):
- Fixed banner rendered at the top of the viewport above navigation and content.
- **Always Visible & Non-Dismissible**: Has no close button, no session suppression, and displays for all users including administrators.
- **Color Consistency**: Uniform high-visibility styling across all states.
- **Live Per-Second Countdowns**:
  - **Trial Active**: Live ticking countdown formatted as `"6 days and 21:06:56"` / `"6 أيام و 21:06:56"` (dropping day prefix when under 24 hours).
  - **Subscription Expiring Soon (≤ 7 days)**: Live ticking countdown down to the exact end of the inclusive UTC end date.
  - **Trial Expired / Subscription Expired**: Clear notification that the workspace is closed and advising to contact support.
  - **No Subscription (Unknown Date)**: Advisory to contact support.
  - **Active (> 7 days remaining)**: Banner unmounts completely.

### 5.4 Workspace Closed Access Gate (`workspaceClosed`)
Enforced in [`src/app/(app)/app/layout.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/layout.tsx#L115-L131):
- A workspace is deemed closed if:
  - `workspaceArchived === true`, OR
  - `trial?.isExpired === true`, OR
  - `subscription?.isExpired === true`.
- **Exemptions**:
  1. Platform administrators (`isAdmin`) are never locked out.
  2. The entire `/app/settings/*` subtree remains accessible so users can switch workspaces, create a new workspace (starting a new trial), or view billing details.
- **Closed Screen**: Replaces all application routes with a full-page notice (`مساحة العمل مغلقة / Workspace closed`), offering two direct action buttons:
  - *Contact Support* (`/contact`) to arrange manual subscription.
  - *Switch or create workspace* (`/app/settings/workspace`).

### 5.5 Client-Facing Billing Portal (`/app/settings/billing`)
Rendered by [`BillingClient.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/billing/BillingClient.tsx):
- **Hero Card**: Displays current subscription plan status (months paid, payment start date, expiry date, Active/Expired/Cancelled badge).
- **Subscription Number Box**: Displays `workspace.subscription_number` with one-click clipboard copy.
- **Invoices & Payment History**: Table of registered subscriptions showing Invoice Date, Period, Duration, Amount Paid, Currency, Status, and a download button linking to `/invoice/[id]`.

### 5.6 Admin Billing Operations
Located in [`src/app/actions/subscription-actions.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/subscription-actions.ts) and `/admin/subscriptions`:
- `registerSubscription`: Creates a new subscription (`subscriptions` table), records months paid, start date, inclusive end date (`start_date + months - 1 day`), payment method, payment reference, and notes. Unarchives the workspace if archived, and dispatches [`subscriptionRegisteredEmail`](file:///e:/توفيق/zid/zidlink2/src/lib/email-templates.ts).
- `extendSubscription`: Extends an active or expired subscription from its current `end_date`, updates total amounts, and records audit logs.
- `cancelSubscription`: Marks subscription status as `'cancelled'`.
- `archiveSubscription` & `restoreSubscription`: Soft-archive and unarchive capabilities.
- `addSubscriptionPayment`: Logs installment or offline payment records to `subscription_payments`.
- `getClientStatement(userId)`: Comprehensive billing statement for `/admin/clients/[userId]`, compiling client KPIs, workspace lists, subscription ledgers, and payment history.
- `getAdminStats`: Aggregates MRR, gross revenue, active client counts, and subscriptions expiring within 7 days.

---

## 6. Support Tickets & Contact Inbox (Central Odoo Studio)

### 6.1 Architectural Decoupling from Supabase
A critical architectural pattern in ERP Link: **Neither support tickets, ticket conversations, attachments, nor contact messages are stored in Supabase.**
- All support operations interface with a central ERP Link Odoo Studio backend via XML-RPC / JSON-RPC ([`src/lib/odoo-support.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo-support.ts) and [`src/lib/central-odoo-archive.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/central-odoo-archive.ts)).
- Primary Odoo Model: `x_erplink_support_ticket`.
- Inbound Contact Model: `x_erplink_contact_inbox`.

### 6.2 Client Support Tickets Portal (`/app/tickets`)
Client ticketing interface in [`tickets-client.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/tickets/tickets-client.tsx) and [`CreateTicketForm.tsx`](file:///e:/توفيق/zid/zidlink2/src/components/CreateTicketForm.tsx):
- **Workspace Scoping**: Tickets created by clients automatically record `x_workspace_uuid` and `x_user_id`. Reading tickets verifies active workspace access via `session()`.
- **Creation Workflow**: Title, issue description, and attachments.
  - Attachment constraints: Max 5 files per message, max 10 MB per file, max 20 MB total payload.
  - Binary files are converted to base64 and attached to Odoo `ir.attachment` linked to the ticket record.
- **Interactive Chatter & Real-Time Sync**:
  - Live two-way chat between customer and support engineers.
  - HTML Sanitization via `sanitizeOdooHtml`: strips dangerous tags (`<script>`, `<iframe>`, `<embed>`, event handlers, `javascript:` URLs) while preserving rich text formatting.
  - Live Server-Sent Events (SSE) via [`/api/tickets/live/stream`](file:///e:/توفيق/zid/zidlink2/src/app/api/tickets/live/stream/route.ts) for real-time message arrival without page polling.
  - Unread badge counter via [`/api/tickets/live/unread/stream`](file:///e:/توفيق/zid/zidlink2/src/app/api/tickets/live/unread/stream/route.ts).
  - Read receipts tracked via `markOdooTicketRead`.
  - Client ticket closure via `closeTicket(ticketId)`.

### 6.3 Public Contact Form & Admin Inbox
- **Public Contact Form** ([`/contact`](file:///e:/توفيق/zid/zidlink2/src/app/actions/contact.ts)):
  - Validates Name, Email, Phone, Company, and Message.
  - Enforces rate limiting: 10 submissions per 10 minutes per IP.
  - Inserts into central Odoo contact archive via `insertContactMessage` and creates an Odoo ticket via `createPublicContactTicket`.
  - **No `workspace_id` Dependency**: Public inquiries can be submitted by visitors without an account or workspace.
- **Admin Contact Inbox** ([`/admin/messages`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/messages/page.tsx)):
  - Odoo-style list table showing sender name, company, email, phone, status (`new`, `read`, `archived`), and linked Odoo ticket ID.
  - Row actions: Mark read, mark unread, archive, restore.
  - Record view at `/admin/messages/[id]` displays full inquiry body, direct contact action links, and audit timestamps.

---

## 7. Platform Administration & Security Boundaries

### 7.1 Platform Administrator Privileges
- Defined by comma-separated Clerk user IDs in `ADMIN_USER_IDS` ([`isAdmin(userId)`](file:///e:/توفيق/zid/zidlink2/src/lib/auth.ts#L12-L20)).
- Access to the `/admin/*` routing tree:
  - `/admin`: Financial metrics (MRR, Total Revenue, Active Subscriptions).
  - `/admin/clients`: Full client directory, search by email/name, workspace count, MRR.
  - `/admin/clients/[userId]`: Client statement, subscription ledger, payment recording.
  - `/admin/subscriptions`: Master subscriptions table with filter by status.
  - `/admin/subscriptions/[id]`: Subscription detail and modification.
  - `/admin/messages`: Contact inbox.
  - Webhook diagnostics & refresh tools (Odoo, Zid, Salla webhook re-registration).

### 7.2 Secure User Impersonation
Implemented in [`src/app/api/admin/impersonate/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/admin/impersonate/route.ts) and [`src/app/actions/impersonate.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/impersonate.ts):
- **Confirmation Step (CSRF Protection)**: GET request renders a dedicated confirmation screen requiring the admin to verify the target user ID.
- **POST Execution**: Sets an `httpOnly`, `sameSite: 'lax'`, `secure` cookie named `impersonated_user_id`.
- **Short 15-Minute Expiry**: Cookie lifetime is clamped to 900 seconds (15 minutes).
- **Audit Logging**: Every impersonation start logs an entry to `audit_logs` (`impersonation.start`).
- **Read-Only Mode Enforcement**:
  - `getActiveUserId()` returns the impersonated user ID.
  - To prevent catastrophic accidental client data mutation, server actions invoke [`checkImpersonationWriteBlock(serviceName)`](file:///e:/توفيق/zid/zidlink2/src/lib/auth.ts#L81-L94). If `impersonated_user_id` is present, writes/deletes throw a descriptive error:
    `"[Read-Only Mode] Modifications on <service> are disabled during user impersonation."`
- **UI Banner**: [`ImpersonationBanner`](file:///e:/توفيق/zid/zidlink2/src/components/ImpersonationBanner.tsx) displays across the top with a [`StopImpersonationButton`](file:///e:/توفيق/zid/zidlink2/src/components/StopImpersonationButton.tsx) that clears the cookie and returns to the admin view.

---

## 8. Capability Matrix: Client-Facing vs Admin-Facing

| Functional Area | Client-Facing Capability | Internal Admin Function |
| :--- | :--- | :--- |
| **Authentication & Onboarding** | Sign-in, sign-up, Zid embedded SSO, Shopify OAuth launch, Clerk user profile | None (managed via Clerk Dashboard) |
| **Workspaces** | Create workspace, switch active workspace, edit owned workspace name, delete owned workspace (with deep purge) | List all workspaces across all clients, inspect workspace tokens & connections |
| **Team Management** | Invite members, configure 9 page permissions, revoke invitations, remove members | View client members & roles on statement page |
| **RBAC Enforcement** | Access allowed pages, view permission warning when restricted | Bypass page restrictions, exempt from workspace closed lockouts |
| **Free Trial** | Live per-second countdown in top strip, automatic 7-day trial per workspace | View trial status across workspaces |
| **Subscriptions & Billing** | View current subscription status, copy subscription number, view invoices table, download invoice PDF (`/invoice/[id]`) | Register subscription, extend subscription, cancel subscription, add manual payment, view MRR/revenue stats |
| **Support Tickets** | Create ticket, upload attachments, live two-way chat with Odoo helpdesk, receive unread indicators, close ticket | Handled by support engineers in central Odoo Studio |
| **Contact Inquiries** | Submit public inquiry form on `/contact` | View contact messages inbox (`/admin/messages`), mark read/unread, archive, view Odoo ticket ID |
| **User Impersonation** | Visual yellow banner indicating account is being impersonated in read-only mode | Initiate 15-min impersonation with CSRF check and audit log; stop impersonation |

---

## 9. Comprehensive File Map & References

### Client-Facing Components & Pages
- [`src/app/(public)/sign-in/[[...sign-in]]/sign-in-client.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(public)/sign-in/[[...sign-in]]/sign-in-client.tsx) — Clerk sign-in wrapper with embedded storage gate.
- [`src/app/(public)/sign-up/[[...sign-up]]/sign-up-client.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(public)/sign-up/[[...sign-up]]/sign-up-client.tsx) — Clerk sign-up wrapper.
- [`src/app/(app)/app/layout.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/layout.tsx) — Main dashboard shell, navigation filtering, permission checking, and `workspaceClosed` access gate.
- [`src/components/user-menu.tsx`](file:///e:/توفيق/zid/zidlink2/src/components/user-menu.tsx) — User profile trigger, theme toggle, language switch, and workspace switcher flyout.
- [`src/app/(app)/app/settings/layout.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/layout.tsx) — Settings navigation tabs and permission gating.
- [`src/app/(app)/app/settings/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/page.tsx) — General settings (Language & Theme selection).
- [`src/app/(app)/app/settings/workspace/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/workspace/page.tsx) — Workspace manager (create, rename, delete, activate).
- [`src/app/(app)/app/settings/team/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/team/page.tsx) — Team manager (invite, permissions checklist, revoke, remove).
- [`src/app/(app)/app/settings/billing/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/billing/page.tsx) & [`BillingClient.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/billing/BillingClient.tsx) — Client billing details, subscription number, invoice table.
- [`src/app/(app)/app/settings/notifications/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/settings/notifications/page.tsx) — Telegram notification bots & chat filters.
- [`src/components/subscription/SubscriptionBanner.tsx`](file:///e:/توفيق/zid/zidlink2/src/components/subscription/SubscriptionBanner.tsx) — Non-dismissible top countdown alert strip.
- [`src/app/(app)/app/tickets/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/tickets/page.tsx) & [`tickets-client.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/app/tickets/tickets-client.tsx) — Support tickets portal with live chat.
- [`src/components/CreateTicketForm.tsx`](file:///e:/توفيق/zid/zidlink2/src/components/CreateTicketForm.tsx) — Ticket submission form with file attachments.
- [`src/components/contact-form.tsx`](file:///e:/توفيق/zid/zidlink2/src/components/contact-form.tsx) — Public contact form.

### Server Actions
- [`src/app/actions/workspaces.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/workspaces.ts) — Workspace CRUD, activation, store disconnection.
- [`src/app/actions/workspace-members.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/workspace-members.ts) — Member invitations, RBAC permissions, invitation claims.
- [`src/app/actions/subscription-actions.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/subscription-actions.ts) — Client billing reads and admin subscription management.
- [`src/app/actions/tickets.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/tickets.ts) — Odoo ticket CRUD, messaging, read receipts, closure.
- [`src/app/actions/contact.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/contact.ts) — Public contact form submission.
- [`src/app/actions/contact-messages.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/contact-messages.ts) — Admin contact inbox management.
- [`src/app/actions/settings.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/settings.ts) — User language & theme preferences.
- [`src/app/actions/telegram-settings.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/telegram-settings.ts) — Telegram bot tokens and chat subscriptions.
- [`src/app/actions/impersonate.ts`](file:///e:/توفيق/zid/zidlink2/src/app/actions/impersonate.ts) — Stop user impersonation.

### Core Libraries & Domain Logic
- [`src/lib/auth.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/auth.ts) — `getActiveUserId`, `getActiveWorkspaceId`, `isAdmin`, `checkImpersonationWriteBlock`.
- [`src/lib/users.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/users.ts) — Race-safe user creation and default workspace activation.
- [`src/lib/workspace-defaults.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-defaults.ts) — Default workspace bootstrapping logic.
- [`src/lib/workspace-access.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-access.ts) — Workspace membership & ownership validation.
- [`src/lib/workspace-purge.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-purge.ts) — Deep cascade deletion of all workspace-associated records.
- [`src/lib/workspace-trial.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-trial.ts) — Pure 7-day free trial math.
- [`src/lib/subscription-countdown.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/subscription-countdown.ts) — Per-second countdown time calculations.
- [`src/lib/subscription-dates.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/subscription-dates.ts) — Inclusive subscription period math.
- [`src/lib/odoo-support.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/odoo-support.ts) — Central Odoo Studio ticket RPC interface.
- [`src/lib/contact-messages.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/contact-messages.ts) — Central Odoo contact inbox interface.
- [`src/lib/workspace-members-constants.ts`](file:///e:/توفيق/zid/zidlink2/src/lib/workspace-members-constants.ts) — The 9 permission keys and default permissions.

### Admin-Facing Pages & Routes
- [`src/app/(app)/admin/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/page.tsx) — Admin financial overview (MRR & revenue).
- [`src/app/(app)/admin/clients/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/clients/page.tsx) — Client directory and search.
- [`src/app/(app)/admin/clients/[userId]/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/clients/[userId]/page.tsx) — Client statement and subscription modals.
- [`src/app/(app)/admin/subscriptions/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/subscriptions/page.tsx) — Master subscriptions table.
- [`src/app/(app)/admin/subscriptions/[id]/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/subscriptions/[id]/page.tsx) — Per-subscription ledger and detail.
- [`src/app/(app)/admin/messages/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/messages/page.tsx) — Contact inbox table.
- [`src/app/(app)/admin/messages/[id]/page.tsx`](file:///e:/توفيق/zid/zidlink2/src/app/(app)/admin/messages/[id]/page.tsx) — Contact message detail and status update.
- [`src/app/api/admin/impersonate/route.ts`](file:///e:/توفيق/zid/zidlink2/src/app/api/admin/impersonate/route.ts) — Impersonation confirmation and cookie session initialization.
