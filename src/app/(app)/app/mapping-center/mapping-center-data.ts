import { getOdooModels, getOdooModelFields, getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceZidTokens, getActiveWorkspaceSallaTokens, getActiveWorkspaceShopifyTokens } from '@/app/actions/workspaces'
export interface MappingCenterStore {
  id: string
  name: string | null
}

/**
 * Shared server-side loader for the Mapping Center section pages.
 * Every page fetches ONLY what its own client needs — nothing is shared
 * across routes, so navigating between sections loads each page alone.
 */
export async function getMappingCenterConnection() {
  const [connRes, zidTokenRes, sallaTokenRes, shopifyTokenRes] = await Promise.all([
    getActiveWorkspaceErpConnection(),
    getActiveWorkspaceZidTokens(),
    getActiveWorkspaceSallaTokens(),
    getActiveWorkspaceShopifyTokens(),
  ])

  const erpType = connRes.success && connRes.connection?.erp_type ? connRes.connection.erp_type : 'odoo'
  const hasErpConnection = connRes.success && !!connRes.connection
  const zidTokens = zidTokenRes.success ? zidTokenRes.tokens : []
  const sallaTokens = sallaTokenRes.success ? sallaTokenRes.tokens : []
  const shopifyTokens = shopifyTokenRes.success ? shopifyTokenRes.tokens : []

  const zidStores: MappingCenterStore[] = zidTokens.map(t => ({ id: String(t.merchant_id), name: t.name || null }))
  const sallaStores: MappingCenterStore[] = sallaTokens.map(t => ({ id: String(t.merchant_id), name: t.store_name || t.name || null }))
  const shopifyStores: MappingCenterStore[] = shopifyTokens.map(t => ({ id: String(t.shop_domain), name: t.name || null }))

  return { erpType, hasErpConnection, zidStores, sallaStores, shopifyStores }
}

/** Odoo model list for forms (custom mapping + add field). Skipped by pages that don't need it. */
export async function getMappingCenterModels(hasErpConnection: boolean) {
  let initialModels: any[] = []
  if (hasErpConnection) {
    const modelsRes = await getOdooModels()
    if (modelsRes.success && modelsRes.models) {
      initialModels = modelsRes.models
    }
  }
  return initialModels
}

/** First-model field preload for the custom-mapping form (matches old page behavior). */
export async function getMappingCenterPreloadedFields(initialModels: any[]) {
  let preloadedFields: any[] = []
  let preloadedModel = ''
  if (initialModels.length > 0) {
    preloadedModel = initialModels[0].model
    const fieldsRes = await getOdooModelFields(preloadedModel)
    if (fieldsRes.success && fieldsRes.fields) {
      preloadedFields = fieldsRes.fields
    }
  }
  return { preloadedModel, preloadedFields }
}

/** First connected store id — the create form's default store scope. */
export function getFirstStoreId(
  zidStores: MappingCenterStore[],
  sallaStores: MappingCenterStore[],
  shopifyStores: MappingCenterStore[]
): string {
  return zidStores[0]?.id ?? sallaStores[0]?.id ?? shopifyStores[0]?.id ?? ''
}

/** First connected platform — default tab for platform-scoped widgets. */
export function getFirstPlatform(
  zidStores: MappingCenterStore[],
  sallaStores: MappingCenterStore[],
  shopifyStores: MappingCenterStore[]
): string {
  if (zidStores.length > 0) return 'zid'
  if (sallaStores.length > 0) return 'salla'
  if (shopifyStores.length > 0) return 'shopify'
  return 'zid'
}
