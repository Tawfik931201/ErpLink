import { createHash, randomUUID } from 'crypto'

import { clerkClient } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'
import { DEFAULT_PERMISSIONS } from '@/lib/workspace-members-constants'
import { getZidConfig } from '@/lib/zid/config'
import { ZID_EMBEDDED_TOKEN_PATTERN } from '@/lib/zid/embedded-url'
import { getAccessToken } from '@/lib/zid/token'

export function embeddedTokenHash(token: string): string | null {
  return ZID_EMBEDDED_TOKEN_PATTERN.test(token) ? createHash('sha256').update(token.toLowerCase()).digest('hex') : null
}

/** An isolated Clerk member prevents a store token from signing in as an admin
 * or inheriting the installer's unrelated workspaces. No email auto-linking. */
export async function registerEmbeddedAccess(merchantId: string, workspaceId: string) {
  const { data: merchant, error } = await supabase.from('merchant_tokens')
    .select('merchant_id,workspace_id,name').eq('merchant_id', merchantId)
    .eq('workspace_id', workspaceId).maybeSingle()
  if (error || !merchant) throw new Error('Store not found in this workspace')

  // Probe the migration before creating any external identity.
  const { data: existing, error: lookupError } = await supabase.from('zid_embedded_access')
    .select('clerk_user_id,workspace_id').eq('merchant_id', merchantId).maybeSingle()
  if (lookupError) throw new Error('Apply the zid_embedded_access migration before enabling Embedded')
  if (existing && existing.workspace_id !== workspaceId) throw new Error('Embedded workspace mismatch')

  const client = await clerkClient()
  const externalId = `zid-embedded:${workspaceId}:${merchantId}`
  const email = `${createHash('sha256').update(externalId).digest('hex').slice(0, 32)}@embedded.invalid`
  const identities = await client.users.getUserList({ externalId: [externalId], limit: 1 })
  const identity = identities.data[0] ?? await client.users.createUser({
    externalId, emailAddress: [email], firstName: 'Zid', lastName: 'Embedded', skipPasswordRequirement: true,
    privateMetadata: { zidEmbedded: true, workspaceId, merchantId },
  })
  if (identity.externalId !== externalId || !identity.privateMetadata.zidEmbedded) {
    throw new Error('Embedded identity mismatch')
  }
  if (existing && existing.clerk_user_id !== identity.id) throw new Error('Embedded identity mismatch')

  const { error: userError } = await supabase.from('users').upsert({
    id: identity.id, email,
    name: merchant.name || 'Zid Embedded', active_workspace_id: workspaceId,
  }, { onConflict: 'id' })
  if (userError) throw new Error('Could not save embedded identity')
  const { error: memberError } = await supabase.from('workspace_members').upsert({
    workspace_id: workspaceId, user_id: identity.id, role: 'member', permissions: DEFAULT_PERMISSIONS,
  }, { onConflict: 'workspace_id,user_id' })
  if (memberError) throw new Error('Could not save embedded workspace membership')

  const token = randomUUID()
  const { error: saveError } = await supabase.from('zid_embedded_access').upsert({
    merchant_id: merchantId, workspace_id: workspaceId, clerk_user_id: identity.id,
    token_hash: embeddedTokenHash(token),
  }, { onConflict: 'merchant_id' })
  if (saveError) throw new Error('Could not save embedded credential')

  const credentials = await getAccessToken(merchantId)
  const authorization = credentials.authorization?.replace(/^Bearer\s+/i, '')
  if (!authorization) throw new Error('Zid authorization is missing')
  const config = getZidConfig()
  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/managers/embedded-apps-token`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${authorization}`, 'X-Manager-Token': credentials.accessToken,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) throw new Error(`Zid Embedded registration failed (${response.status}). Check embedded_apps_tokens_write scope.`)
}

export async function createEmbeddedTicket(token: string): Promise<string | null> {
  const hash = embeddedTokenHash(token)
  if (!hash) return null
  const { data: grant, error } = await supabase.from('zid_embedded_access')
    .select('merchant_id,workspace_id,clerk_user_id').eq('token_hash', hash).maybeSingle()
  if (error) throw new Error('Embedded lookup unavailable')
  if (!grant) return null
  // Disconnect/uninstall deletes the merchant row. Membership revocation also
  // takes effect on the next launch; do not silently recreate it here.
  const [{ data: merchant, error: merchantError }, { data: member, error: memberError }] = await Promise.all([
    supabase.from('merchant_tokens').select('merchant_id').eq('merchant_id', grant.merchant_id)
      .eq('workspace_id', grant.workspace_id).maybeSingle(),
    supabase.from('workspace_members').select('user_id').eq('user_id', grant.clerk_user_id)
      .eq('workspace_id', grant.workspace_id).maybeSingle(),
  ])
  if (merchantError || memberError) throw new Error('Embedded access lookup unavailable')
  if (!merchant || !member) return null
  const client = await clerkClient()
  const identity = await client.users.getUser(grant.clerk_user_id)
  if (identity.externalId !== `zid-embedded:${grant.workspace_id}:${grant.merchant_id}` ||
      !identity.privateMetadata.zidEmbedded || identity.banned || identity.locked) return null
  const { error: selectionError } = await supabase.from('users')
    .update({ active_workspace_id: grant.workspace_id }).eq('id', identity.id)
  if (selectionError) throw new Error('Could not select embedded workspace')
  const ticket = await client.signInTokens.createSignInToken({ userId: identity.id, expiresInSeconds: 60 })
  return ticket.token
}
