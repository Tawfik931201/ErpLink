'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { decrypt } from '@/lib/crypto'
import { getInventorySyncSettings } from '@/lib/inventory-sync-settings'
import { OdooClient } from '@/lib/odoo-client'
import { listSallaProducts } from '@/lib/salla-client'
import { listShopifyProducts } from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { updateOdooStock } from '@/lib/sync-engine'
import { getOrCreateDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

interface StockSyncResult {
  platform: string
  total: number
  updated: number
  failed: number
  skipped: number
  errors: string[]
  skippedBecauseInventorySync?: boolean
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function triggerStockSync(platform: 'zid' | 'salla' | 'shopify'): Promise<{ success: boolean; result?: StockSyncResult; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    // 1. Get Odoo connection
    const { data: odooConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    if (!odooConn) throw new Error('ERP not connected')

    // عندما تكون «مزامنة المخزون (من أودو إلى زد)» مفعّلة على متجر زد، يصبح أودو
    // مصدر الحقيقة للمخزون وتُمنع عملية النقل الجماعي زد → أودو بالكامل.
    if (platform === 'zid') {
      const inventorySettings = await getInventorySyncSettings(user.active_workspace_id)
      if (inventorySettings.sync_enabled) {
        return {
          success: true,
          result: {
            platform,
            total: 0,
            updated: 0,
            failed: 0,
            skipped: 0,
            errors: [],
            skippedBecauseInventorySync: true,
          },
        }
      }
    }

    const decrypted = decrypt(odooConn.password)
    const odooClient = new OdooClient({
      url: odooConn.url,
      db: odooConn.db_name || '',
      username: odooConn.username,
      apiKey: decrypted,
    })
    // Authenticate to establish the Odoo session
    await odooClient.authenticate()

    const result: StockSyncResult = { platform, total: 0, updated: 0, failed: 0, skipped: 0, errors: [] }

    // 2. Fetch products with stock from platform
    const platformProducts: { sku: string; quantity: number }[] = []

    if (platform === 'zid') {
      const { data: merchantTok } = await supabase
        .from('merchant_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!merchantTok) throw new Error('Zid not connected')

      const tokenData = await getAccessToken(merchantTok.merchant_id)
      const zidCreds = {
        authorization: tokenData.authorization || '',
        managerToken: tokenData.accessToken,
        storeId: merchantTok.store_id || undefined,
      }

      let page = 1
      let hasMore = true
      while (hasMore && page <= 200) {
        const res = await ZidAPI.products.list(zidCreds, { page, page_size: 50 })
        const items = res.data.results || []
        if (items.length === 0) { hasMore = false; break }
        for (const p of items) {
          if (p.sku && p.quantity !== undefined && !p.is_infinite) {
            platformProducts.push({ sku: p.sku, quantity: Number(p.quantity) })
          }
        }
        hasMore = !!res.data.next
        page++
      }
    } else if (platform === 'salla') {
      const { data: sallaTok } = await supabase
        .from('salla_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!sallaTok) throw new Error('Salla not connected')

      let page = 1
      let hasMore: string | null = '1'
      while (hasMore && page <= 100) {
        const res = await listSallaProducts(sallaTok.merchant_id, page)
        for (const p of res.products) {
          if (p.sku) {
            platformProducts.push({ sku: p.sku, quantity: Number(p.quantity) })
          }
        }
        hasMore = res.next
        page++
        if (hasMore) await sleep(300)
      }
    } else if (platform === 'shopify') {
      const { data: shopifyTok } = await supabase
        .from('shopify_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!shopifyTok) throw new Error('Shopify not connected')

      let pageInfo: string | null = null
      let iterations = 0
      while (iterations < 50) {
        const res = await listShopifyProducts(shopifyTok.shop_domain, 250, pageInfo || undefined)
        for (const p of res.products) {
          for (const v of p.variants) {
            if (v.sku) {
              platformProducts.push({ sku: v.sku, quantity: Number(v.inventory_quantity) })
            }
          }
        }
        pageInfo = res.nextPageInfo
        if (!pageInfo) break
        iterations++
        await sleep(500)
      }
    }

    result.total = platformProducts.length

    // 3. For each platform product, find Odoo match and update stock concurrently (concurrency limit = 5)
    await runWithConcurrencyLimit(5, platformProducts, async (pp) => {
      try {
        const odooIds = await odooClient.search('product.product', [
          ['default_code', '=', pp.sku],
          ['active', '=', true],
        ], 1)
        if (odooIds.length === 0) {
          // Try product.template
          const templateIds = await odooClient.search('product.template', [
            ['default_code', '=', pp.sku],
            ['active', '=', true],
          ], 1)
          if (templateIds.length === 0) {
            result.skipped++
            return
          }
          const variantIds = await odooClient.search('product.product', [
            ['product_tmpl_id', '=', templateIds[0]],
          ], 1)
          if (variantIds.length === 0) {
            result.skipped++
            return
          }
          await updateOdooStock(odooClient, variantIds[0], pp.quantity)
          result.updated++
        } else {
          await updateOdooStock(odooClient, odooIds[0], pp.quantity)
          result.updated++
        }
      } catch (err: any) {
        result.failed++
        result.errors.push(`${pp.sku}: ${err.message?.slice(0, 100)}`)
      }
    })

    // 4. Record sync result
    try {
      await supabase.from('data_transfers').insert([{
        workspace_id: user.active_workspace_id,
        name: `Stock Sync — ${platform.toUpperCase()}`,
        data_type: 'stock',
        direction: `${platform}_to_odoo`,
        status: result.failed > 0 && result.updated === 0 ? 'failed' : 'completed',
        records_fetched: result.total,
        records_created: result.updated,
        records_failed: result.failed,
        failure_reason: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ') : null,
        mappings: { skipped: result.skipped },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])
    } catch (err) {
      console.error('[StockSync] Failed to record history:', err)
    }

    revalidatePath('/app/mapping-center/stock')
    return { success: true, result }
  } catch (error: any) {
    console.error('[StockSync] Failed:', error)
    return { success: false, error: error.message || 'Stock sync failed' }
  }
}

export async function getStockSyncHistory() {
  try {
    const { userId } = await auth()
    if (!userId) return { success: true, history: [] }
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, history: [] }

    const { data, error } = await supabase
      .from('data_transfers')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .eq('data_type', 'stock')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return { success: true, history: data || [] }
  } catch (err: any) {
    return { success: false, error: err.message, history: [] }
  }
}

/**
 * Concurrency Limit Helper
 * Runs a list of tasks with a concurrency limit.
 */
async function runWithConcurrencyLimit<T>(
  concurrencyLimit: number,
  items: T[],
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const executing = new Set<Promise<void>>()
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i))
    executing.add(p)
    const clean = () => executing.delete(p)
    p.then(clean, clean)
    if (executing.size >= concurrencyLimit) {
      await Promise.race(executing)
    }
  }
  await Promise.all(executing)
}
