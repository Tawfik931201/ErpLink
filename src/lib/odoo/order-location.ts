import { extractOrderLocationInfo as extractOrderLocationInfoHelper } from '@/lib/odoo/analytic-distribution';
import { supabaseAdmin } from '@/lib/sync-runtime';

// ─── Helper: resolve platform payment method → Odoo journal ─────────────────
export async function resolvePaymentMethod(
  workspaceId: string,
  zidMethod: string,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<{ journal_id?: number; payment_method_id?: number } | null> {
  let query = supabaseAdmin
    .from('payment_method_mappings')
    .select('odoo_journal_id, odoo_payment_method_id')
    .eq('workspace_id', workspaceId)
    .eq('source_method', zidMethod) as any
  if (platform) query = query.eq('platform', platform)
  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    journal_id: data.odoo_journal_id ?? undefined,
    payment_method_id: data.odoo_payment_method_id ?? undefined,
  }
}

// ─── Helper: resolve platform shipping method → Odoo carrier ────────────────
export async function resolveShippingCarrier(
  workspaceId: string,
  zidMethodName: string,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<{ carrier_id?: number; product_id?: number } | null> {
  let query = supabaseAdmin
    .from('shipping_method_mappings')
    .select('odoo_carrier_id, odoo_product_id')
    .eq('workspace_id', workspaceId)
    .eq('source_method_name', zidMethodName) as any
  if (platform) query = query.eq('platform', platform)
  const { data } = await query.maybeSingle()
  if (!data) return null
  return {
    carrier_id: data.odoo_carrier_id ?? undefined,
    product_id: data.odoo_product_id ?? undefined,
  }
}

// ─── Helper: extract location ID and name from order payload across platforms ──
export function extractOrderLocationInfo(
  payload: Record<string, unknown>,
  platform?: 'zid' | 'salla' | 'shopify'
): { locationId?: string; locationName?: string } {
  return extractOrderLocationInfoHelper(payload, platform)
}

// ─── Helper: resolve platform location → Odoo warehouse / stock location ────
export async function resolveWarehouse(
  workspaceId: string,
  platform?: 'zid' | 'salla' | 'shopify',
  zidLocationId?: string,
  zidLocationName?: string,
): Promise<{ warehouse_id?: number; location_id?: number } | null> {
  if (!workspaceId || (!zidLocationId && !zidLocationName)) return null

  let query = supabaseAdmin
    .from('warehouse_mappings')
    .select('source_location_id, source_location_name, odoo_warehouse_id, odoo_location_id')
    .eq('workspace_id', workspaceId) as any

  if (platform) query = query.eq('platform', platform)
  const { data: rows } = await query
  if (!rows || rows.length === 0) return null

  const clean = (s: string) => String(s || '').trim().toLowerCase().replace(/[-_\s]/g, '')
  const targetIdClean = zidLocationId ? clean(zidLocationId) : ''
  const targetNameClean = zidLocationName ? clean(zidLocationName) : ''

  // 1. Try matching by normalized ID (with or without hyphens)
  if (targetIdClean) {
    const matched = rows.find((r: any) => clean(r.source_location_id) === targetIdClean)
    if (matched) {
      return {
        warehouse_id: matched.odoo_warehouse_id ?? undefined,
        location_id: matched.odoo_location_id ?? undefined,
      }
    }
  }

  // 2. Try matching by location name
  if (targetNameClean) {
    const matched = rows.find((r: any) => clean(r.source_location_name) === targetNameClean)
    if (matched) {
      return {
        warehouse_id: matched.odoo_warehouse_id ?? undefined,
        location_id: matched.odoo_location_id ?? undefined,
      }
    }
  }

  return null
}
