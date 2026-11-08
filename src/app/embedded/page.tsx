import EmbeddedStorageGate from '@/components/embedded-storage-gate'

import EmbeddedLaunch from './embedded-launch'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Zid — ErpLink', referrer: 'no-referrer' }

export default function EmbeddedPage() {
  return <main className="flex min-h-dvh w-full items-center justify-center p-4">
    <EmbeddedStorageGate><EmbeddedLaunch /></EmbeddedStorageGate>
  </main>
}
