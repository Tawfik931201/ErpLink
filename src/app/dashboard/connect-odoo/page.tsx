import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import OdooConnectionForm from './odoo-form'
import { Language, translations } from '@/lib/translations'

export const metadata: Metadata = {
  title: 'Connect with ERP — ZidLink',
  description: 'إدارة وتوصيل متجرك بنظام الـ ERP',
}

export default async function ConnectOdooPage() {
  const odooRes = await getActiveWorkspaceErpConnection()
  
  // Strip password/apiKey on the server side to prevent sending the cipher key to client/inspect
  let connection = null
  if (odooRes.success && odooRes.connection) {
    const { password, ...safeConnection } = odooRes.connection
    connection = safeConnection
  }

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div>
        <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          {t('odoo.title')}
        </h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('odoo.desc')}
        </p>
      </div>

      <OdooConnectionForm initialConnection={connection} />
    </div>
  )
}
