import { Suspense } from 'react'

import LogsClient from './logs-client'

export const metadata = {
  title: 'Sync Logs — ErpLink',
}

export default function LogsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
      <LogsClient />
    </Suspense>
  )
}
