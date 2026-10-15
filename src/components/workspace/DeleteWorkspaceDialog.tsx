'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface DeleteWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName: string
  onConfirm: () => Promise<void>
}

/**
 * مجموعات البيانات المحذوفة — يجب الإقرار بكل واحدة على حدة حتى يدرك
 * المالك جسامة ما يفعله. (القائمة الكاملة في src/lib/workspace-purge.ts)
 */
const DATA_GROUPS = [
  {
    id: 'orders',
    ar: 'الطلبات وسجلات المزامنة',
    en: 'Orders & sync logs',
    descAr: 'سجلات الطلبات والطوابير المعلقة والأرشيف',
    descEn: 'Order logs, pending queues and the dead-letter archive',
  },
  {
    id: 'stores',
    ar: 'ربط المتاجر والتوكنات',
    en: 'Store links & tokens',
    descAr: 'زد وسلة وشوبيفاي واتصال أودوو — مع إلغاء الـ webhooks',
    descEn: 'Zid, Salla, Shopify and Odoo connection, webhooks unregistered',
  },
  {
    id: 'mappings',
    ar: 'قواعد الربط والإعدادات',
    en: 'Mapping rules & settings',
    descAr: 'كل قواعد الحقول والمنتجات والتصنيفات والإعدادات',
    descEn: 'All field, product and category mappings and settings',
  },
  {
    id: 'billing',
    ar: 'الاشتراكات والمدفوعات',
    en: 'Subscriptions & payments',
    descAr: 'سجلات الاشتراكات والمدفوعات الخاصة بهذه المساحة',
    descEn: 'Subscription and payment records of this workspace',
  },
  {
    id: 'team',
    ar: 'الأعضاء وتنبيهات تليجرام',
    en: 'Members & Telegram alerts',
    descAr: 'عضويات المساحة واشتراكات بوتات التنبيه',
    descEn: 'Workspace memberships and Telegram bot subscriptions',
  },
] as const

export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspaceName,
  onConfirm,
}: DeleteWorkspaceDialogProps) {
  const [typedName, setTypedName] = useState('')
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [pasteBlockedHint, setPasteBlockedHint] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const { lang, dir } = useLanguage()
  const isRtl = dir === 'rtl'

  // تصفير الحالة عند فتح الحوار أو تبديل المساحة المستهدفة.
  useEffect(() => {
    if (open) {
      setTypedName('')
      setChecks({})
      setPasteBlockedHint(false)
    }
  }, [open, workspaceName])

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
    } finally {
      setIsDeleting(false)
      setTypedName('')
      setChecks({})
      onOpenChange(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTypedName('')
      setChecks({})
      setPasteBlockedHint(false)
    }
    onOpenChange(next)
  }

  const blockClipboard = (e: React.ClipboardEvent | React.DragEvent) => {
    e.preventDefault()
    setPasteBlockedHint(true)
  }

  // المقارنة بعد trim (مسافة زائدة عرَضية لا تعني تزويراً)، لكن كل حرف
  // يجب أن يُكتب يدوياً — اللصق والسحب والإفلات معطلة أعلاه.
  const nameMatches = typedName.trim() === workspaceName.trim() && workspaceName.trim() !== ''
  const allChecked = DATA_GROUPS.every((g) => checks[g.id] === true)
  const canDelete = nameMatches && allChecked && !isDeleting

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir={dir}>
        <DialogHeader>
          <div className={cn('flex items-center gap-3', isRtl ? 'text-right' : 'text-left')}>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <DialogTitle>
                {lang === 'ar' ? 'حذف بيئة العمل نهائياً' : 'Permanently Delete Workspace'}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {lang === 'ar'
                  ? 'هذا الإجراء لا يمكن التراجع عنه إطلاقاً. لن تُحذف المساحة فقط، بل كل البيانات التالية معها.'
                  : 'This action cannot be undone, ever. Not just the workspace — all of the following data goes with it.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 1) كتابة الاسم يدوياً — بلا نسخ/لصق */}
          <div className="space-y-2">
            <p className={cn('text-sm font-medium text-foreground', isRtl ? 'text-right' : 'text-left')}>
              {lang === 'ar' ? (
                <>اكتب اسم بيئة العمل <strong>يدوياً حرفاً بحرف</strong> (النسخ واللصق معطّل):</>
              ) : (
                <>Type the workspace name <strong>manually, character by character</strong> (copy & paste disabled):</>
              )}
            </p>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <code className="text-sm font-bold text-destructive select-none">{workspaceName}</code>
            </div>
            <Input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              onCopy={blockClipboard}
              onCut={blockClipboard}
              onPaste={blockClipboard}
              onDrop={blockClipboard}
              onDragStart={(e) => e.preventDefault()}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              placeholder={lang === 'ar' ? 'اكتب الاسم هنا…' : 'Type the name here…'}
              aria-label={lang === 'ar' ? 'تأكيد اسم بيئة العمل' : 'Confirm workspace name'}
              className={cn(
                'text-center font-medium',
                typedName && !nameMatches && 'border-destructive/50 focus-visible:border-destructive focus-visible:ring-destructive/30',
                nameMatches && 'border-emerald-500/50 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30',
              )}
            />
            {pasteBlockedHint && (
              <p className="text-[11px] font-bold text-destructive">
                {lang === 'ar'
                  ? '⛔ النسخ واللصق والسحب معطّلة هنا عمداً — اكتب الاسم بلوحة المفاتيح.'
                  : '⛔ Copy, paste and drag-and-drop are disabled here on purpose — type the name with your keyboard.'}
              </p>
            )}
          </div>

          {/* 2) إقرار منفصل لكل نوع بيانات */}
          <div className="space-y-2">
            <p className={cn('text-sm font-medium text-foreground', isRtl ? 'text-right' : 'text-left')}>
              {lang === 'ar'
                ? 'أقرّ بحذف كل نوع من البيانات التالية (كل واحدة على حدة):'
                : 'I acknowledge deleting each of the following data types (one by one):'}
            </p>
            <div className="space-y-1.5">
              {DATA_GROUPS.map((g) => {
                const checked = checks[g.id] === true
                return (
                  <label
                    key={g.id}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors',
                      checked ? 'border-destructive/40 bg-destructive/5' : 'border-border/60'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecks((prev) => ({ ...prev, [g.id]: e.target.checked }))}
                      aria-label={lang === 'ar' ? `أقر بحذف: ${g.ar}` : `Acknowledge deleting: ${g.en}`}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-destructive"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-foreground">
                        {lang === 'ar' ? `أوافق على حذف: ${g.ar}` : `I agree to delete: ${g.en}`}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {lang === 'ar' ? g.descAr : g.descEn}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className={cn(isRtl && 'sm:flex-row-reverse')}>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canDelete}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {lang === 'ar' ? 'جارٍ الحذف النهائي...' : 'Deleting permanently...'}
              </>
            ) : (
              lang === 'ar' ? 'حذف نهائي — فهمت العواقب' : 'Delete permanently — I understand'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
