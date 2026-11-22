/**
 * Odoo XML-RPC Client
 * Odoo exposes three endpoints:
 *   /web/dataset/call_kw  – model methods
 *   /xmlrpc/2/common      – auth
 *   /xmlrpc/2/object      – model CRUD
 *
 * We use the `xmlrpc` npm package for low-level calls and wrap them
 * in typed, promise-based helpers.
 *
 * ─── تحسينات السعة (المرحلة 5) ─────────────────────────────────────────────
 * كان كل حدث ينشئ `OdooClient` جديداً ⇒ نداء `authenticate` إضافي + نداء
 * `version` إضافي، وكل نداء يفتح اتصال TLS جديداً (`xmlrpc` لا يمرّر agent
 * افتراضياً نجمعه). النتيجة: حدث واحد = 6..15 نداءاً **متتالياً**، كل واحد
 * منها بدفع مصافحة TLS ⇒ سعة المعالجة عشرات الأحداث في الدقيقة فقط.
 *
 * ما تغيّر:
 *   1. **ذاكرة uid عالمية** — المفتاح (url, db, username, بصمة المفتاح).
 *      كلمة المرور تُرسَل وتُتحقَّق في كل نداء كما هي، فتخزين الـuid لا
 *      يُضعف الأمان. عند خطأ مصادقة يُبطَل المدخل فتساعد النداء التالية.
 *   2. **ذاكرة version عالمية** — نداء واحد لكل خادم بدل واحد لكل عميل.
 *  3. **keep-alive** — `xmlrpc` يمرّر `options` كما هو إلى `https.request`،
 *      فمرّر `agent` يجمع الاتصالات ونعيد استعمال مصافسة TLS.
 */
import { createHash } from 'crypto'
import http from 'http'
import https from 'https'

import xmlrpc from 'xmlrpc'

import { checkImpersonationWriteBlock } from './auth'
import { runErpCreateEffect } from './erp-effect-context'
import { parseOdooVersionInfo, type OdooVersionInfo } from './odoo/version'
import { assertSecureErpTransport, publicErpDnsLookup } from './security/safe-external-fetch'

export interface OdooConfig {
  url: string      // e.g. https://mycompany.odoo.com
  db: string
  username: string
  apiKey: string   // use API key instead of password (Odoo 14+)
}

const RPC_TIMEOUT_MS = 10_000

// ─── الذاكرة العامة ─────────────────────────────────────────────────────────

/** بصمة المفتاح — لا نخزّن كلمة المرور نفسها. */
function keyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
}

function credentialKey(config: OdooConfig): string {
  return `${config.url}|${config.db}|${config.username}|${keyFingerprint(config.apiKey)}`
}

/** uid = مُعرّف المستخدم في أودوو. كلمة المرور تُتحقَّق في كل نداء. */
const uidCache = new Map<string, number>()
const versionCache = new Map<string, OdooVersionInfo>()

/** حدود الذاكرة — الخادم قد يخدم عشرات العملاء. */
const MAX_UID_CACHE = 500
const MAX_VERSION_CACHE = 200

function cacheSet<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  if (map.size >= max) {
    const oldest = map.keys().next()
    if (!oldest.done) map.delete(oldest.value)
  }
  map.set(key, value)
}

/** إبطال uid (عند خطأ مصادقة) — النداء التالية تعيد المصادقة. */
function evictUid(config: OdooConfig): void {
  uidCache.delete(credentialKey(config))
}

export function clearOdooClientCaches(): void {
  uidCache.clear()
  versionCache.clear()
}

// ─── تجميع الاتصالات (keep-alive) ───────────────────────────────────────────

const httpsAgents = new Map<string, https.Agent>()
const httpAgents = new Map<string, http.Agent>()

/**
 * `xmlrpc` يمرّر `options` كما هو إلى `https.request` ⇒ يكفي تمرير `agent`.
 * بدونه كل نداء يفتح اتصالاً جديداً (مصافحة TLS كاملة).
 */
function getAgent(url: string): https.Agent | http.Agent {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const key = parsed.host
  if (isHttps) {
    let agent = httpsAgents.get(key)
    if (!agent) {
      agent = new https.Agent({
        ...(process.env.NODE_ENV === 'production' ? { lookup: publicErpDnsLookup, autoSelectFamily: false } : {}),
        keepAlive: true,
        keepAliveMsecs: 30_000,
        maxSockets: 24,
        maxFreeSockets: 8,
        timeout: 60_000,
      })
      httpsAgents.set(key, agent)
    }
    return agent
  }
  let agent = httpAgents.get(key)
  if (!agent) {
    agent = new http.Agent({
      ...(process.env.NODE_ENV === 'production' ? { lookup: publicErpDnsLookup, autoSelectFamily: false } : {}),
      keepAlive: true,
      keepAliveMsecs: 30_000,
      maxSockets: 24,
      maxFreeSockets: 8,
      timeout: 60_000,
    })
    httpAgents.set(key, agent)
  }
  return agent
}

function createXmlRpcClient(url: string, path: string, freshConnection = false) {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  assertSecureErpTransport(url)
  const secureLookup = process.env.NODE_ENV === 'production'
    ? { lookup: publicErpDnsLookup, autoSelectFamily: false }
    : {}
  const freshAgent = isHttps
    ? new https.Agent({ keepAlive: false, ...secureLookup })
    : new http.Agent({ keepAlive: false, ...secureLookup })
  const options = {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : isHttps ? 443 : 80,
    path,
    agent: freshConnection ? freshAgent : getAgent(url),
  }
  return isHttps ? xmlrpc.createSecureClient(options) : xmlrpc.createClient(options)
}

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

/**
 * Some reverse proxies return an HTML error page for a temporarily failed
 * XML-RPC request. The `xmlrpc` package then reports parser errors such as
 * "Unknown XML-RPC tag 'TITLE'" instead of the underlying 502/503 response.
 * Treat those parser/network failures as transient transport failures.
 */
export function isTransientXmlRpcTransportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /unknown xml-rpc tag|unexpected token\s*</i.test(message)
    || /non-whitespace before first tag|invalid xml-rpc/i.test(message)
    || /socket hang up|econnreset|epipe|etimedout|econnrefused/i.test(message)
    || /\b(?:502|503|504)\b|bad gateway|service unavailable|gateway timeout/i.test(message)
}

/** هل الخطأ خطأ مصادقة (⇒ يُبطَل الـuid المخزَّن)؟ */
function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /access denied|invalid.*(login|password|uid)|unauthorized|401|403/i.test(message)
}

export class OdooClient {
  private config: OdooConfig
  private uid: number | null = null
  private majorVersion: number | null = null
  private versionInfo: OdooVersionInfo | null = null

  constructor(config: OdooConfig) {
    assertSecureErpTransport(config.url)
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
   * Cached process-wide — one RPC per server, not per client instance.
   */
  async getVersionInfo(): Promise<OdooVersionInfo> {
    if (this.versionInfo) return this.versionInfo
    const cached = versionCache.get(this.config.url)
    if (cached) {
      this.versionInfo = cached
      if (cached.majorVersion) this.majorVersion = cached.majorVersion
      return cached
    }
    const common = createXmlRpcClient(this.config.url, '/xmlrpc/2/common')
    const info = await callAsync<Record<string, unknown>>(common, 'version', [])
    this.versionInfo = parseOdooVersionInfo(info)
    cacheSet(versionCache, this.config.url, this.versionInfo, MAX_VERSION_CACHE)
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

  /**
   * Authenticate and cache the user UID.
   *
   * The UID is cached **process-wide** (keyed by url/db/user/key-fingerprint):
   * a new OdooClient is built per event, and re-authenticating every time
   * cost one extra XML-RPC round trip per event. The password is still sent
   * and validated on every call, so caching the UID grants no extra access.
   */
  async authenticate(): Promise<number> {
    if (this.uid) return this.uid
    const key = credentialKey(this.config)
    const cached = uidCache.get(key)
    if (cached !== undefined) {
      this.uid = cached
      return cached
    }
    const common = createXmlRpcClient(this.config.url, '/xmlrpc/2/common')
    const uid = await callAsync<number>(common, 'authenticate', [
      this.config.db,
      this.config.username,
      this.config.apiKey,
      {},
    ])
    if (!uid) throw new Error('Odoo authentication failed — check credentials')
    this.uid = uid
    cacheSet(uidCache, key, uid, MAX_UID_CACHE)
    return uid
  }

  /** Generic model execute wrapper */
  async execute<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
    if (method === 'create') {
      const values = args[0]
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error('ERP create requires an individual values object')
      }
      return runErpCreateEffect(model, values as Record<string, unknown>,
        () => this.executeRequest<number>(model, method, args, kwargs),
        error => !!error && typeof error === 'object' && 'faultCode' in error,
        id => {
          const result = Number(id)
          if (!Number.isInteger(result) || result <= 0) throw new Error('ERP_OUTCOME_UNKNOWN: invalid persisted ERP record identity')
          return result
        }) as Promise<T>
    }
    return this.executeRequest<T>(model, method, args, kwargs)
  }

  private async executeRequest<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown>): Promise<T> {
    // List of read-only XML-RPC methods in Odoo
    const readMethods = ['search', 'read', 'search_read', 'search_count', 'name_get', 'fields_get', 'default_get']
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
      console.log(`=========================================\n`)
    } else {
      console.info(`[OdooClient] → ${model}.${method}`)
    }

    try {
      let result: T
      try {
        result = await callAsync<T>(object, 'execute_kw', rpcParams)
      } catch (firstErr: any) {
        // Reads and ORM writes are safe to repeat with the same arguments.
        // Retry once on a fresh socket when a proxy returned HTML / a stale
        // keep-alive connection broke. Never auto-retry create/unlink/action
        // calls here: their outcome may already have been committed remotely.
        const safeToRetry = readMethods.includes(method) || method === 'write'
        if (!safeToRetry || !isTransientXmlRpcTransportError(firstErr)) throw firstErr
        console.warn(
          `[OdooClient] transient XML-RPC transport failure on ${model}.${method}; retrying once with a fresh connection: ${firstErr?.message ?? String(firstErr)}`
        )
        const freshObject = createXmlRpcClient(this.config.url, '/xmlrpc/2/object', true)
        result = await callAsync<T>(freshObject, 'execute_kw', rpcParams)
      }
      if (isDebug) {
        console.log(`\n[OdooClient] ← ${model}.${method} RESPONSE:`)
        console.log(JSON.stringify(result, null, 2))
        console.log(`=========================================\n`)
      }
      return result
    } catch (err: any) {
      // خطأ مصادقة ⇒ يُبطَل الـuid المخزَّن فتعيد النداء التالية المصادقة
      // (كلمة المرور قد تكون تغيّرت عند العميل).
      if (isAuthError(err)) evictUid(this.config)
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
