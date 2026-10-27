import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { resolveLanguage } from '@/lib/translations'

import OdooConnectionForm from './odoo-form'

export const metadata: Metadata = {
  title: 'Connect with ERP — ErpLink',
  description: 'إدارة وتوصيل متجرك بنظام الـ ERP',
}

export default async function ConnectOdooPage() {
  const odooRes = await getActiveWorkspaceErpConnection()
  
  // Strip password/apiKey on the server side to prevent sending the cipher key to client/inspect
  let connection = null
  if (odooRes.success && odooRes.connection) {
    const safeConnection = { ...odooRes.connection }
    delete (safeConnection as any).password
    connection = safeConnection
  }

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="space-y-5 animate-in fade-in duration-300" dir={dir}>
      <OdooConnectionForm initialConnection={connection} />
    </div>
  )
}
