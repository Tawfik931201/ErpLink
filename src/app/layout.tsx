import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'

import Providers from '@/components/providers'

import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
