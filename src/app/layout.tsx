import { ClerkProvider } from '@clerk/nextjs'
import type { Metadata } from 'next'
import { Tajawal, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'

import AppProviders from '@/components/app-providers'
import type { Language } from '@/lib/translations'

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
    default: 'ErpLink — Connect Odoo & Zid',
    template: '%s | ErpLink',
  },
  description:
    'The easiest way to synchronise your Zid e-commerce store with Odoo ERP. Automate products, orders, customers and inventory in real time.',
  keywords: ['Zid', 'Odoo', 'integration', 'sync', 'e-commerce', 'ERP', 'SaaS'],
  authors: [{ name: 'ErpLink' }],
  openGraph: {
    title: 'ErpLink — Connect Odoo & Zid',
    description: 'Real-time sync between your Zid store and Odoo ERP.',
    type: 'website',
  },
  icons: {
    icon: [
      { url: '/favicon.ico?v=3', sizes: 'any' },
      { url: '/favicon-32x32.png?v=3', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-16x16.png?v=3', type: 'image/png', sizes: '16x16' },
      { url: '/icon.png?v=3', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png?v=3' }],
    shortcut: ['/favicon.ico?v=3'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <ClerkProvider>
      <html lang={lang} dir={dir} suppressHydrationWarning>
        <head>
          <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=3" />
          <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=3" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3" />
          <link rel="shortcut icon" href="/favicon.ico?v=3" />
        </head>
        <body className={`${tajawal.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
          <AppProviders initialLang={lang}>{children}</AppProviders>
        </body>
      </html>
    </ClerkProvider>
  )
}
