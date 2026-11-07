# Customer live integration audit — 2026-11-06

Target: Zid store 3172448 / merchant 3236165, workspace b0bee63a-db5f-4faa-ad23-ee5f9f3c79ce. ERP connection f69315eb-5cf7-4653-9f55-d44f8bcc9dff, edu-course3.odoo.com, Odoo 19.0+e.

## Live create: PASS
- Zid MCP created individual customer 501138932, ERPLINK-QA-20261106-CUSTOMER, fictional reserved phone +12025550106, no email, 17:40:24 UTC.
- Natural customer.create received 17:40:35 UTC, receipt 24604d24-970e-487e-a679-8fa7ececb88d, queue ed573f28-e158-4365-b7eb-b63e1ad15312.
- Success log 1ced1a5d-537e-4292-9a99-b6a6273362ba at 17:40:47 UTC points to res.partner 33.
- Actual readback: name correct; phone correct; company_type person; company_id false; VAT/registry false; accounts default receivable59 / payable105.
- Initial email @example.invalid rejected by Zid DNS validation. Initial UK fictional number without leading + rejected. Neither attempt created records. Used optional-email omission and +1 fictional number successfully.

## Effective settings and coverage
- Customers platform-default row applies (no per-store override).
- customer_type=person: verified live.
- enabled_actions=[create,update], not disabled: create verified; update result below.
- match_zid_field=mobile / match_odoo_field=mobile: configured field is absent in target Odoo19 fields_get; natural customer.create payload supplies telephone, not mobile. Phone persists via telephone->phone preset. Success does not establish selected mobile matching works; fallback phone matching is available. UI/save should validate capability rather than silently permit unsupported match.
- on_delete=nothing: inspected; no customer deletion attempted.
- receivable/payable/company/link: unset, therefore Odoo defaults observed. Alternate account/company and auto/company customer-type options reviewed in customer-settings-tab.tsx + applyFixedSettingsToValues/injectCustomerCompanyFields; not changed or tested live.
- Other available options: disabled toggle; create/update/delete allowlist; delete/archive/delete_or_archive; any store/Odoo matching-field pair. Inventory complete, not a claim every alternate option was exercised.

## Live update: NOT PROPAGATED DURING OBSERVATION
- Zid MCP update_customer succeeded; GET confirms name ERPLINK-QA-20261106-CUSTOMER-UPDATED, updated_at17:42:57 UTC.
- Odoo readback still original name on record33; only create receipt/log observed by ~17:44 UTC.
- Source ZID_EVENT_MAP supports customer.merchant.update, but ZID_CORE_EVENTS excludes customer_merchant_update. Manager/MCP edit is likely a distinct merchant update event rather than subscribed customer.update; registration state must be inspected. This is a hypothesis supported by missing receipt, not proven delivery failure cause.
- Do not claim update passed. No production settings changed and no direct Odoo writes used.

## Source control / remaining work
No application code changed. Parent-provided read-only helper was used for actual target Odoo readback. All alternate configurations and business VAT/company customer handling remain unverified live. No manual outbound message was sent; automatic welcome setting could not be read via available settings surface; phone is fictional and email omitted.

## Follow-up: actual Zid subscriptions confirmed (read-only)
Fetched live index docs.zid.sa/llms.txt and List Webhooks https://docs.zid.sa/list-of-webhooks.md before GET /v1/managers/webhooks. Read selected merchant credentials into memory only; no raw auth/target query output.

HTTP200 returned exactly12 subscriptions, all active=true and health=healthy, all target hostname/path erplink.bizsahla.com/api/webhooks/zid:
order.create, order.payment_status.update, order.status.update, product.create, product.update, product.delete, product.publish, category.create, category.update, category.delete, customer.create, customer.update.

customer.merchant.update is NOT subscribed. This confirms the subscription gap, while customer.update itself is enabled/healthy. Since the manager edit succeeded in Zid and no customer update receipt appeared, the absent merchant-specific subscription is the leading cause of missing manager/MCP edits. The current customer event docs are only a DataSchema placeholder, so do not overstate their event trigger contract as verified documentation.

No subscription was added, changed, or removed. The read-only helper .tmp-live-audit/zid-webhooks-read.cjs prints only event, active, health, safe hostname/path.
