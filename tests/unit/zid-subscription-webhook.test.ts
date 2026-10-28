import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8').replace(/\r/g, '')
}

describe('Zid App Subscription Webhook Integration', () => {
  const routeSrc = readSrc('app', 'api', 'webhooks', 'zid', 'route.ts')
  const subWebhookSrc = readSrc('lib', 'zid', 'subscription-webhook.ts')

  describe('Webhook Route Contract', () => {
    it('detects app.market.subscription events in inferEventFromPayload', () => {
      expect(routeSrc).toContain("lower.startsWith('app.market.subscription.')")
      expect(routeSrc).toContain("lower.startsWith('subscription.')")
      expect(routeSrc).toContain('p.event_name')
      expect(routeSrc).toContain('target.event_name')
    })

    it('routes all subscription lifecycle events to handleZidSubscriptionWebhook', () => {
      expect(routeSrc).toContain("case 'app.market.subscription.active':")
      expect(routeSrc).toContain("case 'app.market.subscription.renew':")
      expect(routeSrc).toContain("case 'app.market.subscription.upgrade':")
      expect(routeSrc).toContain("case 'app.market.subscription.suspended':")
      expect(routeSrc).toContain("case 'app.market.subscription.expired':")
      expect(routeSrc).toContain("case 'app.market.subscription.refunded':")
      expect(routeSrc).toContain("case 'app.market.subscription.warning':")
      expect(routeSrc).toContain('handleZidSubscriptionWebhook(event, store_id, payload)')
    })

    it('cancels subscriptions on app uninstall', () => {
      expect(routeSrc).toContain("handleZidSubscriptionWebhook('app.market.subscription.suspended', store_id, payload)")
    })
  })

  describe('Subscription Webhook Logic Contract', () => {
    it('records zid_subscription_id, plan_name and platform zid', () => {
      expect(subWebhookSrc).toContain('zid_subscription_id: zidSubscriptionId')
      expect(subWebhookSrc).toContain('plan_name: planName')
      expect(subWebhookSrc).toContain("platform: 'zid'")
    })

    it('inserts payments into subscription_payments on activation, upgrade and renewal', () => {
      expect(subWebhookSrc).toContain("from('subscription_payments')")
      expect(subWebhookSrc).toContain("currency: 'SAR'")
    })

    it('unarchives workspace on active, renew and upgrade', () => {
      expect(subWebhookSrc).toContain('await unarchiveWorkspace(workspaceId)')
    })

    it('archives workspace when subscriptions are cancelled and none remain', () => {
      expect(subWebhookSrc).toContain('await archiveWorkspace(workspaceId)')
    })

    it('supports direct Zid App Market API query for fresh subscription truth', () => {
      expect(subWebhookSrc).toContain('fetchZidSubscriptionDetails')
      expect(subWebhookSrc).toContain('/v1/market/app/subscription')
    })

    it('protects against free plan vulnerability by checking existing active paid subscription', () => {
      expect(subWebhookSrc).toContain('isFreePlan')
      expect(subWebhookSrc).toContain("gt('amount_paid', 0)")
      expect(subWebhookSrc).toContain('subscription.zid_free_rejected')
      expect(subWebhookSrc).toContain('subscription.zid_free_attached')
      expect(subWebhookSrc).toContain('subscription.zid_free_cancelled')
    })
  })
})
