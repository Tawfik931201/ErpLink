import { Info, Lightbulb, AlertTriangle, AlertCircle, ShieldAlert } from 'lucide-react'
import React from 'react'

export type CalloutType = 'note' | 'tip' | 'warning' | 'important' | 'caution'

const calloutConfig: Record<
  CalloutType,
  {
    icon: typeof Info
    borderClass: string
    bgClass: string
    textClass: string
    defaultTitle: { ar: string; en: string }
  }
> = {
  note: {
    icon: Info,
    borderClass: 'border-blue-500/40 dark:border-blue-500/30',
    bgClass: 'bg-blue-500/5 dark:bg-blue-500/10',
    textClass: 'text-blue-600 dark:text-blue-400',
    defaultTitle: { ar: 'ملاحظة', en: 'Note' },
  },
  tip: {
    icon: Lightbulb,
    borderClass: 'border-emerald-500/40 dark:border-emerald-500/30',
    bgClass: 'bg-emerald-500/5 dark:bg-emerald-500/10',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    defaultTitle: { ar: 'نصيحة عملية', en: 'Tip' },
  },
  warning: {
    icon: AlertTriangle,
    borderClass: 'border-amber-500/40 dark:border-amber-500/30',
    bgClass: 'bg-amber-500/5 dark:bg-amber-500/10',
    textClass: 'text-amber-600 dark:text-amber-400',
    defaultTitle: { ar: 'تنبيه مهم', en: 'Warning' },
  },
  important: {
    icon: AlertCircle,
    borderClass: 'border-primary/40 dark:border-primary/30',
    bgClass: 'bg-primary/5 dark:bg-primary/10',
    textClass: 'text-primary',
    defaultTitle: { ar: 'شرط أساسي', en: 'Important' },
  },
  caution: {
    icon: ShieldAlert,
    borderClass: 'border-rose-500/40 dark:border-rose-500/30',
    bgClass: 'bg-rose-500/5 dark:bg-rose-500/10',
    textClass: 'text-rose-600 dark:text-rose-400',
    defaultTitle: { ar: 'تحذير تشغيلي', en: 'Caution' },
  },
}

export function DocsCallout({
  type = 'note',
  title,
  children,
  lang = 'ar',
}: {
  type?: CalloutType
  title?: string
  children: React.ReactNode
  lang?: 'ar' | 'en'
}) {
  const config = calloutConfig[type]
  const Icon = config.icon
  const displayTitle = title || config.defaultTitle[lang]

  return (
    <div
      className={`my-5 rounded-lg border-s-4 p-4 text-xs leading-relaxed ${config.borderClass} ${config.bgClass}`}
      role="region"
      aria-label={displayTitle}
    >
      <div className="flex items-center gap-2 mb-1.5 font-bold">
        <Icon className={`h-4 w-4 shrink-0 ${config.textClass}`} aria-hidden="true" />
        <span className={config.textClass}>{displayTitle}</span>
      </div>
      <div className="text-foreground/90 space-y-2 ps-6">{children}</div>
    </div>
  )
}
