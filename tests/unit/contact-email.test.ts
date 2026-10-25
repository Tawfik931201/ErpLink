import { contactMessageEmail } from '@/lib/email-templates'

/**
 * The contact-form notification is the only place an unauthenticated public
 * input string is interpolated into an HTML email. Everything it prints must be
 * escaped, or a message containing markup would inject it into the inbox view.
 */
const base = {
  name: 'أحمد محمد',
  email: 'ahmed@example.com',
  phone: '0555555555',
  company: 'متجر تجريبي',
  message: 'الربط لا يعمل منذ الصباح.',
  isNewCustomer: true,
  ticketId: 42,
}

describe('contactMessageEmail', () => {
  it('names the sender in the subject so the inbox list is readable without opening it', () => {
    expect(contactMessageEmail(base).subject).toContain('أحمد محمد')
  })

  it('prints every submitted field in the HTML body', () => {
    const { html } = contactMessageEmail(base)
    expect(html).toContain('أحمد محمد')
    expect(html).toContain('ahmed@example.com')
    expect(html).toContain('0555555555')
    expect(html).toContain('متجر تجريبي')
    expect(html).toContain('الربط لا يعمل منذ الصباح.')
  })

  it('escapes markup from the public form instead of injecting it', () => {
    const { html } = contactMessageEmail({
      ...base,
      name: '<script>alert(1)</script>',
      company: '" onmouseover="x',
      message: '<img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('onmouseover="x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x')
  })

  it('carries the ticket id when one exists, and a dash when it does not', () => {
    expect(contactMessageEmail(base).html).toContain('#42')
    expect(contactMessageEmail({ ...base, ticketId: null }).html).toContain('—')
  })

  it('labels a first-time sender differently from a known customer', () => {
    expect(contactMessageEmail(base).html).toContain('عميل جديد')
    expect(contactMessageEmail({ ...base, isNewCustomer: false }).html).toContain(
      'مسجل بالفعل على السيستم',
    )
  })

  it('sends a plain-text alternative with no HTML tags', () => {
    const { text } = contactMessageEmail({ ...base, message: 'سطر أول\nسطر ثانٍ' })
    expect(text).not.toContain('<')
    expect(text).toContain('سطر أول')
    expect(text).toContain('ahmed@example.com')
  })

  it('does not escape the plain-text alternative (a literal < is data there)', () => {
    const { text } = contactMessageEmail({ ...base, message: 'السعر < 100' })
    expect(text).toContain('السعر < 100')
  })
})
