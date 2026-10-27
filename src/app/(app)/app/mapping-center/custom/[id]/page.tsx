import { ArrowLeft, ArrowRight, FileQuestion } from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getFieldMappingById, getFieldMappings } from '@/app/actions/field-mappings'
import { resolveLanguage } from '@/lib/translations'

import {
  getFirstStoreId,
  getMappingCenterConnection,
  getMappingCenterModels,
  getMappingCenterPreloadedFields,
} from '../../mapping-center-data'

import MappingDetailClient from './mapping-detail-client'

export const metadata: Metadata = {
  title: 'Custom Mapping — ErpLink',
}

export default async function CustomMappingDetailPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const ar = lang === 'ar'

  const res = await getFieldMappingById(id)

  if (!res.success || !res.mapping) {
    const BackIcon = ar ? ArrowRight : ArrowLeft
    return (
      <div className="space-y-4">
        <Link
          href="/app/mapping-center/custom"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى تخصيص الربط' : 'Back to custom mapping'}
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {ar ? 'الربط غير موجود' : 'Mapping not found'}
          </p>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            {ar
              ? 'قد يكون هذا الربط قد حُذف، أو أنه يخص مساحة عمل أخرى.'
              : 'This mapping may have been deleted, or it belongs to another workspace.'}
          </p>
        </div>
      </div>
    )
  }

  // The edit form is reused from the list page, so it needs the same inputs:
  // the Odoo model catalogue, the first-model fields, the store lists and the
  // sibling mappings (duplicate-name / relation checks).
  const { erpType, hasErpConnection, zidStores, sallaStores, shopifyStores } =
    await getMappingCenterConnection()
  const initialModels = await getMappingCenterModels(hasErpConnection)
  const { preloadedModel, preloadedFields } = await getMappingCenterPreloadedFields(initialModels)
  const allRes = await getFieldMappings()

  return (
    <div className="w-full max-w-[95%] mx-auto animate-in fade-in duration-300" dir={ar ? 'rtl' : 'ltr'}>
      <MappingDetailClient
        mapping={res.mapping}
        initialModels={initialModels || []}
        preloadedModel={preloadedModel}
        preloadedFields={preloadedFields}
        allMappings={allRes.success ? (allRes.mappings || []) : []}
        hasOdooConnection={hasErpConnection}
        erpType={erpType}
        zidStores={zidStores}
        sallaStores={sallaStores}
        shopifyStores={shopifyStores}
        defaultStoreKey={getFirstStoreId(zidStores, sallaStores, shopifyStores)}
      />
    </div>
  )
}