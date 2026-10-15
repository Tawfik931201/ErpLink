import { Suspense } from 'react'

import QueueClient from './queue-client'

export const metadata = {
  title: 'Send Queue — ErpLink',
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
      <QueueClient />
    </Suspense>
  )
}
