/**
 * Ticket-chat-only client media helpers and safe inline image allowlist.
 * Reused by the attachment route so SVG/HTML never render inline.
 */
export const TICKET_CHAT_MAX_FILES = 5
export const TICKET_CHAT_MAX_FILE_BYTES = 10 * 1024 * 1024
export const TICKET_CHAT_MAX_TOTAL_BYTES = 20 * 1024 * 1024

const SAFE_INLINE_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
])

export function isTicketChatPreviewImage(mimetype: string | null | undefined): boolean {
  return SAFE_INLINE_IMAGE_MIMES.has((mimetype || '').toLowerCase().trim())
}

export type TicketChatFileError = 'too_many' | 'file_too_large' | 'total_too_large' | 'invalid_file'
export type TicketChatFilesResult = { files: File[]; error?: TicketChatFileError }

/** Validate before accepting paste/picker/drop attachments (same limits as Odoo). */
export function mergeTicketChatFiles(
  existing: readonly File[],
  incoming: readonly File[],
): TicketChatFilesResult {
  const files = [...existing, ...incoming]
  if (files.length > TICKET_CHAT_MAX_FILES) return { files: [...existing], error: 'too_many' }
  let total = 0
  for (const file of files) {
    if (!file || !file.name || file.name.length > 255) {
      return { files: [...existing], error: 'invalid_file' }
    }
    if (file.size > TICKET_CHAT_MAX_FILE_BYTES) {
      return { files: [...existing], error: 'file_too_large' }
    }
    total += file.size
  }
  if (total > TICKET_CHAT_MAX_TOTAL_BYTES) {
    return { files: [...existing], error: 'total_too_large' }
  }
  return { files }
}

const PASTE_IMAGE_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

/**
 * Turn clipboard image items (Print Screen / Copy Image / screenshot) into
 * regular File attachments. Text-only paste is left to the textarea.
 * Deliberately ignores SVG/HTML and never evaluates pasted markup.
 */
export function getPastedTicketImages(
  items: DataTransferItemList | readonly DataTransferItem[],
  now: number = Date.now(),
): File[] {
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !isTicketChatPreviewImage(item.type)) continue
    const pasted = item.getAsFile()
    if (!pasted || !isTicketChatPreviewImage(pasted.type)) continue
    const extension = PASTE_IMAGE_EXTENSION[pasted.type.toLowerCase()]
    if (!extension) continue
    const name = 'pasted-image-' + now + '-' + (files.length + 1) + '.' + extension
    files.push(new File([pasted], name, { type: pasted.type, lastModified: now }))
  }
  return files
}
