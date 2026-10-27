'use client'

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  History,
  Layers,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { deleteFieldMapping } from '@/app/actions/field-mappings'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { SALLA_EVENTS } from '@/lib/platforms/salla/fields'
import { SHOPIFY_EVENTS } from '@/lib/platforms/shopify/fields'
import { cn } from '@/lib/utils'

import FieldMappingForm from '../../field-mapping-form'
import SyncLogModal from '../../sync-log-modal'

interface DetailProps {
  mapping: any
  initialModels: Array<{ model: string; name: string }>
  preloadedModel: string
  preloadedFields: any[]
  allMappings: any[]
  hasOdooConnection: boolean
  erpType: string
  zidStores: { id: string; name: string | null }[]
  sallaStores: { id: string; name: string | null }[]
  shopifyStores: { id: string; name: string | null }[]
  defaultStoreKey: string
}

function InfoField({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn('mt-1 break-all text-xs text-foreground', mono && 'font-mono')}>{children}</div>
    </div>
  )
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function MappingDetailClient({
  mapping,
  initialModels,
  preloadedModel,
  preloadedFields,
  allMappings,
  hasOdooConnection,
  erpType,
  zidStores,
  sallaStores,
  shopifyStores,
  defaultStoreKey,
}: DetailProps) {
  const { lang, dir } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const { toast } = useToast()

  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft

  const platform = (() => {
    const action = String(mapping.action || '')
    if (action.includes('/') || action.startsWith('shopify:')) return 'shopify'
    if (SALLA_EVENTS.find((e: any) => e.id === action)) return 'salla'
    if (SHOPIFY_EVENTS.find((e: any) => e.id === action)) return 'shopify'
    return 'zid'
  })()

  const platformLabel = (p: string) =>
    p === 'shopify' ? (ar ? 'شوبيفاي' : 'Shopify')
      : p === 'salla' ? (ar ? 'سلة' : 'Salla')
      : (ar ? 'زد' : 'Zid')

  const operation = mapping.odoo_operation || 'create'
  const operationLabel =
    operation === 'delete' ? (ar ? 'حذف' : 'Delete')
      : operation === 'update' ? (ar ? 'تعديل' : 'Update')
      : (ar ? 'إنشاء' : 'Create')

  const directions = String(mapping.sync_direction || 'store_to_erp')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)

  const directionLabel = (d: string) =>
    d === 'erp_to_store' ? (ar ? 'من ERP للمتجر' : 'ERP → Store')
      : d === 'both' ? (ar ? 'كلا الاتجاهين' : 'Both directions')
      : (ar ? 'من المتجر لـ ERP' : 'Store → ERP')

  const modelKeys = Object.keys(mapping.mappings || {}).filter(k => k !== '__settings')
  const primaryModel = mapping.odoo_model
  const initialRelated = modelKeys.filter(k => k !== primaryModel)
  const jsonText = prettyJson(mapping.mappings)
  const mappedFieldCount = modelKeys.reduce((total, key) => {
    const arr = (mapping.mappings || {})[key]
    return total + (Array.isArray(arr) ? arr.length : 0)
  }, 0)

  const formatDate = (value: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString(ar ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const copy = async (value: string, kind: 'id' | 'json') => {
    try {
      await navigator.clipboard.writeText(value)
      if (kind === 'id') {
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 1500)
      } else {
        setCopiedJson(true)
        setTimeout(() => setCopiedJson(false), 1500)
      }
    } catch {
      toast({
        title: ar ? 'تعذر النسخ' : 'Copy failed',
        description: ar ? 'المتصفح منع الوصول إلى الحافظة.' : 'The browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await deleteFieldMapping(mapping.id)
      if (res.success) {
        toast({
          title: ar ? 'تم الحذف' : 'Deleted',
          description: ar ? 'تم حذف الربط بنجاح.' : 'The mapping was deleted.',
        })
        router.push('/app/mapping-center/custom')
        router.refresh()
      } else {
        toast({
          title: ar ? 'فشل الحذف' : 'Delete failed',
          description: res.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } finally {
      setIsDeleting(false)
      setConfirmOpen(false)
    }
  }

  if (isEditing) {
    return (
      <div className="space-y-4" dir={dir}>
        <Button
          variant="ghost"
          onClick={() => setIsEditing(false)}
          className="mb-2 gap-1.5 rounded-none px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <BackIcon className="h-4 w-4" />
          {ar ? 'العودة للتفاصيل' : 'Back to details'}
        </Button>
        <FieldMappingForm
          initialModels={initialModels}
          hasOdooConnection={hasOdooConnection}
          erpType={erpType}
          preloadedModel={preloadedModel}
          preloadedFields={preloadedFields}
          isZidConnected={zidStores.length > 0}
          isSallaConnected={sallaStores.length > 0}
          isShopifyConnected={shopifyStores.length > 0}
          editingId={mapping.id}
          initialName={mapping.name}
          initialAction={mapping.action}
          initialOdooModel={mapping.odoo_model}
          initialOdooOperation={mapping.odoo_operation || 'create'}
          initialOdooMatchField={mapping.odoo_match_field || ''}
          initialZidMatchField={mapping.zid_match_field || ''}
          initialOdooFallbackPolicy={mapping.odoo_fallback_policy || 'none'}
          initialOdooVariantSyncMode={mapping.variant_sync_mode || 'AS_VARIANTS'}
          initialOdooVariantOdooMatchField={mapping.variant_odoo_match_field || ''}
          initialOdooVariantZidMatchField={mapping.variant_zid_match_field || ''}
          initialMappings={mapping.mappings}
          initialRelatedModels={initialRelated}
          initialSyncDirection={mapping.sync_direction || 'store_to_erp'}
          initialStoreKey={mapping.merchant_id || defaultStoreKey}
          zidStores={zidStores}
          sallaStores={sallaStores}
          shopifyStores={shopifyStores}
          allMappings={allMappings}
          onCancel={() => setIsEditing(false)}
          onSuccess={() => {
            setIsEditing(false)
            router.refresh()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb — the mapping id is the URL segment, so each record is its own page. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/app/mapping-center/custom"
          className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى تخصيص الربط' : 'Back to custom mapping'}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="font-mono text-foreground/70">{String(mapping.id).slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-foreground">
              {mapping.name || (ar ? 'ربط غير مسمى' : 'Unnamed mapping')}
            </h1>
            <span className="inline-flex items-center gap-1 border border-border/70 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {platformLabel(platform)}
            </span>
            <span className="inline-flex items-center gap-1 border border-border/70 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {operationLabel}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="break-all font-mono text-[11px] text-muted-foreground">{mapping.id}</span>
            <button
              type="button"
              onClick={() => copy(String(mapping.id), 'id')}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={ar ? 'نسخ المعرّف' : 'Copy id'}
            >
              {copiedId ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsLogOpen(true)}
            className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
          >
            <History className="h-3.5 w-3.5" />
            {ar ? 'سجل المزامنة' : 'Sync Log'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEditing(true)}
            className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
          >
            <Pencil className="h-3.5 w-3.5" />
            {ar ? 'تعديل' : 'Edit'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={isDeleting}
            className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold text-destructive hover:text-destructive"
          >
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {ar ? 'حذف' : 'Delete'}
          </Button>
        </div>
      </div>

      {/* Basic record data */}
      <div className="border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <InfoField label={ar ? 'الحدث' : 'Event'} mono>{mapping.action || '—'}</InfoField>
          <InfoField label={ar ? 'نموذج ERP' : 'ERP Model'} mono>{mapping.odoo_model || '—'}</InfoField>
          <InfoField label={ar ? 'العملية' : 'Operation'}>{operationLabel}</InfoField>
          <InfoField label={ar ? 'الاتجاه' : 'Direction'}>
            <span className="inline-flex flex-wrap gap-1">
              {directions.map(d => (
                <span key={d} className="border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {directionLabel(d)}
                </span>
              ))}
            </span>
          </InfoField>
          <InfoField label={ar ? 'حقل المطابقة في ERP' : 'ERP match field'} mono>{mapping.odoo_match_field || '—'}</InfoField>
          <InfoField label={ar ? 'حقل المطابقة في المتجر' : 'Store match field'} mono>{mapping.zid_match_field || '—'}</InfoField>
          <InfoField label={ar ? 'سياسة الغياب' : 'Fallback policy'} mono>{mapping.odoo_fallback_policy || '—'}</InfoField>
          <InfoField label={ar ? 'الحقول المربوطة' : 'Mapped fields'}>
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              {mappedFieldCount}
            </span>
          </InfoField>
          <InfoField label={ar ? 'معرّف المتجر' : 'Store key'} mono>{mapping.merchant_id || '—'}</InfoField>
          <InfoField label={ar ? 'معرّف المتجر في ERP' : 'ERP store id'} mono>{mapping.store_id || '—'}</InfoField>
          <InfoField label={ar ? 'تاريخ الإنشاء' : 'Created'}>{formatDate(mapping.created_at)}</InfoField>
          <InfoField label={ar ? 'آخر تحديث' : 'Updated'}>{formatDate(mapping.updated_at)}</InfoField>
        </div>
      </div>

      {(mapping.odoo_webhook_id || mapping.odoo_server_action_id) && (
        <div className="flex items-start gap-2 border border-border bg-muted p-3 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-bold">{ar ? 'ربط أودو التلقائي' : 'Odoo automation'}</div>
            <div className="font-mono text-[11px]">
              webhook: {mapping.odoo_webhook_id || '—'} · action: {mapping.odoo_server_action_id || '—'}
            </div>
          </div>
        </div>
      )}

      {/* Mappings JSON — rendered only on this record page, never in the list. */}
      <div className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
          <span className="text-[10px] font-bold text-muted-foreground">{ar ? 'مخطط الحقول' : 'Field map'}</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-muted-foreground">JSON</span>
            {jsonText && (
              <button
                type="button"
                onClick={() => copy(jsonText, 'json')}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                {copiedJson ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                {copiedJson ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ' : 'Copy')}
              </button>
            )}
          </div>
        </div>
        {jsonText ? (
          <pre className="max-h-[520px] overflow-auto bg-card p-3 text-[10px] font-mono leading-relaxed text-foreground">
            {jsonText}
          </pre>
        ) : (
          <div className="py-6 text-center text-[11px] text-muted-foreground">
            {ar ? 'لا توجد حقول مربوطة بعد.' : 'No mapped fields yet.'}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={ar ? 'حذف الربط' : 'Delete Mapping'}
        description={ar
          ? 'هل أنت متأكد من حذف هذا الربط؟ لا يمكن التراجع عن هذا الإجراء.'
          : 'Are you sure you want to delete this mapping? This action cannot be undone.'}
        confirmText={ar ? 'حذف' : 'Delete'}
        cancelText={ar ? 'إلغاء' : 'Cancel'}
        variant="destructive"
        onConfirm={handleDelete}
      />

      <SyncLogModal
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={mapping.id}
        mappingName={mapping.name}
        mappingsList={allMappings.map(m => ({ id: m.id, name: m.name }))}
      />
    </div>
  )
}