/**
 * Odoo XML-RPC Client
 * Odoo exposes three endpoints:
 *   /web/dataset/call_kw  – model methods
 *   /xmlrpc/2/common      – auth
 *   /xmlrpc/2/object      – model CRUD
 *
 * We use the `xmlrpc` npm package for low-level calls and wrap them
 * in typed, promise-based helpers.
 */
import xmlrpc from 'xmlrpc'

import { checkImpersonationWriteBlock } from './auth'
import { parseOdooVersionInfo, type OdooVersionInfo } from './odoo/version'

export interface OdooConfig {
  url: string      // e.g. https://mycompany.odoo.com
  db: string
  username: string
  apiKey: string   // use API key instead of password (Odoo 14+)
}

function createXmlRpcClient(url: string, path: string) {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const options = {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : isHttps ? 443 : 80,
    path,
  }
  return isHttps ? xmlrpc.createSecureClient(options) : xmlrpc.createClient(options)
}

const RPC_TIMEOUT_MS = 10_000

function callAsync<T>(client: ReturnType<typeof xmlrpc.createClient>, method: string, params: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: (value: any) => void, value: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      finish(reject, new Error(`ERP request timed out after ${RPC_TIMEOUT_MS / 1000} seconds`))
    }, RPC_TIMEOUT_MS)

    client.methodCall(method, params, (err: unknown, value: T) => {
      if (err) finish(reject, err)
      else finish(resolve, value)
    })
  })
}

export class OdooClient {
  private config: OdooConfig
  private uid: number | null = null
  private majorVersion: number | null = null
  private versionInfo: OdooVersionInfo | null = null

  constructor(config: OdooConfig) {
    this.config = config
  }

  get url(): string {
    return this.config.url
  }

  get db(): string {
    return this.config.db
  }

  /**
   * Full version details as reported by `/xmlrpc/2/common` (no auth needed).
   * Cached on the instance — one extra RPC per client at most.
   */
  async getVersionInfo(): Promise<OdooVersionInfo> {
    if (this.versionInfo) return this.versionInfo
    const common = createXmlRpcClient(this.config.url, '/xmlrpc/2/common')
    const info = await callAsync<Record<string, unknown>>(common, 'version', [])
    this.versionInfo = parseOdooVersionInfo(info)
    if (this.versionInfo.majorVersion) this.majorVersion = this.versionInfo.majorVersion
    return this.versionInfo
  }

  /** Get Odoo major version (e.g. 17, 18, 19) */
  async getMajorVersion(): Promise<number> {
    if (this.majorVersion) return this.majorVersion
    const info = await this.getVersionInfo().catch(() => null)
    this.majorVersion = info?.majorVersion ?? 17
    return this.majorVersion
  }

  /** Authenticate and cache the user UID */
  async authenticate(): Promise<number> {
    if (this.uid) return this.uid
    const common = createXmlRpcClient(this.config.url, '/xmlrpc/2/common')
    const uid = await callAsync<number>(common, 'authenticate', [
      this.config.db,
      this.config.username,
      this.config.apiKey,
      {},
    ])
    if (!uid) throw new Error('Odoo authentication failed — check credentials')
    this.uid = uid
    return uid
  }

  /** Generic model execute wrapper */
  async execute<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
    // List of read-only XML-RPC methods in Odoo
    const readMethods = ['search', 'read', 'search_read', 'search_count', 'name_get', 'fields_get']
    if (!readMethods.includes(method)) {
      await checkImpersonationWriteBlock('Odoo ERP')
    }

    const uid = await this.authenticate()
    const object = createXmlRpcClient(this.config.url, '/xmlrpc/2/object')

    const rpcParams = [
      this.config.db,
      uid,
      this.config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]

    const isDebug = process.env.ODOO_DEBUG === 'true'

    if (isDebug) {
      console.log(`\n=========================================`)
      console.log(`[OdooClient] → ${model}.${method}`)
      console.log(`[OdooClient]   URL: ${this.config.url}`)
      console.log(`[OdooClient]   DB: ${this.config.db}`)
      console.log(`[OdooClient]   args: ${JSON.stringify(args, null, 2)}`)
      if (Object.keys(kwargs).length > 0) {
        console.log(`[OdooClient]   kwargs: ${JSON.stringify(kwargs, null, 2)}`)
      }
      console.log(`=========================================\n`)
    } else {
      console.info(`[OdooClient] → ${model}.${method}`)
    }

    try {
      const result = await callAsync<T>(object, 'execute_kw', rpcParams)
      if (isDebug) {
        console.log(`\n[OdooClient] ← ${model}.${method} RESPONSE:`)
        console.log(JSON.stringify(result, null, 2))
        console.log(`=========================================\n`)
      }
      return result
    } catch (err: any) {
      console.error(`\n[OdooClient] ✖ ${model}.${method} ERROR:`)
      console.error(err?.message ?? String(err))
      if (err?.res?.statusCode) {
        console.error(`HTTP Status: ${err.res.statusCode}`)
      }
      if (isDebug) {
        console.log(`=========================================\n`)
      }
      throw err
    }
  }


  // ─── Convenience methods ─────────────────────────────────────────────────

  search(model: string, domain: unknown[], limit = 100) {
    return this.execute<number[]>(model, 'search', [domain], { limit })
  }

  read<T>(model: string, ids: number[], fields: string[]) {
    return this.execute<T[]>(model, 'read', [ids], { fields })
  }

  searchRead<T>(model: string, domain: unknown[], fields: string[], limit = 100, offset = 0) {
    return this.execute<T[]>(model, 'search_read', [domain], { fields, limit, offset })
  }

  create(model: string, values: Record<string, unknown>) {
    return this.execute<number>(model, 'create', [values])
  }

  write(model: string, ids: number[], values: Record<string, unknown>) {
    return this.execute<boolean>(model, 'write', [ids, values])
  }

  unlink(model: string, ids: number[]) {
    return this.execute<boolean>(model, 'unlink', [ids])
  }

  count(model: string, domain: unknown[]) {
    return this.execute<number>(model, 'search_count', [domain])
  }
}
