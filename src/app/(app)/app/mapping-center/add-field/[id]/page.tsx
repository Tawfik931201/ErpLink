import { ArrowLeft, ArrowRight, FileQuestion } from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getCustomOdooFields } from '@/app/actions/custom-fields'
import { getCustomErpNextFields } from '@/app/actions/custom-fields-erpnext'
import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { resolveLanguage } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'حقل مخصص — مركز الربط — ErpLink',
  description: 'تفاصيل حقل مخصص',
}

/**
 * A custom field is a record, so it gets its own page keyed by its id — the same
 * shape as `/app/logs/<id>` and `/app/mapping-center/custom/<id>`.
 *
 * Read-only on purpose: creating a field is the only write the Add Field screen
 * offers, so there is no edit or delete action here. Everything the merchant
 * created is shown as ordinary labelled values, never as raw JSON.
 */

type CustomField = {
  id?: string | number
  odoo_field_id?: number
  field_name?: string
  field_label?: string
  odoo_model?: string
  field_type?: string
  views?: string
  created_at?: string
  properties?: {
    readonly?: boolean
    required?: boolean
    copy?: boolean
    help?: string
    relation?: string
    selection_options?: Array<{ key?: string; label?: string }>
    group_ids?: Array<number | string>
  }
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      {children}
    </span>
  )
}

const TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  char: { ar: 'نص قصير', en: 'Short text' },
  text: { ar: 'نص طويل', en: 'Long text' },
  integer: { ar: 'عدد صحيح', en: 'Whole number' },
  float: { ar: 'عدد عشري', en: 'Decimal number' },
  boolean: { ar: 'نعم / لا', en: 'Yes / No' },
  date: { ar: 'تاريخ', en: 'Date' },
  datetime: { ar: 'تاريخ ووقت', en: 'Date & time' },
  many2one: { ar: 'ارتباط بسجل', en: 'Link to record' },
  selection: { ar: 'قائمة اختيارات', en: 'Dropdown list' },
  monetary: { ar: 'قيمة نقدية', en: 'Currency amount' },
}

export default async function CustomFieldDetailPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params
  const wantedId = decodeURIComponent(id)

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const ar = lang === 'ar'
  const BackIcon = ar ? ArrowRight : ArrowLeft

  const connRes = await getActiveWorkspaceErpConnection()
  const erpType = connRes.success && connRes.connection?.erp_type ? connRes.connection.erp_type : 'odoo'
  const erpName = erpType === 'erpnext' ? 'ERPNext' : (ar ? 'أودو' : 'Odoo')

  const fieldsRes = erpType === 'erpnext' ? await getCustomErpNextFields() : await getCustomOdooFields()
  const fields: CustomField[] = fieldsRes.success ? ((fieldsRes.fields || []) as CustomField[]) : []

  // The id in the URL is the row identity the list navigates with: the saved
  // row id for Odoo, `<DocType>-<fieldname>` for ERPNext, falling back to the
  // technical name when a row has no id at all.
  const field = fields.find(f => String(f.id || f.field_name || '') === wantedId)

  if (!field) {
    return (
      <div className="w-full max-w-[95%] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>
        <Link
          href="/app/mapping-center/add-field"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الحقول المخصصة' : 'Back to custom fields'}
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {ar ? 'الحقل غير موجود' : 'Field not found'}
          </p>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            {ar
              ? `قد يكون هذا الحقل قد حُذف من ${erpName}، أو أنه يخص مساحة عمل أخرى.`
              : `This field may have been deleted from ${erpName}, or it belongs to another workspace.`}
          </p>
        </div>
      </div>
    )
  }

  const fieldProps = field.properties || {}
  const typeLabel = field.field_type
    ? (TYPE_LABELS[field.field_type]?.[ar ? 'ar' : 'en'] || field.field_type)
    : '—'
  const selectionOptions = (fieldProps.selection_options || []).filter(o => o && (o.key || o.label))
  const groupIds = (fieldProps.group_ids || []).filter(g => g !== null && g !== undefined && String(g) !== '')
  const views = field.views || ''
  const viewsLabel =
    views === 'list' ? (ar ? 'شاشة القائمة' : 'List view')
      : views === 'both' ? (ar ? 'النموذج والقائمة' : 'Form and list')
      : views === 'form' ? (ar ? 'شاشة النموذج' : 'Form view')
      : (ar ? 'غير محدد' : 'Not set')

  const createdLabel = field.created_at
    ? new Date(field.created_at).toLocaleString(ar ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={ar ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <Link
            href="/app/mapping-center/add-field"
            className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <BackIcon className="h-3.5 w-3.5" />
            {ar ? 'العودة إلى الحقول المخصصة' : 'Back to custom fields'}
          </Link>
          <span className="text-muted-foreground/30">/</span>
          <span className="font-mono text-foreground/70">{String(field.field_name || wantedId)}</span>
        </div>

        {/* Header */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-foreground">
              {field.field_label || (ar ? 'حقل غير مسمى' : 'Untitled field')}
            </h1>
            <Chip>{typeLabel}</Chip>
            <Chip>{erpName}</Chip>
            {field.odoo_model && <Chip>{field.odoo_model}</Chip>}
          </div>
          <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            {field.field_name || '—'}
          </div>
        </div>

        {/* Record data */}
        <div className="border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoField label={ar ? 'الاسم الظاهر' : 'Display label'}>{field.field_label || '—'}</InfoField>
            <InfoField label={ar ? 'الاسم التقني' : 'Technical name'} mono>{field.field_name || '—'}</InfoField>
            <InfoField label={ar ? 'نوع الحقل' : 'Field type'}>
              {typeLabel}
              {field.field_type && (
                <span className="ms-1 font-mono text-[10px] text-muted-foreground">({field.field_type})</span>
              )}
            </InfoField>
            <InfoField label={erpType === 'erpnext' ? (ar ? 'نوع المستند' : 'DocType') : (ar ? 'نموذج ERP' : 'ERP model')} mono>
              {field.odoo_model || '—'}
            </InfoField>
            <InfoField label={ar ? 'يظهر في' : 'Appears in'}>{viewsLabel}</InfoField>
            <InfoField label={ar ? 'تاريخ الإنشاء' : 'Created'}>{createdLabel}</InfoField>
            <InfoField label={ar ? 'للقراءة فقط' : 'Read-only'}>{fieldProps.readonly ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')}</InfoField>
            <InfoField label={ar ? 'إلزامي' : 'Required'}>{fieldProps.required ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')}</InfoField>
            {erpType !== 'erpnext' && (
              <InfoField label={ar ? 'قابل للنسخ' : 'Copyable'}>{fieldProps.copy ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')}</InfoField>
            )}
            {field.field_type === 'many2one' && (
              <InfoField label={ar ? 'النموذج المرتبط' : 'Related model'} mono>{fieldProps.relation || '—'}</InfoField>
            )}
            {groupIds.length > 0 && (
              <InfoField label={ar ? 'المجموعات المصرح لها' : 'Security groups'}>
                <span className="inline-flex flex-wrap gap-1">
                  {groupIds.map(g => <Chip key={String(g)}>#{String(g)}</Chip>)}
                </span>
              </InfoField>
            )}
            <InfoField label={ar ? 'تلميح المساعدة' : 'Help text'}>
              {fieldProps.help || '—'}
            </InfoField>
          </div>

          {selectionOptions.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ar ? 'خيارات القائمة' : 'Selection options'}
              </p>
              <div className="mt-2 overflow-hidden border border-border">
                <table className="w-full text-start text-[11px]">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-2 py-1 text-start font-semibold text-muted-foreground">{ar ? 'المفتاح' : 'Key'}</th>
                      <th className="px-2 py-1 text-start font-semibold text-muted-foreground">{ar ? 'العنوان' : 'Label'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectionOptions.map((opt, i) => (
                      <tr key={`${opt.key || ''}-${i}`} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono text-foreground">{opt.key || '—'}</td>
                        <td className="px-2 py-1 text-foreground">{opt.label || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
