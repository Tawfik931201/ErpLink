'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, X, ZoomIn } from 'lucide-react'

import { isTicketChatPreviewImage } from '@/lib/ticket-chat-media'

export type TicketChatImagePreview = { src: string; name: string }

/** Full-screen, keyboard-dismissible picture viewer. Nothing is auto-downloaded. */
export function TicketChatImageLightbox({
  preview, onClose, lang,
}: {
  preview: TicketChatImagePreview | null
  onClose: () => void
  lang: 'ar' | 'en'
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeCallback = useRef(onClose)
  closeCallback.current = onClose

  useEffect(() => {
    if (!preview) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCallback.current()
      // Keep keyboard focus inside the viewer while it is modal.
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = oldOverflow
      previousFocus?.focus()
    }
  }, [preview?.src])

  if (!preview) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'ar' ? 'معاينة الصورة' : 'Image preview'}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0b141a]/95 p-3 sm:p-6"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mb-3 flex w-full max-w-5xl items-center justify-between gap-3 text-white">
        <span className="min-w-0 truncate text-sm font-medium" dir="auto">{preview.name}</span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={lang === 'ar' ? 'إغلاق معاينة الصورة' : 'Close image preview'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25d366]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <img
        src={preview.src}
        alt={preview.name}
        className="max-h-[80dvh] max-w-full rounded-lg object-contain shadow-2xl"
        draggable={false}
      />
      <span className="mt-3 text-xs text-white/60">
        {lang === 'ar' ? 'اضغط Esc للإغلاق' : 'Press Esc to close'}
      </span>
    </div>
  )
}

/** Pasted and selected files get local image thumbnails until Send is pressed. */
export function TicketChatSelectedFiles({
  files, onRemove, onPreview, lang,
}: {
  files: File[]
  onRemove: (index: number) => void
  onPreview: (preview: TicketChatImagePreview) => void
  lang: 'ar' | 'en'
}) {
  const [thumbnails, setThumbnails] = useState<string[]>([])
  useEffect(() => {
    const urls = files.map(file =>
      isTicketChatPreviewImage(file.type) ? URL.createObjectURL(file) : '')
    setThumbnails(urls)
    return () => urls.forEach(url => { if (url) URL.revokeObjectURL(url) })
  }, [files])

  if (files.length === 0) return null

  return (
    <div
      className="flex gap-2 overflow-x-auto rounded-xl bg-[#dfe5e7]/75 p-2 dark:bg-[#111b21]/90"
      aria-label={lang === 'ar' ? 'المرفقات الجاهزة للإرسال' : 'Attachments ready to send'}
    >
      {files.map((file, index) => {
        const url = thumbnails[index]
        return (
          <div
            key={file.name + '-' + index}
            className="relative flex w-[110px] shrink-0 flex-col items-center gap-1 rounded-xl bg-white p-1.5 shadow-sm dark:bg-[#2a3942]"
          >
            {url ? (
              <button
                type="button"
                onClick={() => onPreview({ src: url, name: file.name })}
                aria-label={(lang === 'ar' ? 'معاينة ' : 'Preview ') + file.name}
                className="group relative flex h-[75px] w-full items-center justify-center overflow-hidden rounded-lg bg-[#efeae2] dark:bg-[#111b21]"
              >
                <img src={url} alt={file.name} className="h-full w-full object-cover" />
                <ZoomIn className="absolute h-5 w-5 text-white opacity-0 drop-shadow group-hover:opacity-100" />
              </button>
            ) : (
              <div className="flex h-[75px] w-full items-center justify-center rounded-lg bg-[#efeae2] text-[#54656f] dark:bg-[#111b21] dark:text-[#8696a0]">
                <FileText className="h-7 w-7" />
              </div>
            )}
            <span className="w-full truncate text-center text-[10px] text-[#54656f] dark:text-[#d1d7db]" title={file.name}>
              {file.name}
            </span>
            <button
              type="button"
              aria-label={(lang === 'ar' ? 'حذف ' : 'Remove ') + file.name}
              onClick={() => onRemove(index)}
              className="absolute -end-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#54656f] text-white shadow-sm hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25d366]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
