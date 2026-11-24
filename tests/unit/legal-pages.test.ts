import { readFileSync } from 'fs'
import path from 'path'

import {
  termsSections,
  privacySections,
  TERMS_LAST_UPDATED,
  PRIVACY_LAST_UPDATED,
} from '@/lib/legal-content'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'
import { translations } from '@/lib/translations'

const read = (...segments: string[]) =>
  readFileSync(path.join(process.cwd(), ...segments), 'utf8')

describe('Legal Pages Architecture & Content Audit', () => {
  const termsPageSource = read('src', 'app', '(public)', 'terms', 'page.tsx')
  const privacyPageSource = read('src', 'app', '(public)', 'privacy', 'page.tsx')
  const legalContentSource = read('src', 'lib', 'legal-content.ts')
  const combinedSources = [termsPageSource, privacyPageSource, legalContentSource].join('\n')

  describe('Official Contact Identity & Legacy Purge', () => {
    it('uses the official approved email address across all legal pages', () => {
      expect(PUBLIC_CONTACT_EMAIL).toBe('info@bizsahla.com')
      expect(legalContentSource).toContain('PUBLIC_CONTACT_EMAIL')
      expect(termsPageSource).toContain('PUBLIC_CONTACT_EMAIL')
      expect(privacyPageSource).toContain('PUBLIC_CONTACT_EMAIL')
    })

    it('strictly forbids legacy and unauthorized email addresses', () => {
      expect(combinedSources).not.toContain('support@erplinks.com')
      expect(combinedSources).not.toContain('erplinks.com')
    })

    it('does not contain prohibited headquarters or virtual-only statements', () => {
      const forbiddenPhrases = [
        'لا يوجد لدينا مقر',
        'نحن شركة افتراضية',
        'نعمل من خلال الإنترنت فقط',
        'لا نوفر عنوانًا فعليًا',
        'We are an online-only company',
        'We do not have a physical office',
        'online-only company',
      ]
      for (const phrase of forbiddenPhrases) {
        expect(combinedSources).not.toContain(phrase)
      }
    })

    it('does not state unverified 100% security guarantees', () => {
      expect(combinedSources).not.toContain('100%')
      expect(combinedSources).not.toContain('بنسبة 100%')
    })
  })

  describe('Single Source of Truth for Update Timestamps', () => {
    it('has verified update dates for both Terms and Privacy', () => {
      expect(TERMS_LAST_UPDATED.ar).toBe('24 نوفمبر 2026')
      expect(TERMS_LAST_UPDATED.en).toBe('November 24, 2026')
      expect(TERMS_LAST_UPDATED.iso).toBe('2026-11-24')

      expect(PRIVACY_LAST_UPDATED.ar).toBe('24 نوفمبر 2026')
      expect(PRIVACY_LAST_UPDATED.en).toBe('November 24, 2026')
      expect(PRIVACY_LAST_UPDATED.iso).toBe('2026-11-24')
    })

    it('synchronizes translation keys with the legal config dates', () => {
      expect(translations.ar['terms.lastUpdated']).toContain('24 نوفمبر 2026')
      expect(translations.en['terms.lastUpdated']).toContain('November 24, 2026')
      expect(translations.ar['privacy.lastUpdated']).toContain('24 نوفمبر 2026')
      expect(translations.en['privacy.lastUpdated']).toContain('November 24, 2026')
    })
  })

  describe('Terms of Service Structure & Parity', () => {
    it('contains all 14 required sections in Terms of Service', () => {
      expect(termsSections).toHaveLength(14)
      const expectedIds = [
        'definitions',
        'acceptance',
        'services',
        'accounts',
        'third-party',
        'synchronization',
        'billing',
        'acceptable-use',
        'intellectual-property',
        'availability',
        'liability',
        'termination',
        'modifications',
        'general',
      ]
      expect(termsSections.map((s) => s.id)).toEqual(expectedIds)
    })

    it('maintains strict bilingual parity across all Terms sections', () => {
      for (const section of termsSections) {
        expect(section.number).toBeGreaterThan(0)
        expect(section.ar.title.trim().length).toBeGreaterThan(0)
        expect(section.en.title.trim().length).toBeGreaterThan(0)
        expect(section.ar.paragraphs.length).toBeGreaterThan(0)
        expect(section.en.paragraphs.length).toBeGreaterThan(0)

        // Ensure Arabic contains Arabic script and English contains Latin characters
        expect(/[\u0600-\u06FF]/.test(section.ar.title)).toBe(true)
        expect(/[a-zA-Z]/.test(section.en.title)).toBe(true)
      }
    })

    it('accurately specifies the 7-day trial and manual payment without card storage', () => {
      const billingSection = termsSections.find((s) => s.id === 'billing')
      expect(billingSection).toBeDefined()
      const arText = billingSection!.ar.paragraphs.concat(billingSection!.ar.bullets || []).join(' ')
      const enText = billingSection!.en.paragraphs.concat(billingSection!.en.bullets || []).join(' ')

      expect(arText).toContain('سبعة (7) أيام')
      expect(arText).toContain('التحويل البنكي')
      expect(arText).not.toContain('Stripe')

      expect(enText).toContain('seven (7) day')
      expect(enText).toContain('bank transfers')
      expect(enText).not.toContain('Stripe')
    })

    it('reflects accurate termination and automated workspace purge behavior', () => {
      const terminationSection = termsSections.find((s) => s.id === 'termination')
      expect(terminationSection).toBeDefined()
      const arText = terminationSection!.ar.paragraphs.concat(terminationSection!.ar.bullets || []).join(' ')
      const enText = terminationSection!.en.paragraphs.concat(terminationSection!.en.bullets || []).join(' ')

      // No unverified 30-day deletion countdown
      expect(arText).not.toContain('٣٠ يوماً')
      expect(arText).not.toContain('30 يوماً')
      expect(enText).not.toContain('30 days')

      expect(arText).toContain('الأرشفة')
      expect(enText).toContain('archived')
    })
  })

  describe('Privacy Policy Structure & Parity', () => {
    it('contains all 13 required sections in Privacy Policy', () => {
      expect(privacySections).toHaveLength(13)
      const expectedIds = [
        'scope',
        'categories',
        'purposes',
        'legal-basis',
        'sharing',
        'security',
        'retention',
        'rights',
        'cookies',
        'transfers',
        'third-party-policies',
        'updates',
        'contact',
      ]
      expect(privacySections.map((s) => s.id)).toEqual(expectedIds)
    })

    it('maintains strict bilingual parity across all Privacy sections', () => {
      for (const section of privacySections) {
        expect(section.number).toBeGreaterThan(0)
        expect(section.ar.title.trim().length).toBeGreaterThan(0)
        expect(section.en.title.trim().length).toBeGreaterThan(0)
        expect(section.ar.paragraphs.length).toBeGreaterThan(0)
        expect(section.en.paragraphs.length).toBeGreaterThan(0)

        expect(/[\u0600-\u06FF]/.test(section.ar.title)).toBe(true)
        expect(/[a-zA-Z]/.test(section.en.title)).toBe(true)
      }
    })

    it('delineates Controller vs Processor roles clearly in both languages', () => {
      const scopeSection = privacySections.find((s) => s.id === 'scope')
      expect(scopeSection).toBeDefined()
      const arText = scopeSection!.ar.paragraphs.concat(scopeSection!.ar.bullets || []).join(' ')
      const enText = scopeSection!.en.paragraphs.concat(scopeSection!.en.bullets || []).join(' ')

      expect(arText).toContain('Data Controller')
      expect(arText).toContain('Data Processor')
      expect(enText).toContain('Data Controller')
      expect(enText).toContain('Data Processor')
    })

    it('accurately lists real technical infrastructure and security mechanisms', () => {
      const securitySection = privacySections.find((s) => s.id === 'security')
      expect(securitySection).toBeDefined()
      const arText = securitySection!.ar.paragraphs.concat(securitySection!.ar.bullets || []).join(' ')
      const enText = securitySection!.en.paragraphs.concat(securitySection!.en.bullets || []).join(' ')

      expect(arText).toContain('TLS/SSL')
      expect(arText).toContain('AES-256-GCM')
      expect(arText).toContain('HKDF')

      expect(enText).toContain('TLS/SSL')
      expect(enText).toContain('AES-256-GCM')
      expect(enText).toContain('HKDF')
    })

    it('disclaims advertising cookies and lists real session cookies', () => {
      const cookieSection = privacySections.find((s) => s.id === 'cookies')
      expect(cookieSection).toBeDefined()
      const arText = cookieSection!.ar.paragraphs.concat(cookieSection!.ar.bullets || []).join(' ')
      const enText = cookieSection!.en.paragraphs.concat(cookieSection!.en.bullets || []).join(' ')

      expect(arText).toContain('Clerk')
      expect(arText).toContain('lang')
      expect(enText).toContain('Clerk')
      expect(enText).toContain('lang')
    })
  })

  describe('UI & Navigation Accessibility Components', () => {
    const tocSource = read('src', 'components', 'legal', 'legal-toc.tsx')

    it('implements a sticky, full-width Table of Contents navigation bar', () => {
      expect(tocSource).toContain('sticky top-14 z-40 w-full')
      expect(tocSource).toContain('max-w-7xl mx-auto')
      expect(tocSource).toContain('overflow-x-auto')
      expect(termsPageSource).toContain('<LegalTableOfContents')
      expect(privacyPageSource).toContain('<LegalTableOfContents')
      expect(termsPageSource).toContain('scroll-mt-36')
      expect(privacyPageSource).toContain('scroll-mt-36')
    })

    it('integrates Table of Contents, metadata, and cross-links in page templates', () => {
      expect(termsPageSource).toContain('LegalTableOfContents')
      expect(termsPageSource).toContain("publicPageMetadata('/terms')")
      expect(termsPageSource).toContain('href="/privacy"')

      expect(privacyPageSource).toContain('LegalTableOfContents')
      expect(privacyPageSource).toContain("publicPageMetadata('/privacy')")
      expect(privacyPageSource).toContain('href="/terms"')
    })

    it('ensures contact form links and mailto endpoints are properly formed', () => {
      expect(termsPageSource).toContain('href="/contact"')
      expect(termsPageSource).toContain('mailto:${PUBLIC_CONTACT_EMAIL}')

      expect(privacyPageSource).toContain('href="/contact"')
      expect(privacyPageSource).toContain('mailto:${PUBLIC_CONTACT_EMAIL}')
    })
  })
})
