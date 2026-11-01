import fs from 'fs'
import path from 'path'

import { applyFixedSettingsToValues } from '../../src/lib/sync-engine'

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
    const syncEngineSrc = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')

    it('pins that safeCreateOdooRecord prunes fields on "Wrong value for" ORM validation errors', () => {
      expect(syncEngineSrc).toContain('Wrong value for (?:[a-zA-Z0-9_]+\\.)*([a-zA-Z0-9_]+):')
      expect(syncEngineSrc).toContain('Pruning invalid selection value for field "${badField}" from ${model} create')
    })

    it('pins that safeWriteOdooRecord prunes fields on "Wrong value for" ORM validation errors', () => {
      expect(syncEngineSrc).toContain('Pruning invalid selection value for field "${badField}" from ${model} write')
    })

    it('pins that syncAsSeparateProducts and syncTemplateWithVariants use safeWriteOdooRecord and safeCreateOdooRecord', () => {
      expect(syncEngineSrc).toContain("safeWriteOdooRecord(client, 'product.template', mainDuplicateId, odooValues, odooValues)")
      expect(syncEngineSrc).toContain("safeCreateOdooRecord(client, 'product.template', odooValues, odooValues)")
      expect(syncEngineSrc).toContain("safeWriteOdooRecord(client, 'product.template', duplicateId, variantOdooValues, variantOdooValues)")
      expect(syncEngineSrc).toContain("safeCreateOdooRecord(client, 'product.template', variantOdooValues, variantOdooValues)")
      expect(syncEngineSrc).toContain("safeWriteOdooRecord(client, 'product.template', duplicateId, odooValues, odooValues)")
      expect(syncEngineSrc).toContain("safeCreateOdooRecord(client, 'product.template', odooValues, odooValues)")
    })

    it('pins that order line auto-creation handles Odoo 18+ is_storable and Odoo 20+ tracking', () => {
      expect(syncEngineSrc).toContain('prodVals.is_storable = wantsStorable')
      expect(syncEngineSrc).toContain('prodVals.tracking = false')
    })
  })
})
