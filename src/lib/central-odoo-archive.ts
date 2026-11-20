/**
 * ERP Link central Odoo Studio storage. Uses a dedicated administrative database,
 * never the destination Odoo connection owned by an individual merchant.
 * All calls are server-side. Identifiers are immutable external references.
 */
import 'server-only'

type RecordValue = string | number | boolean | null | Record<string, unknown>
type Values = Record<string, RecordValue>

const MODELS = {
  contact: 'x_erplink_contact_message',
  support: 'x_erplink_support_ticket',
  event: 'x_erplink_event',
  context: 'x_erplink_context',
} as const

export type ArchiveModel = keyof typeof MODELS

function config() {
  const url = process.env.ERPLINK_ARCHIVE_ODOO_URL?.replace(/\/$/, '')
  const db = process.env.ERPLINK_ARCHIVE_ODOO_DB
  const username = process.env.ERPLINK_ARCHIVE_ODOO_USERNAME
  const password = process.env.ERPLINK_ARCHIVE_ODOO_API_KEY
  if (!url || !db || !username || !password) return null
  if (!url.startsWith('https://')) throw new Error('Archive Odoo URL must use HTTPS')
  return { url, db, username, password }
}

export function isOdooArchiveEnabled(): boolean {
  return Boolean(config())
}

async function rpc<T>(
  cfg: NonNullable<ReturnType<typeof config>>,
  service: string,
  method: string,
  args: unknown[]
): Promise<T> {
  const response = await fetch(cfg.url + '/jsonrpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: 1,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('Archive Odoo HTTP ' + response.status)
  const data = await response.json()
  if (data.error) throw new Error(data.error.data?.message || data.error.message || 'Archive Odoo RPC failed')
  if (data.result === undefined) throw new Error('Archive Odoo RPC missing result')
  return data.result as T
}

let authentication: { key: string; uid: number } | null = null

async function execute<T>(
  model: ArchiveModel,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const cfg = config()
  if (!cfg) throw new Error('Central Odoo archive credentials are not configured')
  const key = [cfg.url, cfg.db, cfg.username, cfg.password].join('|')
  if (!authentication || authentication.key !== key) {
    const uid = await rpc<number | false>(cfg, 'common', 'authenticate',
      [cfg.db, cfg.username, cfg.password, {}])
    if (!uid) throw new Error('Central Odoo archive authentication failed')
    authentication = { key, uid }
  }
  return rpc<T>(cfg, 'object', 'execute_kw',
    [cfg.db, authentication.uid, cfg.password, MODELS[model], method, args, kwargs])
}

/** Search first by immutable external source ID to make webhook retries idempotent.
 * No automatic create retry: a remote commit with a lost response is ambiguous.
 */
export async function upsertArchive(
  model: ArchiveModel,
  sourceUuid: string,
  fields: Values,
): Promise<number> {
  if (!sourceUuid || sourceUuid.length > 200) throw new Error('Invalid archive source UUID')
  const existing = await execute<number[]>(model, 'search',
    [[['x_source_uuid', '=', sourceUuid]]], { limit: 1 })
  if (existing.length) {
    await execute<boolean>(model, 'write', [[existing[0]], fields])
    return existing[0]
  }
  return execute<number>(model, 'create', [{ ...fields, x_source_uuid: sourceUuid }])
}

export async function readArchive<T>(
  model: ArchiveModel,
  domain: unknown[],
  fields: string[],
  options: { limit?: number; offset?: number; order?: string } = {}
): Promise<T[]> {
  return execute<T[]>(model, 'search_read', [domain], {
    fields,
    limit: Math.min(Math.max(options.limit ?? 50, 1), 200),
    offset: Math.max(options.offset ?? 0, 0),
    order: options.order ?? 'id desc',
  })
}

export async function countArchive(model: ArchiveModel, domain: unknown[]): Promise<number> {
  return execute<number>(model, 'search_count', [domain])
}

export async function updateArchiveBySource(model: ArchiveModel, sourceUuid: string, fields: Values) {
  const existing = await execute<number[]>(model, 'search',
    [[['x_source_uuid', '=', sourceUuid]]], { limit: 1 })
  if (!existing.length) return false
  return execute<boolean>(model, 'write', [[existing[0]], fields])
}

export function archiveDatetime(value: string | null | undefined): string | false {
  if (!value) return false
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) return false
  return time.toISOString().replace('T', ' ').slice(0, 19)
}
