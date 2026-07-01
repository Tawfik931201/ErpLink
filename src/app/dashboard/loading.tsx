import React from 'react'

export default function Loading() {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 rounded-full px-3 py-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 select-none">
        جاري التحميل...
      </span>
    </div>
  )
}
