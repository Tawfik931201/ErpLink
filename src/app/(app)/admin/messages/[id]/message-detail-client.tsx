'use client'

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Copy,
  Loader2,
  Mail,
  MailOpen,
  Phone,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { updateContactMessageStatus } from '@/app/actions/contact-messages'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { ContactMessageRow, ContactMessageStatus } from '@/lib/contact-messages'
import { cn } from '@/lib/utils'

import { contactStatusMeta, customerKindLabel, formatContactDate } from '../message-ui'

function InfoField({
  label,
  children,
  mono = false,
  wide = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
  wide?: boolean
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className={cn('mt-1 break-all text-xs text-foreground', mono && 'font-mono')}>
        {children}
      </div>
    </div>
  )
}

export default function MessageDetailClient({ row, ar }: { row: ContactMessageRow; ar: boolean }) {
  const router = useRouter()
  const { toast } = useToast()

  const [status, setStatus] = useState<ContactMessageStatus>(row.status)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  const meta = contactStatusMeta(status, ar)
  const BackIcon = ar ? ArrowRight : ArrowLeft

  async function changeStatus(next: ContactMessageStatus) {
    setPending(true)
    const result = await updateContactMessageStatus(row.id, next)

    if (!result.success) {
      toast({
        title: ar ? 'فشل الإجراء' : 'Action failed',
        description: result.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
      setPending(false)
      return
    }

    setStatus(next)
    setPending(false)
    // The list and the unread badge live on other pages of the admin panel.
    router.refresh()
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(row.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({
        title: ar ? 'تعذر النسخ' : 'Copy failed',
        description: ar
          ? 'المتصفح منع الوصول إلى الحافظة.'
          : 'The browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb — the record id is the URL segment, so each message is its own page. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <Link
          href="/admin/messages"
          className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الرسائل' : 'Back to messages'}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="font-mono text-foreground/70">{row.id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-foreground">{row.name}</h1>
            <span
              className={cn(
                'inline-flex items-center border px-2 py-0.5 text-[10px] font-bold',
                meta.cls,
              )}
            >
              {meta.label}
            </span>
            {row.odoo_ticket_id == null && (
              <span
                className="inline-flex items-center border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"
                title={
                  ar
                    ? 'لم تُنشأ تذكرة في أودوو لهذه الرسالة'
                    : 'No Odoo ticket was created for this message'
                }
              >
                {ar ? 'بلا تذكرة' : 'no ticket'}
              </span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-1.5">
            <span className="break-all font-mono text-[11px] text-muted-foreground">{row.id}</span>
            <button
              type="button"
              onClick={() => void copyId()}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={ar ? 'نسخ المعرّف' : 'Copy ID'}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === 'new' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus('read')}
              disabled={pending}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {ar ? 'تعليم كمقروءة' : 'Mark read'}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus('new')}
              disabled={pending}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              {ar ? 'تعليم كغير مقروءة' : 'Mark unread'}
            </Button>
          )}

          {status === 'archived' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus('read')}
              disabled={pending}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArchiveRestore className="h-3.5 w-3.5" />
              )}
              {ar ? 'استعادة' : 'Restore'}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void changeStatus('archived')}
              disabled={pending}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              {ar ? 'أرشفة' : 'Archive'}
            </Button>
          )}
        </div>
      </div>

      {/* Basic record data */}
      <div className="border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoField label={ar ? 'الشركة' : 'Company'}>
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              {row.company || '—'}
            </span>
          </InfoField>
          <InfoField label={ar ? 'البريد' : 'Email'}>
            <a
              href={`mailto:${row.email}`}
              dir="ltr"
              className="text-primary underline-offset-4 hover:underline"
            >
              {row.email}
            </a>
          </InfoField>
          <InfoField label={ar ? 'الجوال' : 'Phone'}>
            <a
              href={`tel:${row.phone}`}
              dir="ltr"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <Phone className="h-3 w-3" />
              {row.phone}
            </a>
          </InfoField>
          <InfoField label={ar ? 'تاريخ الإرسال' : 'Received'}>
            {formatContactDate(row.created_at, ar)}
          </InfoField>

          <InfoField label={ar ? 'الحالة' : 'Status'}>{meta.label}</InfoField>
          <InfoField label={ar ? 'تذكرة أودوو' : 'Odoo ticket'} mono>
            {row.odoo_ticket_id != null ? `#${row.odoo_ticket_id}` : '—'}
          </InfoField>
          <InfoField label={ar ? 'تصنيف العميل' : 'Customer'}>
            {customerKindLabel(row.is_new_customer, ar)}
          </InfoField>
          <InfoField label={ar ? 'قرئت في' : 'Read at'}>
            {formatContactDate(row.read_at, ar)}
          </InfoField>

          <InfoField label={ar ? 'قرأها' : 'Read by'} mono>
            {row.read_by || '—'}
          </InfoField>
          <InfoField label={ar ? 'إشعار البريد' : 'Email alert'}>
            {row.email_delivered ? (ar ? 'أُرسل' : 'Sent') : ar ? 'لم يُرسل' : 'Not sent'}
          </InfoField>
          <InfoField label={ar ? 'المعرّف' : 'Record ID'} mono wide>
            {row.id}
          </InfoField>
        </div>
      </div>

      {/* The letter itself — the only place the body is read. */}
      <div className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
          <span className="text-[10px] font-bold text-muted-foreground">
            {ar ? 'نص الرسالة' : 'Message'}
          </span>
          <a
            href={`mailto:${row.email}?subject=${encodeURIComponent(
              ar ? 'رد على رسالتك - ErpLink' : 'Re: your message - ErpLink',
            )}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <MailOpen className="h-3 w-3" />
            {ar ? 'رد بالبريد' : 'Reply by email'}
          </a>
        </div>
        <div className="p-4">
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
            {row.message}
          </p>
        </div>
      </div>

      {!row.email_delivered && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? 'إشعار البريد معطّل حالياً (CONTACT_INBOX_EMAIL غير مضبوط)، لذلك لا يُرسل بريد لأي رسالة. الرسالة محفوظة هنا وفي أودوو فقط.'
            : 'Email alerts are currently off (CONTACT_INBOX_EMAIL is unset), so no email is sent. The message is stored here and in Odoo only.'}
        </p>
      )}
    </div>
  )
}
