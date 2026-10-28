export function buildAuthorizationUrl(state?: string, storeId?: string): string {
  const appId = process.env.ZID_APP_ID || process.env.NEXT_PUBLIC_ZID_APP_ID || '6958'

  // If a specific store ID is provided, route directly to the store's app management page in Zid Dashboard
  // Example: https://dashboard.zid.sa/en-sa/stores/3172448/apps/6958
  if (storeId) {
    return `https://dashboard.zid.sa/en-sa/stores/${encodeURIComponent(storeId)}/apps/${appId}`
  }

  // If store ID is not known yet (new connection), route to the public Zid App Market listing
  // where any merchant can click "Install App" and choose their store.
  // Note: dashboard.zid.sa/apps/... does not exist without a /stores/<id>/ prefix,
  // so public market listings must always use apps.zid.sa.
  return `https://apps.zid.sa/ar-sa/apps/${appId}`
}
