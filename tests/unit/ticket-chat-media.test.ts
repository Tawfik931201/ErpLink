import {
  getPastedTicketImages, isTicketChatPreviewImage, mergeTicketChatFiles,
  TICKET_CHAT_MAX_FILE_BYTES,
} from '@/lib/ticket-chat-media'

describe('ticket chat safe image preview and clipboard attachments', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])(
    'permits inline display for safe image MIME %s', mime => {
      expect(isTicketChatPreviewImage(mime)).toBe(true)
    },
  )

  it.each(['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream', '', 'image/jpeg; charset=utf-8'])(
    'does not render unsafe MIME %s inline', mime => {
      expect(isTicketChatPreviewImage(mime)).toBe(false)
    },
  )

  it('extracts clipboard PNG as a named File while leaving text alone', () => {
    const image = new File(['PNG'], 'image.png', { type: 'image/png' })
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
      { kind: 'file', type: 'image/svg+xml', getAsFile: () => new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }) },
    ] as unknown as DataTransferItem[]
    const result = getPastedTicketImages(items, 123)
    expect(result).toHaveLength(1)
    expect(result[0]).toBeInstanceOf(File)
    expect(result[0].name).toBe('pasted-image-123-1.png')
    expect(result[0].type).toBe('image/png')
  })

  it('limits pasted and selected attachments to Odoo limits', () => {
    const file = new File(['a'], 'a.png', { type: 'image/png' })
    expect(mergeTicketChatFiles([], [file]).files).toEqual([file])
    expect(mergeTicketChatFiles([file, file, file, file, file], [file]).error).toBe('too_many')
    const oversized = { name: 'big.png', size: TICKET_CHAT_MAX_FILE_BYTES + 1 } as File
    expect(mergeTicketChatFiles([], [oversized]).error).toBe('file_too_large')
    const first = { name: 'first.png', size: 9 * 1024 * 1024 } as File
    const second = { name: 'second.png', size: 9 * 1024 * 1024 } as File
    const third = { name: 'third.png', size: 4 * 1024 * 1024 } as File
    expect(mergeTicketChatFiles([first, second], [third]).error).toBe('total_too_large')
  })
})
