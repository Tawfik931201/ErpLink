'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { getProductName } from '@/lib/product-name'
import { listSallaProducts } from '@/lib/salla-client'
import { listShopifyProducts } from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

export interface ProductMappingRow {
  id: string
  workspace_id: string
  platform: string
  source_product_id: string | null
  source_product_name: string
  source_sku: string | null
  odoo_product_id: number | null
  created_at: string
  updated_at: string
}

export async function getProductMappings(platform: string = 'zid') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: [] as ProductMappingRow[] }

    const { data, error } = await supabase
      .from('product_mappings')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)
      .order('source_product_name', { ascending: true })

    if (error) throw error

    return { success: true, mappings: (data || []) as ProductMappingRow[] }
  } catch (error: any) {
    console.error('[ProductMappings] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch product mappings', mappings: [] }
  }
}

export async function saveProductMapping(data: {
  platform: string
  source_product_id?: string | number | null
  source_product_name: string
  source_sku?: string | null
  odoo_product_id?: number | null
}) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const sourceProductId = data.source_product_id !== undefined && data.source_product_id !== null
      ? String(data.source_product_id)
      : null

    const { error } = await supabase
      .from('product_mappings')
      .upsert({
        workspace_id: user.active_workspace_id,
        platform: data.platform,
        source_product_id: sourceProductId,
        source_product_name: data.source_product_name,
        source_sku: data.source_sku || null,
        odoo_product_id: data.odoo_product_id ?? null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'workspace_id, platform, source_product_id',
      })

    if (error) throw error

    // Sync match field to Odoo immediately if mapped, so future automatic syncs
    // can resolve the link purely from the stamped field.
    if (data.odoo_product_id && sourceProductId) {
      try {
        const conn = await getActiveWorkspaceErpConnection()
        if (conn.success && conn.connection) {
          const client = new OdooClient({
            url: conn.connection.url,
            db: conn.connection.db_name || '',
            username: conn.connection.username,
            apiKey: decrypt(conn.connection.password),
          })

          const { data: settingsRow } = await supabase
            .from('standard_mapping_settings')
            .select('settings')
            .eq('workspace_id', user.active_workspace_id)
            .eq('store_type', data.platform)
            .eq('entity_type', 'products')
            .maybeSingle()

          const settings = (settingsRow as any)?.settings || {}
          const productCfg = settings.product || {}
          const odooField = productCfg.odoo_match_field || settings.match_odoo_field
            || (data.platform === 'salla' ? 'x_salla_id'
              : data.platform === 'shopify' ? 'x_shopify_id'
              : 'x_zid_id')
          const zidField = productCfg.zid_match_field || settings.match_zid_field || 'sku'

          let rawVal = ''
          if (String(zidField).toLowerCase() === 'sku') {
            rawVal = data.source_sku || sourceProductId
          } else {
            rawVal = sourceProductId
          }

          if (odooField && rawVal) {
            const numVal = Number(rawVal)
            const val = (odooField === 'id' || Number.isInteger(numVal) && numVal > 0) ? numVal : String(rawVal)
            await client.write('product.template', [data.odoo_product_id], {
              [odooField]: val
            })
            console.info(`[ProductMappings] Synchronized Odoo product #${data.odoo_product_id} match field "${odooField}" = "${val}"`)
          }
        }
      } catch (odooErr: any) {
        console.warn('[ProductMappings] Failed to update Odoo product match field on manual map save:', odooErr.message || odooErr)
      }
    }

    revalidatePath('/dashboard/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[ProductMappings] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save product mapping' }
  }
}

export async function batchImportProductMappings(platform: string, products: { id: string; name: string; sku?: string }[]) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data: existing } = await supabase
      .from('product_mappings')
      .select('source_product_id')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)

    const existingIds = new Set((existing || [])
      .map(m => m.source_product_id)
      .filter(Boolean)
      .map(String))

    const newProducts = products.filter(p => !existingIds.has(String(p.id)))

    if (newProducts.length === 0) {
      return { success: true, imported: 0 }
    }

    const rows = newProducts.map(p => ({
      workspace_id: user.active_workspace_id,
      platform,
      source_product_id: String(p.id),
      source_product_name: p.name,
      source_sku: p.sku || null,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('product_mappings')
      .upsert(rows, { onConflict: 'workspace_id, platform, source_product_id' })

    if (error) throw error

    revalidatePath('/dashboard/mapping-center')
    return { success: true, imported: newProducts.length }
  } catch (error: any) {
    console.error('[ProductMappings] Batch import failed:', error)
    return { success: false, error: error?.message || 'Failed to batch import products', imported: 0 }
  }
}

export async function deleteProductMapping(id: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { error } = await supabase
      .from('product_mappings')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw error

    revalidatePath('/dashboard/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[ProductMappings] Delete failed:', error)
    return { success: false, error: error?.message || 'Failed to delete product mapping' }
  }
}

export async function fetchStoreProducts(platform: string = 'zid') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    let products: { id: string; name: string; sku: string }[] = []

    if (platform === 'salla') {
      const { data: sallaTok } = await supabase
        .from('salla_tokens')
        .select('merchant_id')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!sallaTok) throw new Error('Salla store not connected')

      let page = 1
      let next: string | null = '1'
      while (next && page <= 20) {
        const res = await listSallaProducts(sallaTok.merchant_id, page, 100)
        for (const p of res.products) {
          if (!p.id) continue
          products.push({ id: String(p.id), name: getProductName(p), sku: p.sku || '' })
        }
        next = res.next
        page++
      }
    } else if (platform === 'shopify') {
      const { data: shopifyTok } = await supabase
        .from('shopify_tokens')
        .select('shop_domain')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!shopifyTok) throw new Error('Shopify store not connected')

      let pageInfo: string | undefined
      let pages = 0
      do {
        const res = await listShopifyProducts(shopifyTok.shop_domain, 250, pageInfo)
        for (const p of res.products) {
          if (!p.id) continue
          const firstSku = Array.isArray(p.variants) && p.variants.length > 0 ? (p.variants[0]?.sku || '') : (p.sku || '')
          products.push({ id: String(p.id), name: getProductName(p), sku: firstSku })
        }
        pageInfo = res.nextPageInfo ?? undefined
        pages++
      } while (pageInfo && pages < 20)
    } else {
      // Zid (default)
      const { data: merchantTok } = await supabase
        .from('merchant_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!merchantTok) throw new Error('Zid store not connected')

      const tokenData = await getAccessToken(merchantTok.merchant_id)
      const creds = {
        authorization: tokenData.authorization || '',
        managerToken: tokenData.accessToken,
        storeId: merchantTok.store_id || merchantTok.merchant_id,
      }

      let page = 1
      let hasMore = true
      while (hasMore && page <= 20) {
        const res = await ZidAPI.products.list(creds, { page, page_size: 50 })
        const results = res.data.results || []
        for (const p of results) {
          if (!p.id) continue
          products.push({ id: String(p.id), name: getProductName(p), sku: p.sku || '' })
        }
        hasMore = !!res.data.next && results.length > 0
        page++
      }
    }

    return { success: true, products }
  } catch (error: any) {
    console.error('[ProductMappings] Fetch store products failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch store products', products: [] }
  }
}