# ERPLink Software Engineering Co.
## Phase Gate G4 Production Launch Sign-Off & 48-Hour Hypercare Operational Roster

**Document Version:** 1.0.0  
**Effective Date:** 2026-11-23  
**Status:** FULLY RATIFIED & SIGNED OFF  
**System:** ERPLink Multi-Tenant Enterprise Integration Suite (Zid / Salla / Shopify ↔ Odoo / ERPNext)

---

## 1. Official Pre-Launch Gate Sign-Off Certificate

All five operational phase gates have been comprehensively evaluated, tested, and passed with zero critical blockers.

| Phase Gate | Domain & Focus | Verification Criteria | Status | Lead Approver |
|---|---|---|:---:|:---:|
| **Gate G0** | **Cybersecurity & Compliance** | AES-256-GCM v2 secrets at rest, HKDF ingress auth (Zid v2, Salla HMAC/header, Odoo scopes), 0 plain secrets, Clerk Authz guard across 413 files | **PASSED** | `@sec_lead` |
| **Gate G1** | **QA & Test Automation** | 100% CI pass (173 suites / 2,278 tests, 0 failures, 0 skips), clean `type-check`, ESLint CI blockers resolved, regression pins intact | **PASSED** | `@qa_lead` |
| **Gate G2** | **Backend & ERP Integration** | Ingress durability (persistence before 200 OK), queue dedup & wave fencing, return interception, idempotent sync, Odoo 14–19 compatibility | **PASSED** | `@backend_lead` |
| **Gate G3** | **DevOps & SRE Infrastructure** | Hostinger Node.js VPS runtime, Keep-Alive XML-RPC pooling, Bearer cron auth, Telegram outbox decoupled alerting, live health probe active | **PASSED** | `@infra_lead` |
| **Gate G4** | **Canary Deployment & Live Release** | All prerequisite gates satisfied, test store migrations validated, 48h hypercare staffing active, CTO final release authorization | **PASSED** | `@coordinator` |

---

## 2. 48-Hour Live Launch Hypercare Roster (T0 to T+48h)

To ensure zero downtime, immediate incident triage, and continuous adherence to verification SLAs, the taskforce activates a 24/7 rotating on-call schedule across the critical initial 48 hours of live traffic.

### Shift Definitions (UTC)
- **Shift Alpha (Day):** 08:00 – 16:00 UTC
- **Shift Bravo (Evening):** 16:00 – 24:00 UTC
- **Shift Charlie (Overnight):** 00:00 – 08:00 UTC

### Roster Allocation

| Window | Shift | Incident Commander | Primary Ingress / SRE | Primary ERP / Logic | QA & Data Verifier |
|---|---|---|---|---|---|
| **Day 1 (T0 to T+8h)** | Alpha | `@coordinator` | `@infra_lead` | `@backend_lead` | `@qa_lead` |
| **Day 1 (T+8h to T+16h)** | Bravo | `@backend_lead` | `@infra_lead` | `@backend_lead` | `@qa_lead` |
| **Day 1 (T+16h to T+24h)**| Charlie | `@sec_lead` | `@infra_lead` (standby) | `@backend_lead` (standby) | `@qa_lead` (standby) |
| **Day 2 (T+24h to T+32h)**| Alpha | `@coordinator` | `@infra_lead` | `@backend_lead` | `@qa_lead` |
| **Day 2 (T+32h to T+40h)**| Bravo | `@backend_lead` | `@infra_lead` | `@backend_lead` | `@qa_lead` |
| **Day 2 (T+40h to T+48h)**| Charlie | `@sec_lead` | `@infra_lead` (standby) | `@backend_lead` (standby) | `@qa_lead` (standby) |

*Escalation Protocol:* Any Sev-1 immediately escalates to `@coordinator` regardless of the current shift.

---

## 3. Real-Time Telemetry & Metric Thresholds During Hypercare

The hypercare team actively monitors the following vital signals via the `/api/admin/queue-health` endpoint and the persistent Telegram alerting outbox:

1. **Queue Backlog & Latency:**
   - *Normal:* Queue depth < 50 items; average drain time < 60 seconds.
   - *Warning (Sev-2):* Queue depth > 150 items for > 5 minutes → triggers queue runner concurrency review.
   - *Critical (Sev-1):* Queue depth > 500 items or stagnation for > 10 minutes → immediate escalation.
2. **Ingress Authentication Rejection Rate:**
   - Rejections from legacy Zid v1 tokens should taper to zero following startup rekeying.
   - Unexpected 401/403 spikes from active merchants trigger immediate `@sec_lead` triage.
3. **Database & REST Connection Pool:**
   - Supabase PostgREST connection latency monitored via `/api/health/live`.
   - Hostinger Node.js memory footprint monitored against the 2048 MB V8 boundary.
4. **Data Sync Error Rate:**
   - Dead letter / unrecoverable failures must remain at 0%. Any unhandled Odoo XML-RPC fault freezes with `next_retry_at = NULL` for manual inspection in `/app/logs/[id]`.

---

## 4. Post-Launch Cadence & Milestones

1. **T+12h Interim Pulse Check:** Quick async checkpoint on swarm board reviewing initial store order flows and queue stability.
2. **T+24h First Full Day Review:** Review of all processed webhooks, orphan receipts, refund interceptions, and token refreshes.
3. **T+48h Hypercare Exit Gate:** Formal transition from hypercare to standard operational SLA support, contingent on zero Sev-1 incidents.
4. **T+7d Operational Stabilization & Blameless Retrospective:** Full performance audit, database index health check, and finalization of long-term feature roadmaps.

---

*Approved and Certified by:*  
**Taskforce HR & Operations Lead (`@hr_lead`)**  
**Chief Technology Officer / General Manager (`@coordinator`)**
