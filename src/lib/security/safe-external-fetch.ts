/**
 * SSRF-safe outbound requests for user-configured ERP hosts.
 *
 * Resolve A/AAAA records, reject all non-public addresses and PIN the selected
 * address into the socket's lookup callback. This closes the DNS validation /
 * connection time-of-check-time-of-use gap. Redirects are never followed.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

/** Deny non-globally-routable and special-purpose addresses. */
export function isPublicIpAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase()
  const family = isIP(ip)
  if (family === 4) {
    const [a, b, c] = ip.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (family === 6) {
    // Only accept global-unicast 2000::/3. Deny tunnelled, documentation,
    // unique-local, loopback, link-local and IPv4-mapped addresses.
    return /^[23][0-9a-f]{3}:/.test(ip) &&
      !ip.startsWith('2001:db8:') &&
      !ip.startsWith('2001:0:') &&
      !ip.startsWith('2001:10:') &&
      !ip.startsWith('2001:20:') &&
      !ip.startsWith('2002:')
  }
  return false
}

export async function resolvePublicDestination(rawUrl: string): Promise<{
  url: URL
  address: string
  family: number
}> {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) ERP URLs are allowed')
  if (url.username || url.password) throw new Error('Credentials must not be embedded in an ERP URL')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local and internal ERP hostnames are not allowed')
  }
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await dnsLookup(host, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('ERP destination resolves to a blocked or non-public network')
  }
  return { url, address: addresses[0].address, family: addresses[0].family }
}

/**
 * Called by the Node Agent before each new socket. The validated DNS address
 * is exactly the address the socket dialer receives (prevents DNS rebinding).
 * Agents using this lookup must set autoSelectFamily=false.
 */
export function publicErpDnsLookup(
  hostname: string,
  _options: unknown,
  callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void
): void {
  const host = hostname.replace(/^\\[|\\]$/g, '')
  resolvePublicDestination(`https://${host}`)
    .then(({ address, family }) => callback(null, address, family))
    .catch((error: unknown) => callback(
      error instanceof Error ? error as NodeJS.ErrnoException : new Error('ERP DNS validation failed'),
      '',
      4
    ))
}

export function assertSecureErpTransport(rawUrl: string): void {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid ERP URL or embedded credentials')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('ERP connections must use HTTPS in production')
  }
}

/**
 * Fetch with DNS-pinned connection, no redirects, response size and timeout
 * bounds. Returns a standard Response so existing ERPNext JSON handlers work.
 */
export async function safeExternalFetch(rawUrl: string | URL, init: RequestInit = {}): Promise<Response> {
  assertSecureErpTransport(String(rawUrl))
  const { url, address, family } = await resolvePublicDestination(String(rawUrl))
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const MAX_BYTES = 10 * 1024 * 1024
  const TIMEOUT_MS = 30_000

  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = transport(url, {
      method: init.method || 'GET',
      headers,
      timeout: TIMEOUT_MS,
      // DNS pinning: the TLS SNI/Host remain the user's original hostname.
      lookup: (_host, _options, callback) => {
        callback(null, address, family)
      },
    }, (res) => {
      const status = res.statusCode || 502
      if (status >= 300 && status < 400) {
        res.resume()
        reject(new Error('Redirects from ERP servers are not followed (SSRF protection)'))
        return
      }
      const buffers: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BYTES) {
          req.destroy(new Error('ERP server response exceeded 10 MB'))
          return
        }
        buffers.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => {
        const body = status === 204 || status === 205 || status === 304 ? null : new Uint8Array(Buffer.concat(buffers))
        resolve(new Response(body, { status, statusText: res.statusMessage || '' }))
      })
    })
    req.on('timeout', () => req.destroy(new Error('ERP server connection timed out')))
    req.on('error', reject)
    if (init.signal) {
      if (init.signal.aborted) req.destroy(new Error('ERP request aborted'))
      else init.signal.addEventListener('abort', () => req.destroy(new Error('ERP request aborted')), { once: true })
    }
    if (init.body) {
      if (typeof init.body !== 'string' && !(init.body instanceof Uint8Array)) {
        req.destroy(new Error('Unsupported ERP request body'))
        return
      }
      req.end(init.body)
    } else {
      req.end()
    }
  })
}
