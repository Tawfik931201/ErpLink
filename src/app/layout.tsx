import type { Metadata } from 'next'
import { Tajawal, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import { Language } from '@/lib/translations'

import Providers from '@/components/providers'

import './globals.css'

const tajawal = Tajawal({
  subsets: ['arabic'],
  weight: ['300', '400', '500', '700', '800', '900'],
  variable: '--font-tajawal',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'ZidLink — Connect Odoo & Zid',
    template: '%s | ZidLink',
  },
  description:
    'The easiest way to synchronise your Zid e-commerce store with Odoo ERP. Automate products, orders, customers and inventory in real time.',
  keywords: ['Zid', 'Odoo', 'integration', 'sync', 'e-commerce', 'ERP', 'SaaS'],
  authors: [{ name: 'ZidLink' }],
  openGraph: {
    title: 'ZidLink — Connect Odoo & Zid',
    description: 'Real-time sync between your Zid store and Odoo ERP.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <body className={`${tajawal.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers initialLang={lang}>{children}</Providers>
      </body>
    </html>
  )
}
