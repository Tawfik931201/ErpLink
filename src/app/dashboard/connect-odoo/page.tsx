import type { Metadata } from 'next'

import { getActiveWorkspaceOdooConnection } from '@/app/actions/odoo'
import OdooConnectionForm from './odoo-form'

export const metadata: Metadata = {
  title: 'Connect with Odoo — ZidLink',
  description: 'إدارة وتوصيل متجرك بنظام أودو (Odoo ERP)',
}

export default async function ConnectOdooPage() {
  const odooRes = await getActiveWorkspaceOdooConnection()
  const connection = odooRes.success ? odooRes.connection : null

  return (
    <div className="space-y-6 animate-in fade-in duration-300" dir="rtl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          الاتصال بنظام أودو (Connect with Odoo)
        </h1>
        <p className="mt-2 text-muted-foreground">
          إدارة ربط متجرك بنظام أودو ERP وتخزين بيانات الاعتماد والمزامنة.
        </p>
      </div>

      <OdooConnectionForm initialConnection={connection} />
    </div>
  )
}
