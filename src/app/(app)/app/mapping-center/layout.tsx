import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'مركز الربط',
  description: 'إدارة ربط الحقول والطلبات بين زد وأودو',
}

export default function MappingCenterLayout({ children }: { children: React.ReactNode }) {
  return children
}
