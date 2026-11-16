import { supabaseAdmin } from '@/lib/sync-runtime'

export async function readZidStoreCategory(workspaceId: string, merchantId: string, categoryId: string): Promise<unknown> {
  const { data: token } = await supabaseAdmin.from('merchant_tokens').select('*')
    .eq('workspace_id', workspaceId).eq('merchant_id', merchantId).maybeSingle()
  if (!token) throw new Error('Category store is not connected to this workspace')

  const { ZidAPI } = await import('@/lib/zid-client')
  const { getAccessToken } = await import('./token')
  const credentials = await getAccessToken(merchantId, workspaceId)
  const response = await ZidAPI.categories.get({
    authorization: credentials.authorization || '',
    managerToken: credentials.accessToken,
    storeId: token.store_id || merchantId,
  }, categoryId)
  const body = response.data as Record<string, unknown> | undefined
  return body?.category ?? body?.categories ?? body
}
