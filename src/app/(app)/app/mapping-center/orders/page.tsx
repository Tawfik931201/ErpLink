import { Suspense } from 'react'

import OrderDashboardClient from './order-dashboard-client'

export const metadata = {
  title: 'Order Sync Dashboard — ErpLink',
}

export default function OrderDashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
      <OrderDashboardClient />
    </Suspense>
  )
}
