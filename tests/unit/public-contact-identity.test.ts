import { readFileSync } from 'fs'
import path from 'path'

import { publicMarkdown } from '@/lib/public-agent-content'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'
import { homepageStructuredData } from '@/lib/public-seo'

const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments), 'utf8')

describe('public company contact identity', () => {
  it('uses the owner-approved email in public Organization and ContactPoint schema', () => {
    expect(PUBLIC_CONTACT_EMAIL).toBe('info@bizsahla.com')
    const organization = homepageStructuredData['@graph'][0]
    expect(organization.email).toBe(PUBLIC_CONTACT_EMAIL)
    expect(organization.contactPoint.email).toBe(PUBLIC_CONTACT_EMAIL)
    expect(organization.contactPoint.url).toContain('/ar-sa/contact')
    expect(organization).not.toHaveProperty('telephone')
    expect(organization).not.toHaveProperty('address')
    expect(organization.contactPoint).not.toHaveProperty('telephone')
  })

  it('matches public marketing surfaces and read-only agent descriptions', () => {
    const footer = read('src', 'components', 'public-site-footer.tsx')
    const about = read('src', 'app', '(public)', 'about', 'page.tsx')
    const contact = read('src', 'app', '(public)', 'contact', 'page.tsx')
    const browser = read('public', 'agent-tools.js')
    const source = read('public', 'llms.txt')
    expect(footer).toContain('mailto:${PUBLIC_CONTACT_EMAIL}')
    expect(about).toContain('mailto:${PUBLIC_CONTACT_EMAIL}')
    expect(contact).toContain('mailto:${PUBLIC_CONTACT_EMAIL}')
    expect(browser).toContain("email: 'info@bizsahla.com'")
    expect(source).toContain('Contact email: info@bizsahla.com')
    for (const lang of ['ar', 'en'] as const) {
      expect(publicMarkdown('/contact', lang)).toContain(PUBLIC_CONTACT_EMAIL)
      expect(publicMarkdown('/integrations/zid-odoo', lang)).toContain(PUBLIC_CONTACT_EMAIL)
    }
    expect([footer, about, contact, browser, source].join('\n')).not.toContain('support@erplinks.com')
  })

  it('does not change contact persistence or customer support flow', () => {
    const backend = read('src', 'app', 'actions', 'contact.ts')
    expect(backend).toContain('await insertContactMessage(input)')
    expect(backend).toContain('await createPublicContactTicket(input, saved.id)')
    const business = read('src', 'lib', 'public-business-profile.ts')
    expect(business).not.toContain('PUBLIC_BUSINESS_PHONE_E164')
    expect(business).not.toContain('PUBLIC_BUSINESS_ADDRESS_CITY')
  })
})
