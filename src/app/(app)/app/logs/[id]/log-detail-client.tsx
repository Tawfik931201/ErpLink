'use client'

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  resolveLogManually,
  retrySyncLog,
  type SyncLogRow,
} from '@/app/actions/sync-logs'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import {
  eventEntity,
  getDeletionCountdown,
  SyncStatusBadge,
  SyncTriggerBadge,
} from '../log-ui'
import { PayloadViewer } from '../payload-viewer'

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

export default function LogDetailClient({ log }: { log: SyncLogRow }) {
  const { t, lang, dir } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const { toast } = useToast()

  const [isRetrying, setIsRetrying] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft
  const isResolvedManually = log.resolved_manually === true
  const errorMessage = log.error_message || ''

  const entityLabels: Record<string, string> = {
    product: t('log.entityProduct'),
    order: t('log.entityOrder'),
    customer: t('log.entityCustomer'),
    category: t('log.entityCategory'),
    other: ar ? 'أخرى' : 'Other',
  }

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
      second: '2-digit',
    })
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    } catch {
      toast({
        title: ar ? 'تعذر النسخ' : 'Copy failed',
        description: ar ? 'المتصفح منع الوصول إلى الحافظة.' : 'The browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  const handleResend = async () => {
    setIsRetrying(true)
    try {
      const res = await retrySyncLog(log.id)
      if (res.success) {
        toast({
          title: t('log.resend'),
          description: ar ? 'تمت إعادة الإرسال بنجاح والمزامنة قيد التشغيل!' : 'Retry sync started successfully!',
        })
        router.refresh()
      } else {
        toast({
          title: ar ? 'فشلت إعادة الإرسال' : 'Resend Failed',
          description: res.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: ar ? 'خطأ' : 'Error',
        description: err?.message || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
    } finally {
      setIsRetrying(false)
    }
  }

  const handleResolveManually = async () => {
    setIsResolving(true)
    try {
      const res = await resolveLogManually(log.id)
      if (res.success) {
        toast({
          title: ar ? 'تم الحل يدويًا' : 'Resolved Manually',
          description: ar ? 'تم تعيين السجل كمحلول يدوياً في أودو بنجاح!' : 'Log marked as resolved manually in Odoo!',
        })
        router.refresh()
      } else {
        toast({
          title: ar ? 'فشل الإجراء' : 'Action Failed',
          description: res.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: ar ? 'خطأ' : 'Error',
        description: err?.message || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
    } finally {
      setIsResolving(false)
    }
  }

  const canAct = log.status === 'failed' || log.status === 'skipped'

  // The store id is generic in the database; name it after the platform that
  // owns this record so a Salla/Shopify id is never labelled "Zid".
  const entityIdLabel =
    log.platform === 'salla'
      ? (ar ? 'معرف العنصر في سلة' : 'Salla Entity ID')
      : log.platform === 'shopify'
        ? (ar ? 'معرف العنصر في شوبيفاي' : 'Shopify Entity ID')
        : log.platform === 'zid'
          ? (ar ? 'معرف العنصر في زد' : 'Zid Entity ID')
          : (ar ? 'معرف العنصر في المتجر' : 'Store entity ID')

  return (
    <div className="space-y-5">
      {/* Breadcrumb — the record id is the URL segment, so each log is its own page. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/app/logs"
          className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {t('log.backToLogs')}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="font-mono text-foreground/70">{log.id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-foreground">{t('log.detailsTitle')}</h1>
            <SyncStatusBadge status={log.status} resolvedManually={isResolvedManually} />
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="break-all font-mono text-[11px] text-muted-foreground">{log.id}</span>
            <button
              type="button"
              onClick={() => copy(log.id)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t('log.copyId')}
            >
              {copiedId ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canAct && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResolveManually}
              disabled={isResolving}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {isResolving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {ar ? 'حل يدوي' : 'Resolve Manually'}
            </Button>
          )}
          {canAct && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResend}
              disabled={isRetrying}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {isRetrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {t('log.resend')}
            </Button>
          )}
        </div>
      </div>

      {/* Basic record data */}
      <div className="border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <InfoField label={ar ? 'الحدث' : 'Event'} mono>
            {log.event || '—'}
          </InfoField>
          <InfoField label={t('log.entity')}>
            {entityLabels[eventEntity(log.event)] || '—'}
          </InfoField>
          <InfoField label={t('log.triggerType')}>
            <SyncTriggerBadge triggerType={log.trigger_type} />
          </InfoField>
          <InfoField label={t('log.recordId')} mono>
            {log.odoo_record_id != null ? `#${log.odoo_record_id}` : '—'}
          </InfoField>
          <InfoField label={t('log.model')} mono>
            {log.odoo_model || '—'}
          </InfoField>
          <InfoField label={entityIdLabel} mono>
            {log.zid_entity_id || '—'}
          </InfoField>
          <InfoField label={ar ? 'الربط' : 'Mapping'}>
            {log.field_mappings?.name || '—'}
          </InfoField>
          <InfoField label={ar ? 'معرف المتجر' : 'Store'} mono>
            {log.store_id || '—'}
          </InfoField>
          <InfoField label={t('log.createdAt')}>
            {formatDate(log.created_at)}
          </InfoField>
          <InfoField label={ar ? 'الحذف التلقائي' : 'Auto-delete'}>
            {getDeletionCountdown(log.created_at, log.status, ar) || '—'}
          </InfoField>
          <InfoField label={t('log.logNumber')} mono>
            {log.id}
          </InfoField>
        </div>
      </div>

      {/* Error / skip details */}
      {errorMessage && (
        <div
          className={cn(
            'flex items-start gap-2 border p-3 text-xs',
            log.status === 'failed'
              ? 'border-destructive/15 bg-destructive/5 text-destructive'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {log.status === 'failed' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="space-y-0.5">
            <div className="font-bold">
              {log.status === 'failed'
                ? t('log.errorMessage')
                : log.status === 'skipped'
                  ? (ar ? 'سبب التخطي' : 'Skip reason')
                  : (ar ? 'ملاحظات' : 'Notes')}
            </div>
            <div className="break-all font-mono text-[11px] leading-relaxed opacity-90">{errorMessage}</div>
          </div>
        </div>
      )}

      {/* Payload: Visual Fields & Tables + Raw JSON tabs */}
      <PayloadViewer payload={log.payload} platform={log.platform} event={log.event} />
    </div>
  )
}
