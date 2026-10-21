/**
 * Parsing/formatting of the payload returned by Odoo's `common.version` RPC.
 *
 * `OdooClient.getVersionInfo()` fetches the raw payload; the parsing lives here
 * (pure, no I/O) so it can be unit-tested without an XML-RPC server. Odoo has
 * shifted this shape over the years, so every field is optional:
 *
 *   { server_version: "17.0+e",
 *     server_version_info: [17, 0, 0, 'final', 0, ''],
 *     server_serie: "17.0",
 *     protocol_version: 1 }
 *
 * Online databases report versions like `saas~17.4`, and some old proxies
 * return only `server_version`, so the major number is derived from whichever
 * field is present.
 */

export type OdooVersionInfo = {
  /** Full version string, e.g. `17.0+e` or `saas~17.4`. */
  serverVersion: string | null
  /** Series string, e.g. `17.0`. */
  serverSerie: string | null
  /** Major version, e.g. `17`. */
  majorVersion: number | null
  /**
   * `server_version_info` as Odoo sends it. It is **not** all numbers:
   * `[17, 0, 0, 'final', 0, '']` is the real shape, so the tail carries
   * strings and only the leading entries are numeric.
   */
  versionInfo: Array<number | string> | null
}

function parseMajor(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/(\d+)/)
  if (!match) return null
  const major = Number.parseInt(match[1], 10)
  return Number.isFinite(major) ? major : null
}

export function parseOdooVersionInfo(raw: unknown): OdooVersionInfo {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const serverVersion =
    typeof record.server_version === 'string' && record.server_version.trim()
      ? record.server_version.trim()
      : null

  const serverSerie =
    typeof record.server_serie === 'string' && record.server_serie.trim()
      ? record.server_serie.trim()
      : null

  const rawInfo = record.server_version_info
  const versionInfo =
    Array.isArray(rawInfo) &&
    rawInfo.every((part) => typeof part === 'number' || typeof part === 'string')
      ? (rawInfo as Array<number | string>)
      : null

  const majorVersion =
    (typeof versionInfo?.[0] === 'number' ? versionInfo[0] : null) ??
    parseMajor(serverVersion) ??
    parseMajor(serverSerie)

  return { serverVersion, serverSerie, majorVersion, versionInfo }
}

/**
 * The value shown next to "Odoo version" in the UI and stored in
 * `erp_connections.odoo_version`. Returns `null` when Odoo reported nothing
 * usable, so callers can fall back to "unknown" instead of printing a lie.
 */
export function formatOdooVersion(info: OdooVersionInfo | null | undefined): string | null {
  if (!info) return null
  if (info.serverVersion) return info.serverVersion
  if (info.serverSerie) return info.serverSerie
  return info.majorVersion != null ? String(info.majorVersion) : null
}
