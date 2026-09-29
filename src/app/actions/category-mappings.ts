'use server'

import { auth } from '@clerk/nextjs/server'
import axios from 'axios'
import { revalidatePath } from 'next/cache'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { getSallaAccessToken } from '@/lib/salla-client'
import { SHOPIFY_API_VERSION, getShopifyAccessToken } from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

export interface CategoryMappingRow {
  id: string
  workspace_id: string
  platform: string
  source_category_name: string
  odoo_category_id: number | null
  parent_id: number | null
  income_account_id: number | null
  expense_account_id: number | null
  property_cost_method: string | null
  property_valuation: string | null
  stock_valuation_account_id: number | null
  stock_journal_id: number | null
  stock_input_account_id: number | null
  stock_output_account_id: number | null
  created_at: string
  updated_at: string
}

export async function getCategoryMappings(platform: string = 'zid') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: [] as CategoryMappingRow[] }

    const { data, error } = await supabase
      .from('category_mappings')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)
      .order('source_category_name', { ascending: true })

    if (error) throw error

    return { success: true, mappings: (data || []) as CategoryMappingRow[] }
  } catch (error: any) {
    console.error('[CategoryMappings] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch category mappings', mappings: [] }
  }
}

export async function saveCategoryMapping(data: {
  platform: string
  source_category_name: string
  source_category_id?: string | number | null
  odoo_category_id?: number | null
  parent_id?: number | null
  income_account_id?: number | null
  expense_account_id?: number | null
  property_cost_method?: string | null
  property_valuation?: string | null
  stock_valuation_account_id?: number | null
  stock_journal_id?: number | null
  stock_input_account_id?: number | null
  stock_output_account_id?: number | null
}) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { error } = await supabase
      .from('category_mappings')
      .upsert({
        workspace_id: user.active_workspace_id,
        platform: data.platform,
        source_category_name: data.source_category_name,
        odoo_category_id: data.odoo_category_id ?? null,
        parent_id: data.parent_id ?? null,
        income_account_id: data.income_account_id ?? null,
        expense_account_id: data.expense_account_id ?? null,
        property_cost_method: data.property_cost_method ?? null,
        property_valuation: data.property_valuation ?? null,
        stock_valuation_account_id: data.stock_valuation_account_id ?? null,
        stock_journal_id: data.stock_journal_id ?? null,
        stock_input_account_id: data.stock_input_account_id ?? null,
        stock_output_account_id: data.stock_output_account_id ?? null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'workspace_id, platform, source_category_name',
      })

    if (error) throw error

    // Sync match field to Odoo immediately if mapped
    if (data.odoo_category_id && data.source_category_id) {
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
            .eq('entity_type', 'categories')
            .maybeSingle()

          const settings = (settingsRow as any)?.settings || {}
          const odooField = settings.category?.odoo_match_field || settings.match_odoo_field || 'x_zid_id_categ'

          if (odooField) {
            const numVal = Number(data.source_category_id)
            const val = (odooField === 'id' || Number.isInteger(numVal) && numVal > 0) ? numVal : String(data.source_category_id)
            await client.write('product.category', [data.odoo_category_id], {
              [odooField]: val
            })
            console.info(`[CategoryMappings] Synchronized Odoo category #${data.odoo_category_id} match field "${odooField}" = "${val}"`)
          }
        }
      } catch (odooErr: any) {
        console.warn('[CategoryMappings] Failed to update Odoo category match field on manual map save:', odooErr.message || odooErr)
      }
    }

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[CategoryMappings] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save category mapping' }
  }
}

export async function batchImportCategoryMappings(platform: string, categories: { name: string }[]) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data: existing } = await supabase
      .from('category_mappings')
      .select('source_category_name')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)

    const existingNames = new Set((existing || []).map(m => m.source_category_name))
    const newCategories = categories.filter(c => !existingNames.has(c.name))

    if (newCategories.length === 0) {
      return { success: true, imported: 0 }
    }

    const rows = newCategories.map(c => ({
      workspace_id: user.active_workspace_id,
      platform,
      source_category_name: c.name,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('category_mappings')
      .upsert(rows, { onConflict: 'workspace_id, platform, source_category_name' })

    if (error) throw error

    revalidatePath('/app/mapping-center')
    return { success: true, imported: newCategories.length }
  } catch (error: any) {
    console.error('[CategoryMappings] Batch import failed:', error)
    return { success: false, error: error?.message || 'Failed to batch import categories', imported: 0 }
  }
}

export async function deleteCategoryMapping(id: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { error } = await supabase
      .from('category_mappings')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw error

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[CategoryMappings] Delete failed:', error)
    return { success: false, error: error?.message || 'Failed to delete category mapping' }
  }
}

function flattenCategoryTree(cats: any[]): any[] {
  const flatList: any[] = []

  function recurse(cat: any, parentName?: any) {
    const parent = parentName || cat.parent_name || null
    flatList.push({
      ...cat,
      parent_name: parent
    })

    const children = cat.children || cat.sub_categories || cat.subcategories || []
    if (Array.isArray(children) && children.length > 0) {
      const currentName = cat.name || cat.title || ''
      for (const child of children) {
        recurse(child, currentName)
      }
    }
  }

  for (const cat of cats) {
    recurse(cat)
  }

  return flatList
}

export async function fetchStoreCategories(platform: string = 'zid') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    let categories: any[] = []

    if (platform === 'salla') {
      const { data: sallaTok } = await supabase
        .from('salla_tokens')
        .select('merchant_id')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!sallaTok) throw new Error('Salla store not connected')

      const token = await getSallaAccessToken(sallaTok.merchant_id)
      const res = await axios.get('https://api.salla.dev/admin/v2/categories', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      categories = res.data?.data || []
    } else if (platform === 'shopify') {
      const { data: shopifyTok } = await supabase
        .from('shopify_tokens')
        .select('shop_domain')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (!shopifyTok) throw new Error('Shopify store not connected')

      const token = await getShopifyAccessToken(shopifyTok.shop_domain)
      // API version from shared constant (was hardcoded 2024-01 → now 2025-07 via SHOPIFY_API_VERSION).
      const [customRes, smartRes] = await Promise.all([
        axios.get(`https://${shopifyTok.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/custom_collections.json`, {
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        }),
        axios.get(`https://${shopifyTok.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/smart_collections.json`, {
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        }),
      ])
      const custom = (customRes.data?.custom_collections || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
        body_html: c.body_html,
        sort_order: c.sort_order,
        published_at: c.published_at,
      }))
      const smart = (smartRes.data?.smart_collections || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
        body_html: c.body_html,
        sort_order: c.sort_order,
        published_at: c.published_at,
      }))
      categories = [...custom, ...smart]
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

      const res = await ZidAPI.categories.list(creds)
      categories = res.data.categories || res.data.results || (Array.isArray(res.data) ? res.data : [])
    }

    // Flatten any hierarchical structures (Zid/Salla)
    categories = flattenCategoryTree(categories)

    return { success: true, categories }
  } catch (error: any) {
    console.error('[CategoryMappings] Fetch store categories failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch store categories', categories: [] }
  }
}
