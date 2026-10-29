'use client'

import {
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Search,
  Table2,
  X,
} from 'lucide-react'
import React, { useMemo, useState } from 'react'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Check if value is a plain JavaScript object */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/** Check if array consists of objects (tabular data) */
function isArrayOfObjects(val: unknown): val is Array<Record<string, unknown>> {
  return Array.isArray(val) && val.length > 0 && val.every((item) => isPlainObject(item))
}

/** Check if a string is an ISO date */
function isIsoDateString(val: string): boolean {
  if (typeof val !== 'string' || val.length < 10) return false
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(val) && !Number.isNaN(Date.parse(val))
}

/** Check if string is a web URL */
function isUrlString(val: string): boolean {
  if (typeof val !== 'string') return false
  return val.startsWith('http://') || val.startsWith('https://')
}

/** Check if string looks like an image URL */
function isImageUrl(val: string): boolean {
  if (!isUrlString(val)) return false
  return /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i.test(val)
}

/** Humanize any JSON key into readable title */
function humanizeKey(key: string): string {
  if (!key) return ''
  // If it's a technical model like 'res.partner' or '__settings'
  if (key.startsWith('__')) {
    return key.replace(/^__/, 'Settings: ')
  }
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** Render status pill for common state/status strings */
function renderStatusPill(status: string) {
  const s = status.toLowerCase()
  const isGreen = /delivered|completed|paid|success|active|done|true|تم|مكتمل|مدفوع|ناجح/.test(s)
  const isYellow = /preparing|processing|pending|ready|draft|in_progress|wait|قيد|انتظار|جاهز/.test(s)
  const isRed = /failed|cancelled|reversed|canceled|refunded|error|false|ملغي|مسترجع|فاشل|خطأ/.test(s)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-bold tracking-tight',
        isGreen && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        isYellow && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        isRed && 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
        !isGreen && !isYellow && !isRed && 'border-border bg-muted/60 text-foreground'
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  )
}

/** Single Field item rendered like top header InfoField (no surrounding card box) */
function FieldItem({
  keyName,
  value,
  lang,
  onCopy,
}: {
  keyName: string
  value: unknown
  lang: 'ar' | 'en'
  onCopy: (val: string) => void
}) {
  const ar = lang === 'ar'
  const label = humanizeKey(keyName)
  const [copied, setCopied] = useState(false)

  let displayNode: React.ReactNode = null
  let isMono = false

  if (value === null || value === undefined || value === '') {
    displayNode = <span className="text-muted-foreground/40">—</span>
  } else if (typeof value === 'boolean') {
    displayNode = (
      <span
        className={cn(
          'inline-flex items-center rounded-sm border px-1.5 py-0.2 text-[10px] font-bold',
          value
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'border-muted-foreground/20 bg-muted text-muted-foreground'
        )}
      >
        {value ? (ar ? 'نعم (True)' : 'True') : (ar ? 'لا (False)' : 'False')}
      </span>
    )
  } else if (typeof value === 'string' && isIsoDateString(value)) {
    isMono = true
    const d = new Date(value)
    displayNode = (
      <span title={value}>
        {d.toLocaleString(ar ? 'ar-EG' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    )
  } else if (typeof value === 'string' && isImageUrl(value)) {
    displayNode = (
      <div className="flex items-center gap-1.5">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative inline-block overflow-hidden rounded border border-border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="h-6 w-6 object-cover" />
        </a>
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          {ar ? 'معاينة' : 'View'}
        </a>
      </div>
    )
  } else if (typeof value === 'string' && isUrlString(value)) {
    displayNode = (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
      >
        <span className="truncate">{value}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    )
  } else if (
    typeof value === 'string' &&
    /status|state|type|policy/i.test(keyName) &&
    value.length < 25
  ) {
    displayNode = renderStatusPill(value)
  } else if (typeof value === 'number') {
    isMono = true
    displayNode = <span>{value.toLocaleString('en-US')}</span>
  } else {
    if (/id|code|sku|barcode|ref|key/i.test(keyName)) {
      isMono = true
    }
    displayNode = <span>{String(value)}</span>
  }

  const copyableStr = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')

  return (
    <div className="group min-w-0">
      <div className="flex items-center gap-1">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {keyName !== label.toLowerCase() && (
          <span className="hidden truncate font-mono text-[9px] text-muted-foreground/40 xl:inline" title={keyName}>
            ({keyName})
          </span>
        )}
      </div>
      <div className={cn('mt-1 flex items-center gap-1.5 text-xs text-foreground break-all', isMono && 'font-mono')}>
        <div className="min-w-0">{displayNode}</div>
        {value !== null && value !== undefined && value !== '' && (
          <button
            type="button"
            onClick={() => {
              onCopy(copyableStr)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
            className="shrink-0 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            title={ar ? 'نسخ' : 'Copy'}
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
      </div>
    </div>
  )
}

/** Array of objects rendered as an Interactive Universal HTML Table */
function ObjectsTable({
  title,
  data,
  lang,
  onCopy,
  forceExpand,
}: {
  title: string
  data: Array<Record<string, unknown>>
  lang: 'ar' | 'en'
  onCopy: (val: string) => void
  forceExpand?: boolean
}) {
  const ar = lang === 'ar'
  const [isExpanded, setIsExpanded] = useState(true)

  // Sync with global expand/collapse if changed
  React.useEffect(() => {
    if (typeof forceExpand === 'boolean') {
      setIsExpanded(forceExpand)
    }
  }, [forceExpand])

  // Collect all unique keys present across all rows in this array
  const columns = useMemo(() => {
    const keySet = new Set<string>()
    data.forEach((item) => {
      if (isPlainObject(item)) {
        Object.keys(item).forEach((k) => keySet.add(k))
      }
    })
    return Array.from(keySet)
  }, [data])

  if (data.length === 0) return null

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card">
      {/* Table Section Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground transition-colors hover:text-primary"
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Table2 className="h-4 w-4 text-primary" />
            <span>{title}</span>
          </button>
          <span className="rounded-full bg-primary/10 px-2 py-0.2 text-[10px] font-bold text-primary">
            {data.length} {ar ? 'صفوف' : 'rows'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(JSON.stringify(data, null, 2))}
            className="h-6 gap-1 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
            {ar ? 'نسخ الجدول' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Table Content */}
      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs text-foreground rtl:text-right">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-10 px-3 py-2 text-center text-[10px] font-bold text-muted-foreground">#</th>
                {columns.map((col) => (
                  <th key={col} className="px-3 py-2 text-[10px] font-bold text-muted-foreground whitespace-nowrap">
                    <div className="flex flex-col">
                      <span>{humanizeKey(col)}</span>
                      <span className="font-mono text-[8px] opacity-50">{col}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.map((row, idx) => (
                <tr key={idx} className="transition-colors hover:bg-muted/40">
                  <td className="px-3 py-2 text-center font-mono text-[10px] text-muted-foreground">{idx + 1}</td>
                  {columns.map((col) => {
                    const val = row[col]

                    // Render image
                    if (typeof val === 'string' && isImageUrl(val)) {
                      return (
                        <td key={col} className="px-3 py-2 whitespace-nowrap">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={val} alt="" className="h-7 w-7 rounded border border-border object-cover" />
                        </td>
                      )
                    }

                    // Render status pill
                    if (
                      typeof val === 'string' &&
                      /status|state|policy|behavior/i.test(col) &&
                      val.length < 25
                    ) {
                      return (
                        <td key={col} className="px-3 py-2 whitespace-nowrap">
                          {renderStatusPill(val)}
                        </td>
                      )
                    }

                    // Render booleans
                    if (typeof val === 'boolean') {
                      return (
                        <td key={col} className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={cn(
                              'inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-bold',
                              val
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {val ? (ar ? 'نعم' : 'True') : (ar ? 'لا' : 'False')}
                          </span>
                        </td>
                      )
                    }

                    // Render sub-object within cell
                    if (isPlainObject(val)) {
                      return (
                        <td key={col} className="px-3 py-2">
                          <span
                            className="inline-block max-w-[200px] truncate rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                            title={JSON.stringify(val)}
                          >
                            {Object.entries(val)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(', ')}
                          </span>
                        </td>
                      )
                    }

                    // Render sub-array within cell
                    if (Array.isArray(val)) {
                      return (
                        <td key={col} className="px-3 py-2">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            [{val.length} {ar ? 'عناصر' : 'items'}]
                          </span>
                        </td>
                      )
                    }

                    return (
                      <td key={col} className="px-3 py-2 whitespace-nowrap">
                        {val !== null && val !== undefined && val !== '' ? (
                          <span className={cn(typeof val === 'number' && 'font-mono font-medium')}>{String(val)}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Recursive Universal Section for any Object Node in the JSON tree */
function UniversalSectionNode({
  nodeKey,
  data,
  lang,
  onCopy,
  searchQuery,
  forceExpand,
  isRoot = false,
}: {
  nodeKey: string
  data: Record<string, unknown>
  lang: 'ar' | 'en'
  onCopy: (val: string) => void
  searchQuery: string
  forceExpand?: boolean
  isRoot?: boolean
}) {
  const ar = lang === 'ar'
  const [isExpanded, setIsExpanded] = useState(true)

  React.useEffect(() => {
    if (typeof forceExpand === 'boolean') {
      setIsExpanded(forceExpand)
    }
  }, [forceExpand])

  const label = humanizeKey(nodeKey)

  // Categorize entries of this object
  const { scalars, tables, primitiveArrays, nestedObjects } = useMemo(() => {
    const s: Record<string, unknown> = {}
    const t: Record<string, Array<Record<string, unknown>>> = {}
    const p: Record<string, unknown[]> = {}
    const n: Record<string, Record<string, unknown>> = {}

    const query = searchQuery.trim().toLowerCase()

    Object.entries(data).forEach(([key, val]) => {
      // Filter if search query exists
      if (query) {
        const matchKey = key.toLowerCase().includes(query)
        const matchLabel = humanizeKey(key).toLowerCase().includes(query)
        const matchVal = JSON.stringify(val).toLowerCase().includes(query)
        if (!matchKey && !matchLabel && !matchVal) return
      }

      if (isArrayOfObjects(val)) {
        t[key] = val
      } else if (Array.isArray(val)) {
        p[key] = val
      } else if (isPlainObject(val)) {
        n[key] = val
      } else {
        s[key] = val
      }
    })

    return { scalars: s, tables: t, primitiveArrays: p, nestedObjects: n }
  }, [data, searchQuery])

  const totalProperties = Object.keys(data).length
  if (totalProperties === 0) return null

  // If search resulted in 0 items for this section
  if (
    searchQuery &&
    Object.keys(scalars).length === 0 &&
    Object.keys(tables).length === 0 &&
    Object.keys(primitiveArrays).length === 0 &&
    Object.keys(nestedObjects).length === 0
  ) {
    return null
  }

  // Root container styling vs nested section card
  if (isRoot) {
    return (
      <div className="space-y-4">
        {/* Scalar Fields Grid — 4 columns like the top basic record data header */}
        {Object.keys(scalars).length > 0 && (
          <div className="border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {Object.entries(scalars).map(([k, v]) => (
                <FieldItem key={k} keyName={k} value={v} lang={lang} onCopy={onCopy} />
              ))}
            </div>
          </div>
        )}

        {/* Arrays of primitives (Tags/Lists) */}
        {Object.entries(primitiveArrays).map(([k, arr]) => (
          <div key={k} className="border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {humanizeKey(k)}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/50">({k})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {arr.map((item, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground"
                >
                  {String(item)}
                </span>
              ))}
            </div>
          </div>
        ))}

        {/* Tabular Data (Arrays of Objects) */}
        {Object.entries(tables).map(([k, arr]) => (
          <ObjectsTable
            key={k}
            title={humanizeKey(k)}
            data={arr}
            lang={lang}
            onCopy={onCopy}
            forceExpand={forceExpand}
          />
        ))}

        {/* Nested Objects */}
        {Object.entries(nestedObjects).map(([k, obj]) => (
          <UniversalSectionNode
            key={k}
            nodeKey={k}
            data={obj}
            lang={lang}
            onCopy={onCopy}
            searchQuery={searchQuery}
            forceExpand={forceExpand}
            isRoot={false}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card">
      {/* Section Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-xs font-bold text-foreground transition-colors hover:text-primary"
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Layers className="h-4 w-4 text-primary" />
          <span>{label}</span>
          <span className="font-mono text-[9px] text-muted-foreground/60">({nodeKey})</span>
        </button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(JSON.stringify(data, null, 2))}
            className="h-6 gap-1 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
            {ar ? 'نسخ' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Section Body */}
      {isExpanded && (
        <div className="space-y-4 p-3">
          {/* Scalar fields inside this section — 4 columns like top header */}
          {Object.keys(scalars).length > 0 && (
            <div className="border border-border/70 bg-card p-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Object.entries(scalars).map(([k, v]) => (
                  <FieldItem key={k} keyName={k} value={v} lang={lang} onCopy={onCopy} />
                ))}
              </div>
            </div>
          )}

          {/* Arrays of primitives inside this section */}
          {Object.entries(primitiveArrays).map(([k, arr]) => (
            <div key={k} className="rounded-sm border border-border/80 bg-muted/20 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold text-muted-foreground">{humanizeKey(k)}</span>
                <span className="font-mono text-[8px] text-muted-foreground/50">({k})</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {arr.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground"
                  >
                    {String(item)}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* Sub-tables */}
          {Object.entries(tables).map(([k, arr]) => (
            <ObjectsTable
              key={k}
              title={humanizeKey(k)}
              data={arr}
              lang={lang}
              onCopy={onCopy}
              forceExpand={forceExpand}
            />
          ))}

          {/* Deeper Nested Objects */}
          {Object.entries(nestedObjects).map(([k, obj]) => (
            <UniversalSectionNode
              key={k}
              nodeKey={k}
              data={obj}
              lang={lang}
              onCopy={onCopy}
              searchQuery={searchQuery}
              forceExpand={forceExpand}
              isRoot={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export interface PayloadViewerProps {
  payload: unknown
  platform?: string | null
  event?: string | null
}

/**
 * Universal JSON Visualizer & Reader
 * Converts ANY arbitrary JSON into clean, intuitive, readable UI:
 * - Primitive fields -> Key-value cards with formatting and copy
 * - Arrays of objects -> Full responsive HTML Tables with dynamic columns
 * - Primitive arrays -> Tag pills
 * - Nested objects -> Collapsible structured Section Cards
 * - Raw JSON tab with full code and one-click copy
 */
export function PayloadViewer({ payload, platform }: PayloadViewerProps) {
  const { lang } = useLanguage()
  const ar = lang === 'ar'

  const [activeTab, setActiveTab] = useState<'visual' | 'json'>('visual')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCopied, setIsCopied] = useState(false)
  const [forceExpand, setForceExpand] = useState<boolean | undefined>(undefined)

  // Safely parse JSON payload
  const parsed = useMemo(() => {
    if (payload === null || payload === undefined) return null
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload)
      } catch {
        return payload
      }
    }
    return payload
  }, [payload])

  const payloadJson = useMemo(() => {
    if (parsed === null || parsed === undefined) return ''
    if (typeof parsed === 'string') return parsed
    try {
      return JSON.stringify(parsed, null, 2)
    } catch {
      return String(parsed)
    }
  }, [parsed])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const platformBadge = useMemo(() => {
    if (platform === 'salla') return 'Salla'
    if (platform === 'shopify') return 'Shopify'
    if (platform === 'zid') return 'Zid'
    if (platform === 'odoo') return 'Odoo'
    return 'Payload'
  }, [platform])

  const isEmpty = !parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-card">
      {/* ── Top Bar with Tabs & Controls ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Platform Label */}
          <span className="text-[10px] font-bold text-muted-foreground">
            {ar ? `بيانات المزامنة (${platformBadge})` : `Payload Data (${platformBadge})`}
          </span>

          {/* Visual / JSON Tabs */}
          <div className="flex items-center rounded-sm border border-border bg-card/60 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-[11px] font-semibold transition-all',
                activeTab === 'visual'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {ar ? 'خانات وجداول مرئية' : 'Visual Fields & Tables'}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-[11px] font-semibold transition-all',
                activeTab === 'json'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Code className="h-3.5 w-3.5" />
              {ar ? 'كود JSON' : 'Raw JSON'}
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {activeTab === 'visual' && !isEmpty && (
            <>
              {/* Expand / Collapse All Toggle */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForceExpand((prev) => (prev === true ? false : true))}
                className="h-7 gap-1 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                title={ar ? 'توسيع أو طي كافة الأقسام' : 'Expand or collapse all'}
              >
                {forceExpand === false ? (
                  <>
                    <Maximize2 className="h-3 w-3" />
                    <span>{ar ? 'توسيع الكل' : 'Expand All'}</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="h-3 w-3" />
                    <span>{ar ? 'طي الكل' : 'Collapse All'}</span>
                  </>
                )}
              </Button>

              {/* Search Filter */}
              <div className="relative flex items-center">
                <Search className="absolute right-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none rtl:right-2.5 rtl:left-auto ltr:left-2.5 ltr:right-auto" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={ar ? 'بحث في الحقول والجداول...' : 'Filter fields & tables...'}
                  className="h-7 w-40 rounded-sm border border-border bg-card pr-8 pl-6 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary rtl:pr-8 rtl:pl-6 ltr:pl-8 ltr:pr-6 md:w-56"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2 text-muted-foreground hover:text-foreground rtl:left-2 rtl:right-auto ltr:right-2 ltr:left-auto"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </>
          )}

          {/* Copy JSON Button */}
          {payloadJson && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(payloadJson)}
              className="h-7 gap-1 px-2.5 text-[10px] font-bold"
            >
              {isCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              {isCopied ? (ar ? 'تم النسخ' : 'Copied') : ar ? 'نسخ JSON' : 'Copy JSON'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Visual Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'visual' && (
        <div className="p-3">
          {isEmpty ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {ar ? 'لا توجد بيانات متاحة في هذا السجل.' : 'No payload data available in this log.'}
            </div>
          ) : isPlainObject(parsed) ? (
            <UniversalSectionNode
              nodeKey="root"
              data={parsed}
              lang={lang}
              onCopy={copyToClipboard}
              searchQuery={searchQuery}
              forceExpand={forceExpand}
              isRoot={true}
            />
          ) : Array.isArray(parsed) ? (
            <div className="space-y-3">
              {isArrayOfObjects(parsed) ? (
                <ObjectsTable
                  title={ar ? 'قائمة السجلات (Records)' : 'Records List'}
                  data={parsed}
                  lang={lang}
                  onCopy={copyToClipboard}
                  forceExpand={forceExpand}
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {parsed.map((item, idx) => (
                    <span key={idx} className="rounded border border-border bg-muted px-2 py-1 text-xs">
                      {String(item)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded border border-border bg-card p-3 font-mono text-xs">
              {String(parsed)}
            </div>
          )}
        </div>
      )}

      {/* ── Raw JSON Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'json' && (
        <div className="relative">
          {payloadJson ? (
            <pre className="max-h-[550px] overflow-auto bg-card p-4 font-mono text-[11px] leading-relaxed text-foreground select-text">
              {payloadJson}
            </pre>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {ar ? 'لا توجد بيانات JSON.' : 'No JSON payload available.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
