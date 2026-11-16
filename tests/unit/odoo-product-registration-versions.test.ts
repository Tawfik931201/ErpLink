import fs from 'fs'
import path from 'path'

import type { OdooClient } from '../../src/lib/odoo-client'
import { applyFixedSettingsToValues, safeCreateOdooRecord } from '../../src/lib/sync-engine'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

describe('Odoo Product Registration Across Versions 14 to 20', () => {
  const dummyZidData = { id: 12345, name: 'Test Product', sku: 'SKU-001' }

  describe('Odoo 20+ Behavior', () => {
    it('sets tracking=false instead of tracking="none" on Odoo 20 for storable products', async () => {
      const settings = {
        inventory: {
          track_inventory: true,
          tracking: 'none',
        },
      }

      const res = await applyFixedSettingsToValues({}, settings, dummyZidData, 20, 'ws-1', 'zid', 'product.template')

      expect(res.type).toBe('consu')
      expect(res.is_storable).toBe(true)
      expect(res.tracking).toBe(false)
      expect(res.tracking).not.toBe('none')
    })

    it('sets tracking="lot" when configured on Odoo 20', async () => {
      const settings = {
        inventory: {
          track_inventory: true,
          tracking: 'lot',
        },
      }

      const res = await applyFixedSettingsToValues({}, settings, dummyZidData, 20, 'ws-1', 'zid', 'product.template')

      expect(res.type).toBe('consu')
      expect(res.is_storable).toBe(true)
      expect(res.tracking).toBe('lot')
    })

    it('sets tracking="serial" when configured on Odoo 20', async () => {
      const settings = {
        inventory: {
          track_inventory: true,
          tracking: 'serial',
        },
      }

      const res = await applyFixedSettingsToValues({}, settings, dummyZidData, 20, 'ws-1', 'zid', 'product.template')

      expect(res.type).toBe('consu')
      expect(res.is_storable).toBe(true)
      expect(res.tracking).toBe('serial')
    })

    it('sanitizes existing tracking="none" to false for Odoo 20', async () => {
      const initialValues = { tracking: 'none', type: 'consu' }
      const settings = {
        inventory: {
          track_inventory: true,
        },
      }

      const res = await applyFixedSettingsToValues(initialValues, settings, dummyZidData, 20, 'ws-1', 'zid', 'product.template')

      expect(res.tracking).toBe(false)
    })

    it('normalizes legacy type="product" to type="consu" and is_storable=true on Odoo 20', async () => {
      const initialValues = { type: 'product' }
      const settings = {}

      const res = await applyFixedSettingsToValues(initialValues, settings, dummyZidData, 20, 'ws-1', 'zid', 'product.template')

      expect(res.type).toBe('consu')
      expect(res.is_storable).toBe(true)
    })
  })

  describe('Odoo 18 & 19 Behavior', () => {
    it('uses type="consu" and is_storable=true with tracking="none" on Odoo 18 & 19', async () => {
      for (const ver of [18, 19]) {
        const settings = {
          inventory: {
            track_inventory: true,
            tracking: 'none',
          },
        }

        const res = await applyFixedSettingsToValues({}, settings, dummyZidData, ver, 'ws-1', 'zid', 'product.template')

        expect(res.type).toBe('consu')
        expect(res.is_storable).toBe(true)
        expect(res.tracking).toBe('none')
      }
    })

    it('supports lot and serial tracking on Odoo 18 & 19', async () => {
      for (const ver of [18, 19]) {
        const settings = {
          inventory: {
            track_inventory: true,
            tracking: 'lot',
          },
        }

        const res = await applyFixedSettingsToValues({}, settings, dummyZidData, ver, 'ws-1', 'zid', 'product.template')

        expect(res.type).toBe('consu')
        expect(res.is_storable).toBe(true)
        expect(res.tracking).toBe('lot')
      }
    })
  })

  describe('Odoo 14, 15, 16, 17 Behavior', () => {
    it('sets type="product" for storable and removes is_storable field on Odoo 14-17', async () => {
      for (const ver of [14, 15, 16, 17]) {
        const settings = {
          inventory: {
            track_inventory: true,
            tracking: 'none',
          },
        }

        const res = await applyFixedSettingsToValues({ is_storable: true }, settings, dummyZidData, ver, 'ws-1', 'zid', 'product.template')

        expect(res.type).toBe('product')
        expect(res.is_storable).toBeUndefined()
        expect(res.tracking).toBe('none')
      }
    })

    it('sets type="consu" for non-storable products on Odoo 14-17', async () => {
      for (const ver of [14, 15, 16, 17]) {
        const settings = {
          inventory: {
            track_inventory: false,
          },
        }

        const res = await applyFixedSettingsToValues({}, settings, dummyZidData, ver, 'ws-1', 'zid', 'product.template')

        expect(res.type).toBe('consu')
        expect(res.is_storable).toBeUndefined()
        expect(res.tracking).toBe('none')
      }
    })

    it('supports lot tracking on Odoo 14-17', async () => {
      for (const ver of [14, 15, 16, 17]) {
        const settings = {
          inventory: {
            track_inventory: true,
            tracking: 'lot',
          },
        }

        const res = await applyFixedSettingsToValues({}, settings, dummyZidData, ver, 'ws-1', 'zid', 'product.template')

        expect(res.type).toBe('product')
        expect(res.is_storable).toBeUndefined()
        expect(res.tracking).toBe('lot')
      }
    })
  })

  describe('Service products across all versions', () => {
    it('sets type="service" and is_storable=false (v18+) or no is_storable (<18)', async () => {
      for (const ver of [14, 17, 18, 19, 20]) {
        const settings = {
          product_type: 'service',
        }

        const res = await applyFixedSettingsToValues({}, settings, dummyZidData, ver, 'ws-1', 'zid', 'product.template')

        expect(res.type).toBe('service')
        if (ver >= 18) {
          expect(res.is_storable).toBe(false)
        } else {
          expect(res.is_storable).toBeUndefined()
        }
      }
    })
  })

  describe('Source pins for resilience and Odoo ORM error recovery', () => {
    const records = fs.readFileSync(path.resolve(__dirname, '../../src/lib/odoo/records.ts'), 'utf8')
    const separateVariants = fs.readFileSync(path.resolve(__dirname, '../../src/lib/odoo/product-separate-variants.ts'), 'utf8')
    const nativeVariants = fs.readFileSync(path.resolve(__dirname, '../../src/lib/odoo/product-native-variants.ts'), 'utf8')
    const orderLines = fs.readFileSync(path.resolve(__dirname, '../../src/lib/odoo/order-lines.ts'), 'utf8')

    it('pins that safeCreateOdooRecord prunes fields on "Wrong value for" ORM validation errors', () => {
      expect(records).toContain('Wrong value for (?:[a-zA-Z0-9_]+\\.)*([a-zA-Z0-9_]+):')
      expect(records).toContain('Pruning invalid selection value for field "${badField}" from ${model} create')
    })

    it('pins that safeWriteOdooRecord prunes fields on "Wrong value for" ORM validation errors', () => {
      expect(records).toContain('Pruning invalid selection value for field "${badField}" from ${model} write')
    })

    it('pins that syncAsSeparateProducts and syncTemplateWithVariants use safeWriteOdooRecord and safeCreateOdooRecord', () => {
      expect(separateVariants).toContain("safeWriteOdooRecord(client, 'product.template', mainDuplicateId, odooValues, odooValues, platform)")
      expect(separateVariants).toContain("mainRecordId = await safeCreateOdooRecord(client, 'product.template', odooValues, odooValues, undefined, platform)")
      expect(separateVariants).toContain("safeWriteOdooRecord(client, 'product.template', duplicateId, variantOdooValues, variantOdooValues, platform)")
      const variantCreate = /safeCreateOdooRecord\(client, 'product.template', variantOdooValues, variantOdooValues,\s*`variant:\$\{String\(variant\.id \|\| variant\.sku \|\| JSON\.stringify\(variant\.attributes\)\)\}`, platform\)/
      expect(separateVariants).toMatch(variantCreate)
      // Removing the source identity must fail this pin: otherwise distinct
      // same-model variants would share the parent's durable create effect.
      expect(separateVariants.replace(variantCreate, "safeCreateOdooRecord(client, 'product.template', variantOdooValues, variantOdooValues)"))
        .not.toMatch(variantCreate)
      expect(nativeVariants).toContain("safeWriteOdooRecord(client, 'product.template', duplicateId, odooValues, odooValues, platform)")
      expect(nativeVariants).toContain("templateId = await safeCreateOdooRecord(client, 'product.template', odooValues, odooValues, undefined, platform)")
    })

    it('pins that order line auto-creation handles Odoo 18+ is_storable and Odoo 20+ tracking', () => {
      expect(orderLines).toContain('prodVals.is_storable = wantsStorable')
      expect(orderLines).toContain('prodVals.tracking = false')
    })
  })

  describe('Executable validation fallback', () => {
    it.each([
      ["Invalid field 'is_storable' on model 'product.template'", 'is_storable', true],
      ["Wrong value for product.template.tracking: 'none'", 'tracking', 'none'],
    ])('preserves field pruning after confirmed ORM rejection: %s', async (message, field, value) => {
      const rejection = Object.assign(new Error(String(message)), { faultCode: 1 })
      const create = jest.fn().mockRejectedValueOnce(rejection).mockResolvedValueOnce(42)
      const client = { create } as unknown as OdooClient
      await expect(safeCreateOdooRecord(client, 'product.template', { name: 'Fixture', [String(field)]: value }, {})).resolves.toBe(42)
      expect(create).toHaveBeenCalledTimes(2)
      expect(create.mock.calls[1]).toEqual(['product.template', { name: 'Fixture' }])
    })
  })
})
