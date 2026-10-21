import { formatOdooVersion, parseOdooVersionInfo } from '@/lib/odoo/version'

/**
 * `common.version` is the only place the Odoo edition/version is exposed, and
 * its payload differs between on-premise and online ("saas~") instances. The
 * connect screen shows whatever this returns, so the parsing rules are pinned
 * here: a wrong label is a support ticket, and an exception would break a
 * connection that already authenticated fine.
 *
 * Source under test: src/lib/odoo/version.ts (used by OdooClient.getVersionInfo)
 */

describe('parseOdooVersionInfo', () => {
  it('reads a classic on-premise payload', () => {
    const info = parseOdooVersionInfo({
      server_version: '17.0+e',
      server_version_info: [17, 0, 0, 'final', 0, ''],
      server_serie: '17.0',
      protocol_version: 1,
    })

    expect(info).toEqual({
      serverVersion: '17.0+e',
      serverSerie: '17.0',
      majorVersion: 17,
      versionInfo: [17, 0, 0, 'final', 0, ''],
    })
  })

  it('handles an Odoo Online "saas~" version', () => {
    const info = parseOdooVersionInfo({ server_version: 'saas~17.4', server_serie: 'saas~17.4' })

    expect(info.serverVersion).toBe('saas~17.4')
    expect(info.majorVersion).toBe(17)
    expect(info.versionInfo).toBeNull()
  })

  it('derives the major from server_version when server_version_info is missing', () => {
    expect(parseOdooVersionInfo({ server_version: '18.0' }).majorVersion).toBe(18)
  })

  it('derives the major from server_serie when only that is sent', () => {
    expect(parseOdooVersionInfo({ server_serie: '19.0' }).majorVersion).toBe(19)
  })

  it('keeps the real mixed-type version_info tail', () => {
    const info = parseOdooVersionInfo({
      server_version: '16.0',
      server_version_info: [16, 0, 0, 'final', 0],
    })

    expect(info.versionInfo).toEqual([16, 0, 0, 'final', 0])
    expect(info.majorVersion).toBe(16)
  })

  it('ignores a malformed server_version_info array', () => {
    const info = parseOdooVersionInfo({
      server_version: '16.0',
      server_version_info: [16, 0, { nope: true }, 'final'],
    })

    expect(info.versionInfo).toBeNull()
    expect(info.majorVersion).toBe(16)
  })

  it('never throws on garbage', () => {
    for (const raw of [null, undefined, 'oops', 42, [], {}]) {
      expect(parseOdooVersionInfo(raw)).toEqual({
        serverVersion: null,
        serverSerie: null,
        majorVersion: null,
        versionInfo: null,
      })
    }
  })

  it('treats blank strings as absent', () => {
    expect(parseOdooVersionInfo({ server_version: '   ', server_serie: '' })).toEqual({
      serverVersion: null,
      serverSerie: null,
      majorVersion: null,
      versionInfo: null,
    })
  })
})

describe('formatOdooVersion', () => {
  it('prefers the full server_version', () => {
    expect(
      formatOdooVersion({
        serverVersion: '17.0+e',
        serverSerie: '17.0',
        majorVersion: 17,
        versionInfo: [17, 0, 0, 'final', 0, ''],
      })
    ).toBe('17.0+e')
  })

  it('falls back to the serie, then the bare major', () => {
    expect(
      formatOdooVersion({
        serverVersion: null,
        serverSerie: '18.0',
        majorVersion: 18,
        versionInfo: null,
      })
    ).toBe('18.0')

    expect(
      formatOdooVersion({
        serverVersion: null,
        serverSerie: null,
        majorVersion: 19,
        versionInfo: null,
      })
    ).toBe('19')
  })

  it('returns null when Odoo reported nothing usable', () => {
    expect(formatOdooVersion(null)).toBeNull()
    expect(formatOdooVersion(parseOdooVersionInfo({}))).toBeNull()
  })
})
