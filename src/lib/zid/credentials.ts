import { encrypt, isEncryptedValue } from '@/lib/crypto'

/** Shared by OAuth completion, renewal and legacy-row upgrades. */
export function encryptZidCredentials<T extends { access_token: string; refresh_token: string; authorization_token?: string | null }>(data: T): T {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required for Zid token storage')
  return {
    ...data,
    access_token: encrypt(data.access_token),
    refresh_token: encrypt(data.refresh_token),
    authorization_token: encrypt(data.authorization_token || ''),
  }
}

export function isEncryptedZidCredential(value: string): boolean {
  return isEncryptedValue(value)
}

export const ZID_STORE_PUBLIC_COLUMNS = 'id,merchant_id,store_id,workspace_id,name,email,username,uuid,old_id,sync_settings,created_at,updated_at,expires_in,token_type'

/** Also strip cached legacy rows that were fetched before the safe select. */
export function publicZidStore(row: Record<string, unknown>) {
  return Object.fromEntries(ZID_STORE_PUBLIC_COLUMNS.split(',').filter(key => key in row).map(key => [key, row[key]]))
}
