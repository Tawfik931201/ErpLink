'use client'

import { Printer } from 'lucide-react'

interface Props {
  lang: string
}

export default function PrintPayoutButton({ lang }: Props) {
  const isAr = lang === 'ar'

  return (
    <>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-8 text-[11px] font-medium text-foreground hover:bg-muted transition-colors no-print"
      >
        <Printer className="h-3.5 w-3.5" />
        {isAr ? 'طباعة PDF' : 'Print PDF'}
      </button>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }

          @page {
            margin: 0;
          }

          header {
            display: none !important;
          }

          main {
            padding: 1.5rem 2rem !important;
          }

          body {
            background-color: #ffffff !important;
            color: #111827 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          :root,
          html.dark {
            --background: 0 0% 100% !important;
            --foreground: 220 25% 10% !important;
            --card: 0 0% 100% !important;
            --card-foreground: 220 25% 10% !important;
            --popover: 0 0% 100% !important;
            --popover-foreground: 220 25% 10% !important;
            --secondary: 220 14% 96% !important;
            --secondary-foreground: 220 9% 46% !important;
            --muted: 220 14% 96% !important;
            --muted-foreground: 220 9% 46% !important;
            --border: 220 13% 91% !important;
            --input: 220 13% 91% !important;
            --ring: 221 83% 53% !important;
          }

          .payout-grid {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 0.75rem 1.5rem !important;
          }
        }
      `}</style>
    </>
  )
}
