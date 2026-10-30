import fs from 'fs'
import path from 'path'

/**
 * Pins the "Store product prices include tax" (هل المنتجات بالمتجر تشمل الضريبة) contract:
 * 1. UI renders setting toggle and notice advising the user to enable it when store prices
 *    are tax-inclusive while Odoo expects tax-exclusive amounts (e.g. 115 -> 100 with 15% VAT).
 * 2. UI opens tax rate percentage input with '%' symbol when enabled.
 * 3. sync-engine extracts net price before tax: price / (1 + tax_rate / 100).
 * 4. When disabled (default), prices reach Odoo as-is.
 */

const enginePath = path.join(process.cwd(), 'src', 'lib', 'sync-engine.ts')
const engineSource = fs.readFileSync(enginePath, 'utf8')

const tabPath = path.join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'app',
  'mapping-center',
  'standard-components',
  'order-settings-tab.tsx'
)
const tabSource = fs.readFileSync(tabPath, 'utf8')

const clientPath = path.join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'app',
  'mapping-center',
  'standard-mapping-client.tsx'
)
const clientSource = fs.readFileSync(clientPath, 'utf8')

describe('Order Prices Include Tax — UI contract', () => {
  it('defines orderPricesIncludeTax and orderTaxRatePercent in OrderSettingsTabProps', () => {
    expect(tabSource).toContain('orderPricesIncludeTax: boolean')
    expect(tabSource).toContain('setOrderPricesIncludeTax: (val: boolean) => void')
    expect(tabSource).toContain('orderTaxRatePercent: string')
    expect(tabSource).toContain('setOrderTaxRatePercent: (val: string) => void')
  })

  it('renders the toggle with clear Arabic and English labels', () => {
    expect(tabSource).toContain('أسعار المتجر تشمل الضريبة')
    expect(tabSource).toContain('Store prices include tax')
  })

  it('renders advisory message explaining 115 SAR -> 100 SAR calculation and Odoo tax settings', () => {
    expect(tabSource).toContain('115 ر.س')
    expect(tabSource).toContain('100 ر.س')
    expect(tabSource).toContain('Tax Excluded')
  })

  it('renders percentage input with % badge indicator', () => {
    expect(tabSource).toContain('value={orderTaxRatePercent}')
    expect(tabSource).toContain('%')
  })

  it('persists prices_include_tax and tax_rate_percent in standard-mapping-client', () => {
    expect(clientSource).toContain('prices_include_tax: orderPricesIncludeTax')
    expect(clientSource).toContain('tax_rate_percent: orderTaxRatePercent')
    expect(clientSource).toContain('setOrderPricesIncludeTax')
    expect(clientSource).toContain('setOrderTaxRatePercent')
  })
})

describe('Order Prices Include Tax — Engine contract in sync-engine', () => {
  it('maps camelCase and snake_case keys in keyMap', () => {
    expect(engineSource).toContain("pricesIncludeTax: 'prices_include_tax'")
    expect(engineSource).toContain("taxRatePercent: 'tax_rate_percent'")
  })

  it('reads pricesIncludeTax and taxRatePercent from standard settings with fallback to 15%', () => {
    expect(engineSource).toContain("orDefault('pricesIncludeTax', false)")
    expect(engineSource).toContain("orDefault('taxRatePercent', 15)")
  })

  it('calculates the pre-tax price using tax divisor (1 + taxRate / 100)', () => {
    expect(engineSource).toContain('const taxDivisor = 1 + (taxRatePercent / 100)')
    expect(engineSource).toContain('zidPrice = Math.round((zidPrice / taxDivisor) * 100) / 100')
    expect(engineSource).toContain('zidSalePrice = Math.round((zidSalePrice / taxDivisor) * 100) / 100')
  })

  it('adjusts auto-created product price before tax when option is enabled', () => {
    expect(engineSource).toContain('price = Math.round((price / (1 + (taxRatePercent / 100))) * 100) / 100')
  })
})

describe('Pre-tax Price Math Simulation', () => {
  function computeNetPrice(inclusivePrice: number, taxRate: number): number {
    const divisor = 1 + (taxRate / 100)
    return Math.round((inclusivePrice / divisor) * 100) / 100
  }

  it('converts 115 SAR with 15% VAT to 100 SAR before tax', () => {
    expect(computeNetPrice(115, 15)).toBe(100)
  })

  it('converts 230 SAR with 15% VAT to 200 SAR before tax', () => {
    expect(computeNetPrice(230, 15)).toBe(200)
  })

  it('converts 100 SAR with 15% VAT to 86.96 SAR before tax', () => {
    expect(computeNetPrice(100, 15)).toBe(86.96)
  })

  it('converts 105 SAR with 5% VAT to 100 SAR before tax', () => {
    expect(computeNetPrice(105, 5)).toBe(100)
  })

  it('leaves price intact when tax rate is 0', () => {
    expect(computeNetPrice(115, 0)).toBe(115)
  })
})
