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

    revalidatePath('/app/mapping-center')
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

    revalidatePath('/app/mapping-center')
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

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[ProductMappings] Delete failed:', error)
    return { success: false, error: error?.message || 'Failed to delete product mapping' }
  }
}

export async function fetchStoreProducts(platform: string = 'zid'): Promise<{
  success: boolean
  error?: string
  products: { id: string; name: string; sku: string; barcode?: string }[]
}> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const products: { id: string; name: string; sku: string; barcode?: string }[] = []

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
          products.push({
            id: String(p.id),
            name: getProductName(p),
            sku: p.sku || '',
            barcode: p.barcode || p.gtin || '',
          })
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
          const firstBarcode = Array.isArray(p.variants) && p.variants.length > 0 ? (p.variants[0]?.barcode || '') : (p.barcode || '')
          products.push({
            id: String(p.id),
            name: getProductName(p),
            sku: firstSku,
            barcode: firstBarcode,
          })
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
          products.push({
            id: String(p.id),
            name: getProductName(p),
            sku: p.sku || '',
            barcode: (p as any).barcode || (p as any).gtin || '',
          })
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

export async function autoMatchAndLinkProducts(params: {
  platform?: string
  storeField: string
  odooField: string
  skipAlreadyMapped?: boolean
}) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const platform = params.platform || 'zid'
    const storeField = params.storeField || 'sku'
    const odooField = params.odooField || 'default_code'
    const skipAlreadyMapped = params.skipAlreadyMapped !== false

    // 1. ERP connection
    const conn = await getActiveWorkspaceErpConnection()
    if (!conn.success || !conn.connection) {
      return { success: false, error: 'الاتصال بنظام أودو غير متاح أو معطل (Odoo connection not found or inactive)' }
    }
    const { url, db_name, username, password, erp_type } = conn.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: false, error: 'المطابقة التلقائية مدعومة حالياً لنظام أودو (Odoo) فقط' }
    }

    const decryptedPassword = decrypt(password)
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    // 2. Fetch Store Products
    const storeRes = await fetchStoreProducts(platform)
    if (!storeRes.success || !storeRes.products?.length) {
      return { success: false, error: storeRes.error || 'لم يتم العثور على منتجات في المتجر' }
    }
    const storeProducts = storeRes.products

    // 3. Fetch Existing Mappings
    const { data: existingRows } = await supabase
      .from('product_mappings')
      .select('source_product_id, odoo_product_id')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)

    const existingMappedSet = new Set<string>()
    if (existingRows) {
      for (const r of existingRows) {
        if (r.source_product_id && r.odoo_product_id) {
          existingMappedSet.add(String(r.source_product_id))
        }
      }
    }

    // 4. Fetch Odoo Products (product.template & product.product fallback)
    const fieldsToRead = Array.from(new Set(['id', 'name', 'default_code', 'barcode', odooField]))

    const odooTemplates = await client.searchRead<any>(
      'product.template',
      [['active', 'in', [true, false]]],
      fieldsToRead,
      10000
    ).catch(() => [])

    let odooVariants: any[] = []
    if (['default_code', 'barcode'].includes(odooField)) {
      odooVariants = await client.searchRead<any>(
        'product.product',
        [['active', 'in', [true, false]]],
        ['id', 'product_tmpl_id', 'default_code', 'barcode'],
        10000
      ).catch(() => [])
    }

    // 5. Build lookup map
    const normalize = (val: any) => String(val ?? '').trim().toLowerCase()
    const odooMap = new Map<string, { templateId: number; name: string }>()

    for (const tmpl of odooTemplates) {
      const rawVal = tmpl[odooField]
      const key = normalize(rawVal)
      if (key && !odooMap.has(key)) {
        odooMap.set(key, { templateId: tmpl.id, name: tmpl.name || String(tmpl.id) })
      }
    }

    for (const v of odooVariants) {
      const rawVal = v[odooField]
      const key = normalize(rawVal)
      if (key && !odooMap.has(key)) {
        const tmplId = Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : v.product_tmpl_id
        if (tmplId) {
          odooMap.set(key, { templateId: tmplId, name: v.name || String(tmplId) })
        }
      }
    }

    // 6. Match Store Products
    let matchedCount = 0
    let skippedCount = 0
    let alreadyMappedCount = 0

    const upsertRows: any[] = []
    const matchedItemsForOdooSync: { odooId: number; storeProduct: any }[] = []

    for (const sp of storeProducts) {
      const spId = String(sp.id)
      if (skipAlreadyMapped && existingMappedSet.has(spId)) {
        alreadyMappedCount++
        continue
      }

      let storeVal: any = ''
      if (storeField === 'sku') storeVal = sp.sku
      else if (storeField === 'barcode') storeVal = sp.barcode
      else if (storeField === 'name') storeVal = sp.name
      else if (storeField === 'id') storeVal = sp.id
      else storeVal = (sp as any)[storeField]

      const key = normalize(storeVal)
      if (!key) {
        skippedCount++
        continue
      }

      const match = odooMap.get(key)
      if (match) {
        matchedCount++
        upsertRows.push({
          workspace_id: user.active_workspace_id,
          platform,
          source_product_id: spId,
          source_product_name: sp.name,
          source_sku: sp.sku || null,
          odoo_product_id: match.templateId,
          updated_at: new Date().toISOString(),
        })
        matchedItemsForOdooSync.push({ odooId: match.templateId, storeProduct: sp })
      } else {
        skippedCount++
      }
    }

    // 7. Upsert to product_mappings in batches
    if (upsertRows.length > 0) {
      const chunkSize = 100
      for (let i = 0; i < upsertRows.length; i += chunkSize) {
        const chunk = upsertRows.slice(i, i + chunkSize)
        const { error: upsertErr } = await supabase
          .from('product_mappings')
          .upsert(chunk, {
            onConflict: 'workspace_id,platform,source_product_id',
          })
        if (upsertErr) {
          console.error('[ProductMappings] Auto-match upsert chunk error:', upsertErr)
        }
      }
    }

    // 8. Update Match Field in Odoo according to standard_mapping_settings
    let odooUpdatedCount = 0
    try {
      const { data: settingsRow } = await supabase
        .from('standard_mapping_settings')
        .select('settings')
        .eq('workspace_id', user.active_workspace_id)
        .eq('store_type', platform)
        .eq('entity_type', 'products')
        .maybeSingle()

      const settings = (settingsRow as any)?.settings || {}
      const productCfg = settings.product || {}
      const targetOdooField = productCfg.odoo_match_field || settings.match_odoo_field
      const targetStoreField = productCfg.zid_match_field || settings.match_zid_field || 'sku'

      if (targetOdooField && targetOdooField !== 'id') {
        const updateChunks: { odooId: number; val: any }[] = []
        for (const item of matchedItemsForOdooSync) {
          let rawVal = ''
          if (String(targetStoreField).toLowerCase() === 'sku') {
            rawVal = item.storeProduct.sku || item.storeProduct.id
          } else if (String(targetStoreField).toLowerCase() === 'barcode') {
            rawVal = item.storeProduct.barcode || ''
          } else if (String(targetStoreField).toLowerCase() === 'name') {
            rawVal = item.storeProduct.name
          } else {
            rawVal = item.storeProduct.id
          }

          if (rawVal) {
            const numVal = Number(rawVal)
            const val = (Number.isInteger(numVal) && numVal > 0) ? numVal : String(rawVal)
            updateChunks.push({ odooId: item.odooId, val })
          }
        }

        const CONCURRENCY = 10
        for (let i = 0; i < updateChunks.length; i += CONCURRENCY) {
          const slice = updateChunks.slice(i, i + CONCURRENCY)
          await Promise.allSettled(
            slice.map(async ({ odooId, val }) => {
              try {
                await client.write('product.template', [odooId], { [targetOdooField]: val })
                odooUpdatedCount++
              } catch (err: any) {
                console.warn(`[AutoMatch] Failed to update Odoo product #${odooId}:`, err?.message || err)
              }
            })
          )
        }
        console.info(`[ProductMappings] Updated ${odooUpdatedCount} Odoo products with match field "${targetOdooField}"`)
      }
    } catch (odooErr: any) {
      console.warn('[ProductMappings] Auto-match Odoo update failed:', odooErr?.message || odooErr)
    }

    revalidatePath('/app/mapping-center')
    return {
      success: true,
      matchedCount,
      totalStore: storeProducts.length,
      skippedCount,
      alreadyMappedCount,
      odooUpdatedCount,
    }
  } catch (error: any) {
    console.error('[ProductMappings] Auto-match failed:', error)
    return { success: false, error: error?.message || 'Failed to auto-match products' }
  }
}