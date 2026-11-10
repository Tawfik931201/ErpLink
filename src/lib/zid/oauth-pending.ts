import { createHash, randomBytes } from 'crypto'

import { decrypt, encrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'

import { encryptZidCredentials } from './credentials'

export const ZID_PENDING_COOKIE = 'zid_pending_connection'
export const ZID_CONNECT_PATH = '/connect/zid'
export const PENDING_TTL_SECONDS = 60 * 60

export function pendingHash(handle: string | undefined): string | null {
  return handle && /^[a-f0-9]{64}$/.test(handle)
    ? createHash('sha256').update(handle).digest('hex') : null
}

export const oauthCookieOptions = (maxAge: number) => ({
  httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const, path: '/', maxAge,
})

/** The browser holds only a random handle, never provider credentials. */
export async function beginZidAuthorization(): Promise<string> {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required for Zid onboarding')
  // Expired credentials must not remain in storage indefinitely. Indexed and
  // executed before each new attempt; an operational retention job can also use it.
  const { error: cleanupError } = await supabase.from('zid_oauth_pending').delete()
    .lt('expires_at', new Date().toISOString())
  if (cleanupError) throw new Error('Zid onboarding storage is unavailable')
  const state = randomBytes(32).toString('hex')
  const { error } = await supabase.from('zid_oauth_pending').insert({
    token_hash: pendingHash(state), kind: 'authorization',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (error) throw new Error('Could not start Zid authorization')
  return state
}

/** DELETE ... RETURNING makes a valid state single-use across workers. */
export async function consumeZidState(state: string): Promise<boolean> {
  const hash = pendingHash(state)
  if (!hash) return false
  const { data, error } = await supabase.from('zid_oauth_pending').delete()
    .eq('token_hash', hash).eq('kind', 'authorization')
    .gt('expires_at', new Date().toISOString()).select('token_hash').maybeSingle()
  if (error) throw new Error('Could not validate Zid authorization')
  return Boolean(data)
}

export async function savePendingZidConnection(tokenData: Record<string, unknown>): Promise<string> {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required for Zid onboarding')
  const handle = randomBytes(32).toString('hex')
  const { error } = await supabase.from('zid_oauth_pending').insert({
    token_hash: pendingHash(handle), kind: 'connection',
    store_id: tokenData.store_id, store_name: tokenData.name,
    encrypted_payload: encrypt(JSON.stringify(tokenData)),
    expires_at: new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error('Could not retain Zid connection for account linking')
  return handle
}

export async function readPendingZidConnection(handle: string | undefined) {
  const hash = pendingHash(handle)
  if (!hash) return null
  const { data, error } = await supabase.from('zid_oauth_pending')
    .select('store_id,store_name,encrypted_payload,expires_at')
    .eq('token_hash', hash).eq('kind', 'connection').maybeSingle()
  if (error) throw new Error('Zid onboarding storage is unavailable')
  if (!data || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null
  return data as { store_id: string; store_name: string | null; encrypted_payload: string; expires_at: string }
}

export async function finishZidConnection(handle: string, userId: string, workspaceId: string) {
  const pending = await readPendingZidConnection(handle)
  if (!pending) throw new Error('connection_expired')
  const tokenData = JSON.parse(decrypt(pending.encrypted_payload)) as Record<string, unknown>
  const expiresAt = Number(tokenData.expires_at_ms)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('connection_expired')
  tokenData.expires_in = Math.floor((expiresAt - Date.now()) / 1000)
  delete tokenData.expires_at_ms
  const { data, error } = await supabase.rpc('complete_zid_oauth_connection', {
    p_hash: pendingHash(handle), p_user_id: userId,
    p_workspace_id: workspaceId, p_token_data: encryptZidCredentials(tokenData as typeof tokenData & {
      access_token: string; refresh_token: string; authorization_token?: string;
    }),
  })
  if (error || !data) throw new Error('connection_not_saved')
  return String(data)
}
