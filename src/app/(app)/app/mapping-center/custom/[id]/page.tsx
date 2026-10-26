import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'

import { getFieldMappingById } from '@/app/actions/field-mappings'
import { resolveLanguage } from '@/lib/translations'

import CustomMappingDetailClient from './custom-mapping-detail-client'

export const metadata: Metadata = {
  title: 'تفاصيل تخصيص الربط — مركز الربط — ErpLink',
  description: 'عرض وتعديل تفاصيل ربط الحقول المخصصة',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CustomMappingDetailPage({ params }: PageProps) {
  const { id } = await params
  const res = await getFieldMappingById(id)

  if (!res.success || !res.mapping) {
    notFound()
  }

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <CustomMappingDetailClient mapping={res.mapping} lang={lang} dir={dir} />
    </div>
  )
}
