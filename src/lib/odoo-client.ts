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

function callAsync<T>(client: ReturnType<typeof xmlrpc.createClient>, method: string, params: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err: unknown, value: T) => {
      if (err) reject(err)
      else resolve(value)
    })
  })
}

export class OdooClient {
  private config: OdooConfig
  private uid: number | null = null

  constructor(config: OdooConfig) {
    this.config = config
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
    const uid = await this.authenticate()
    const object = createXmlRpcClient(this.config.url, '/xmlrpc/2/object')
    return callAsync<T>(object, 'execute_kw', [
      this.config.db,
      uid,
      this.config.apiKey,
      model,
      method,
      args,
      kwargs,
    ])
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

/** Create an OdooClient from environment variables (for server-side use) */
export function createOdooClientFromEnv(): OdooClient {
  return new OdooClient({
    url: process.env.ODOO_URL!,
    db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME!,
    apiKey: process.env.ODOO_API_KEY!,
  })
}
