'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isDatabaseError =
    error.message.includes('P1001') ||
    error.message.includes("Can't reach database server") ||
    error.message.includes('tenant/user')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h1 className="text-lg font-semibold">تعذر فتح لوحة التحكم</h1>
        </div>
        <p className="mb-6 text-sm leading-6 text-muted-foreground">
          {isDatabaseError
            ? 'الاتصال بقاعدة بيانات Supabase غير مضبوط حاليا. تأكد من DATABASE_URL ثم أعد تشغيل السيرفر المحلي.'
            : 'حدث خطأ غير متوقع أثناء تحميل لوحة التحكم.'}
        </p>
        <Button type="button" onClick={reset} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          إعادة المحاولة
        </Button>
      </div>
    </div>
  )
}
