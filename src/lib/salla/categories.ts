export async function enrichSallaCategory(
  data: Record<string, unknown>,
  storeIdStr: string,
  entityId: unknown,
  isLegacyDelivery: boolean,
): Promise<Record<string, unknown>> {
  const { getSallaCategory } = await import('@/lib/salla-client')
  const full = await getSallaCategory(storeIdStr, String(entityId))
  if (full) data = isLegacyDelivery ? { ...data, ...full } : { ...full, ...data }
  return data
}

export async function readSallaStoreCategory(workspaceId: string, merchantId: string, categoryId: string): Promise<unknown> {
  const { supabaseAdmin } = await import('@/lib/sync-runtime')
  const { data: token } = await supabaseAdmin.from('salla_tokens').select('merchant_id')
    .eq('workspace_id', workspaceId).eq('merchant_id', merchantId).maybeSingle()
  if (!token) throw new Error('Category store is not connected to this workspace')

  const { getSallaCategory } = await import('@/lib/salla-client')
  return getSallaCategory(merchantId, categoryId)
}
