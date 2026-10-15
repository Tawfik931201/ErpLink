import fs from 'fs'
import path from 'path'

import { SHOPIFY_EVENTS, SHOPIFY_FIELDS } from '@/lib/platforms/shopify/fields'
import { resolveShopifyCustomerFullName } from '@/lib/sync-helpers'

/**
 * Shopify customer name pins (review 2026-10-11).
 *
 * Shopify sends first_name / last_name separately while the standard preset
 * maps name <- first_name only, which dropped the family name ("Bob" instead
 * of "Bob Biller"). resolveShopifyCustomerFullName composes the full name and
 * executeOdooOperation applies it; these tests pin the helper plus source pins
 * proving the wiring and the customers/delete catalogue entry stay put.
 */

describe('resolveShopifyCustomerFullName', () => {
  it('joins first and last name', () => {
    expect(resolveShopifyCustomerFullName({ first_name: 'Bob', last_name: 'Biller' })).toBe('Bob Biller')
  })

  it('tolerates a missing last name', () => {
    expect(resolveShopifyCustomerFullName({ first_name: 'Bob', last_name: '' })).toBe('Bob')
    expect(resolveShopifyCustomerFullName({ first_name: 'Bob' })).toBe('Bob')
  })

  it('falls back to default_address.name when parts are absent', () => {
    expect(resolveShopifyCustomerFullName({ default_address: { name: 'Bob Biller' } })).toBe('Bob Biller')
  })

  it('falls back to addresses[0] (name, then first/last)', () => {
    expect(resolveShopifyCustomerFullName({ addresses: [{ name: 'Bob Biller' }] })).toBe('Bob Biller')
    expect(
      resolveShopifyCustomerFullName({ addresses: [{ first_name: 'Bob', last_name: 'Biller' }] })
    ).toBe('Bob Biller')
  })

  it('returns empty when nothing usable is present', () => {
    expect(resolveShopifyCustomerFullName({})).toBe('')
    expect(resolveShopifyCustomerFullName({ first_name: '  ', last_name: '' })).toBe('')
  })

  it('composes a Salla-shaped customer (first/last, no name field)', () => {
    // Salla sends no `name` on customer webhooks — without composition the
    // create reaches Odoo nameless and fails with "Contacts require a name".
    expect(
      resolveShopifyCustomerFullName({
        first_name: 'Mohammed',
        last_name: 'Ali',
        email: 'user@gmail.com',
        mobile: '+96652318526',
      })
    ).toBe('Mohammed Ali')
  })
})

describe('shopify customer catalogue', () => {
  it('offers customers/delete against res.partner', () => {
    const entry = SHOPIFY_EVENTS.find((e) => e.id === 'customers/delete')
    expect(entry).toBeDefined()
    expect(entry!.targetModel).toBe('res.partner')
  })

  it('exposes address fields on customers/update like customers/create', () => {
    for (const key of ['addresses.0.city', 'addresses.0.country', 'addresses.0.zip', 'addresses.0.address1']) {
      expect(SHOPIFY_FIELDS['customers/update'].map((f) => f.value)).toContain(key)
    }
    expect(SHOPIFY_FIELDS['customers/delete'].map((f) => f.value)).toContain('id')
  })
})

describe('full-name wiring source pins', () => {
  const ROOT = process.cwd()
  const engine = fs.readFileSync(path.join(ROOT, 'src/lib/sync-engine.ts'), 'utf8')

  it('applies the composed name in the res.partner block', () => {
    expect(engine).toContain('resolveShopifyCustomerFullName')
  })

  it('never overwrites an explicit mapping to another source', () => {
    // Only an empty name or one equal to first_name alone is replaced.
    expect(engine).toContain('current === firstOnly')
  })

  it('applies the composed name to Salla customers too (no name field there)', () => {
    expect(engine).toMatch(/custPlatform === 'shopify' \|\| custPlatform === 'salla'/)
  })
})
