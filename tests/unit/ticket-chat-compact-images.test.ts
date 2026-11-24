import { readFileSync } from 'fs'
import path from 'path'

const client = readFileSync(
  path.join(process.cwd(), 'src/app/(app)/app/tickets/tickets-client.tsx'), 'utf8',
)

describe('support chat compact independent image messages', () => {
  it('separates image tiles from text/file chat bubbles', () => {
    expect(client).toContain('const imageAttachments = attachedFiles.filter')
    expect(client).toContain('const documentAttachments = attachedFiles.filter')
    expect(client).toContain('const showBubble = hasText || documentAttachments.length > 0 || imageAttachments.length === 0')
    expect(client).toContain('{showBubble && (')
    expect(client).toContain('{imageAttachments.length > 0 && (')
    expect(client).toContain('documentAttachments.map(attachment => (')
    expect(client).toContain('imageAttachments.map(attachment => {')
    expect(client.indexOf('{imageAttachments.length > 0 && (')).toBeGreaterThan(client.indexOf('{showBubble && ('))
  })

  it('hides the system attachment-only placeholder when an image has no caption', () => {
    expect(client).toContain("plainBody.toLowerCase() === 'attachment sent'")
    expect(client).toContain('imageAttachments.length > 0 && !showBubble')
  })

  it('uses smaller transparent images with accessible on-demand zoom', () => {
    expect(client).toContain('max-h-[112px] max-w-[150px]')
    expect(client).toContain('sm:max-h-[120px] sm:max-w-[165px]')
    expect(client).toContain('rounded-lg border border-black/10 bg-transparent p-0')
    expect(client).toContain("setActiveImage({ src: previewUrl, name: attachment.name })")
    expect(client).toContain("'&preview=1'")
    expect(client).toContain('<TicketChatImageLightbox')
  })

  it('keeps customer/support colors for text, never alters tickets data persistence', () => {
    expect(client).toContain('bg-[#d9fdd3]')
    expect(client).toContain('dark:bg-[#005c4b]')
    expect(client).toContain('sanitizeOdooHtml(msg.body)')
    expect(client).not.toContain("from '@/lib/supabase'")
  })
})
