'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  isAr: boolean
}

/** Small prev/next pagination bar for admin tables. */
export default function PaginationControls({ page, pageSize, total, onPageChange, isAr }: Props) {
  if (total <= pageSize) return null
  const pages = Math.ceil(total / pageSize)
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2">
      <span className="text-[11px] text-muted-foreground">
        {isAr ? `عرض ${from}–${to} من ${total}` : `Showing ${from}–${to} of ${total}`}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          <ChevronRight className="h-3 w-3 rtl:rotate-180" />
          {isAr ? 'السابق' : 'Prev'}
        </button>
        <span className="text-[11px] text-muted-foreground px-1">
          {isAr ? `صفحة ${page} من ${pages}` : `Page ${page} of ${pages}`}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          {isAr ? 'التالي' : 'Next'}
          <ChevronLeft className="h-3 w-3 rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}
