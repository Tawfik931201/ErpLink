'use client'

import { Layers, Settings2 } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Renders the saved `field_mappings.mappings` payload as ordinary fields
 * instead of a raw JSON blob.
 *
 * The stored shape (verified against live rows) is:
 *   {
 *     "<odoo_model>": [
 *       { id, erpField, zidField, staticValue, policy?, matchOperator?,
 *         fuzzyMatchMappings?, inlineSubMapping?, inlineMatch?, createMappingId? }
 *     ],
 *     "__settings": { relations, payloadPaths, deleteBehavior, variantSyncMode, ... }
 *   }
 *
 * Merchants read this page to check *what is mapped to what*, so the mapping
 * lines are the primary content (a table per model) and `__settings` is shown
 * underneath as labelled values — and only when it carries something other
 * than defaults, otherwise it is noise. Keep it JSON-free: no braces, no
 * quotes, no copy button.
 */

type MappingLine = {
  id?: string
  erpField?: string
  zidField?: string
  staticValue?: string | string[] | number | boolean | null
  policy?: string
  matchOperator?: string
  fuzzyMatchMappings?: Array<{ erpField?: string; platformField?: string }>
  inlineMatch?: { erpField?: string; platformField?: string }
  inlineSubMapping?: {
    relation?: string
    lines?: Array<{ erpField?: string; zidField?: string; staticValue?: string }>
  }
}

type MappingSettings = {
  relations?: Array<{ sourceModel?: string; targetModel?: string; relation?: string }>
  payloadPaths?: Record<string, string>
  variantOdooMatchField?: string
  variantZidMatchField?: string
  addShippingAsLine?: boolean
  shippingProductSku?: string
  shippingProductId?: string
  addDiscountAsLine?: boolean
  discountProductSku?: string
  discountProductId?: string
  discountMode?: string
}

const POLICY_LABELS: Record<string, { ar: string; en: string }> = {
  create: { ar: 'إنشاء السجل', en: 'Create record' },
  default: { ar: 'قيمة افتراضية', en: 'Default value' },
  block: { ar: 'منع المزامنة', en: 'Block sync' },
  none: { ar: 'بدون', en: 'None' },
}

function displayValue(value: MappingLine['staticValue'], ar: boolean): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join('، ') : '—'
  if (typeof value === 'boolean') return value ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')
  return String(value)
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
      {children}
    </span>
  )
}

function Field({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn('mt-1 break-all text-xs text-foreground', mono && 'font-mono')}>{children}</div>
    </div>
  )
}

export function MappingFieldsCard({
  mappings,
  ar,
}: {
  mappings: unknown
  ar: boolean
}) {
  // Some rows store the payload as a JSON string rather than jsonb — parse it
  // instead of showing an empty card, but never throw on malformed data.
  let parsed: unknown = mappings
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = {}
    }
  }
  const raw = (parsed ?? {}) as Record<string, unknown>
  const settings = (raw.__settings ?? {}) as MappingSettings

  const modelKeys = Object.keys(raw).filter(key => key !== '__settings')
  // Primary model first, then the related ones in their saved order.
  const models = modelKeys.map(key => ({
    model: key,
    lines: (Array.isArray(raw[key]) ? (raw[key] as MappingLine[]) : []).filter(
      line => line && (line.erpField || line.zidField || line.staticValue)
    ),
  }))
  const totalFields = models.reduce((sum, m) => sum + m.lines.length, 0)

  const payloadPaths = Object.entries(settings.payloadPaths || {}).filter(([, path]) => !!path)
  const relations = (settings.relations || []).filter(r => r && (r.sourceModel || r.targetModel))

  const advanceRows: Array<{ label: string; value: React.ReactNode }> = []
  if (settings.variantOdooMatchField || settings.variantZidMatchField) {
    advanceRows.push({
      label: ar ? 'مطابقة المتغيّرات' : 'Variant match',
      value: (
        <span className="font-mono">
          {settings.variantZidMatchField || '—'} → {settings.variantOdooMatchField || '—'}
        </span>
      ),
    })
  }
  if (relations.length > 0) {
    advanceRows.push({
      label: ar ? 'العلاقات بين النماذج' : 'Model relations',
      value: (
        <ul className="space-y-0.5">
          {relations.map((relation, index) => (
            <li key={index} className="font-mono text-[11px]">
              {relation.sourceModel || '—'} → {relation.targetModel || '—'}
            </li>
          ))}
        </ul>
      ),
    })
  }
  if (payloadPaths.length > 0) {
    advanceRows.push({
      label: ar ? 'مسارات الحقول داخل الطلب' : 'Payload paths',
      value: (
        <ul className="space-y-0.5">
          {payloadPaths.map(([model, path]) => (
            <li key={model} className="text-[11px]">
              <span className="font-mono text-foreground">{model}</span>
              <span className="text-muted-foreground"> : </span>
              <span className="font-mono">{path}</span>
            </li>
          ))}
        </ul>
      ),
    })
  }
  if (settings.addShippingAsLine) {
    advanceRows.push({
      label: ar ? 'الشحن كبند في الطلب' : 'Shipping as order line',
      value: <Chip>{settings.shippingProductSku || settings.shippingProductId || (ar ? 'مفعّل' : 'Enabled')}</Chip>,
    })
  }
  if (settings.addDiscountAsLine) {
    advanceRows.push({
      label: ar ? 'الخصم كبند في الطلب' : 'Discount as order line',
      value: (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Chip>{settings.discountProductSku || settings.discountProductId || (ar ? 'مفعّل' : 'Enabled')}</Chip>
          {settings.discountMode && (
            <Chip>
              {settings.discountMode === 'percent'
                ? (ar ? 'نسبة مئوية' : 'Percent')
                : (ar ? 'مبلغ ثابت' : 'Fixed')}
            </Chip>
          )}
        </span>
      ),
    })
  }

  return (
    <div className="space-y-4">
      {/* Mapping lines — one table per Odoo model. */}
      <div className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-foreground/80">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            {ar ? 'الحقول المربوطة' : 'Mapped fields'}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {ar
              ? `${totalFields} حقل · ${models.length} نموذج`
              : `${totalFields} fields · ${models.length} models`}
          </span>
        </div>

        {models.length === 0 || totalFields === 0 ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            {ar ? 'لا توجد حقول مربوطة بعد.' : 'No mapped fields yet.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {models.map(({ model, lines }) => (
              <div key={model}>
                <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-1.5">
                  <span className="break-all font-mono text-[11px] font-bold text-foreground">{model}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                    {ar ? `${lines.length} حقل` : `${lines.length} fields`}
                  </span>
                </div>

                {lines.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    {ar ? 'لا حقول لهذا النموذج.' : 'No fields for this model.'}
                  </div>
                ) : (
                  <table className="w-full table-fixed text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-foreground/60">
                        <th className="w-[34%] px-3 py-1.5 text-start font-bold">
                          {ar ? 'حقل ERP' : 'ERP field'}
                        </th>
                        <th className="w-[30%] px-3 py-1.5 text-start font-bold">
                          {ar ? 'حقل المتجر' : 'Store field'}
                        </th>
                        <th className="w-[20%] px-3 py-1.5 text-start font-bold">
                          {ar ? 'قيمة ثابتة' : 'Static value'}
                        </th>
                        <th className="w-[16%] px-3 py-1.5 text-start font-bold">
                          {ar ? 'السياسة' : 'Policy'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const policy = line.policy ? POLICY_LABELS[line.policy] : undefined
                        const subLines = line.inlineSubMapping?.lines || []
                        return (
                          <tr
                            key={line.id || `${model}-${index}`}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/30"
                          >
                            <td className="px-3 py-1.5 align-top">
                              <span className="break-all font-mono text-[11px] text-foreground">
                                {line.erpField || '—'}
                              </span>
                              {line.inlineMatch?.erpField && (
                                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                  {ar ? 'مطابقة' : 'match'}: {line.inlineMatch.platformField || '—'} →{' '}
                                  {line.inlineMatch.erpField}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 align-top">
                              <span className="break-all font-mono text-[11px] text-foreground">
                                {line.zidField || '—'}
                              </span>
                              {subLines.length > 0 && (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                  {ar
                                    ? `حقول داخلية (${line.inlineSubMapping?.relation || ''}): ${subLines.length}`
                                    : `Inline fields (${line.inlineSubMapping?.relation || ''}): ${subLines.length}`}
                                </span>
                              )}
                              {(line.fuzzyMatchMappings?.length || 0) > 0 && (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                  {ar
                                    ? `${line.fuzzyMatchMappings!.length} مطابقة إضافية`
                                    : `${line.fuzzyMatchMappings!.length} extra match`}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 align-top">
                              <span className="break-all font-mono text-[11px] text-muted-foreground">
                                {displayValue(line.staticValue, ar)}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 align-top">
                              {policy ? <Chip>{ar ? policy.ar : policy.en}</Chip> : (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced settings — labelled values, never raw JSON. */}
      {advanceRows.length > 0 && (
        <div className="border border-border bg-card">
          <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold text-foreground/80">
              {ar ? 'إعدادات إضافية' : 'Additional settings'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-3 sm:grid-cols-2 md:grid-cols-3">
            {advanceRows.map(row => (
              <Field key={row.label} label={row.label}>
                {row.value}
              </Field>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
