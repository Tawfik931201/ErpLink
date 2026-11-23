import { readFileSync } from 'fs'
import path from 'path'

const source = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')
const route = source('src', 'app', 'api', 'tickets', 'attachments', 'route.ts')
const support = source('src', 'lib', 'odoo-support.ts')
const client = source('src', 'app', '(app)', 'app', 'tickets', 'tickets-client.tsx')
const media = source('src', 'components', 'tickets', 'ticket-chat-media.tsx')

describe('WhatsApp-style Odoo support chat image UX', () => {
  it('serves only safe inline image previews after the existing ticket ownership checks', () => {
    expect(route).toContain('readOwnedOdooAttachment(id)')
    expect(route).toContain("searchParams.get('preview') === '1'")
    expect(route).toContain('isTicketChatPreviewImage(file.mimetype)')
    expect(route).toContain("inlinePreview ? 'inline' : 'attachment'")
    expect(route).toContain('X-Content-Type-Options')
    expect(route).toContain('private, no-store')
    expect(support).toContain("throw new Error('Internal attachment')")
    expect(support).toContain('await ownedTicket(ticketId)')
  })

  it('opens full-screen image preview, not an automatic download', () => {
    expect(client).toContain("const previewUrl = url + '&preview=1'")
    expect(client).toContain('setActiveImage({ src: previewUrl, name: attachment.name })')
    expect(client).toContain('<TicketChatImageLightbox')
    expect(media).toContain('role="dialog"')
    expect(media).toContain('aria-modal="true"')
    expect(media).toContain("event.key === 'Escape'")
  })

  it('paste-only image is shown as an attachment before send and cleaned up afterwards', () => {
    expect(client).toContain('onPaste={pasteImages}')
    expect(client).toContain('getPastedTicketImages(event.clipboardData.items)')
    expect(client).toContain('appendFiles(files)')
    expect(client).toContain('<TicketChatSelectedFiles')
    expect(client).toContain('formData.append(\'attachments\', file)')
    expect(media).toContain('URL.createObjectURL(file)')
    expect(media).toContain('URL.revokeObjectURL(url)')
    expect(client).toContain("setSelectedFiles([])")
  })

  it('uses familiar WhatsApp light and dark bubbles without changing Odoo read/write paths', () => {
    expect(client).toContain('bg-[#d9fdd3]')
    expect(client).toContain('dark:bg-[#005c4b]')
    expect(client).toContain('bg-[#efeae2]')
    expect(client).toContain('dark:bg-[#0b141a]')
    expect(client).toContain('isMine ? \'justify-end\' : \'justify-start\'')
    expect(client).toContain('sanitizeOdooHtml(msg.body)')
  })

  it('adds emoji at the composer caret without an external dependency or Supabase', () => {
    expect(client).toContain('CHAT_EMOJIS.map(emoji =>')
    expect(client).toContain('setReplyText(text => text.slice(0, cursor) + emoji + text.slice(end))')
    expect(client).toContain('event.nativeEvent.isComposing')
    expect(client).not.toContain("from '@/lib/supabase'")
  })
})
