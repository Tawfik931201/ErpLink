import { PublicIntegrationDetail } from '@/components/public-integration-detail'
import { publicPageMetadata } from '@/lib/public-seo'

export const generateMetadata = () => publicPageMetadata('/integrations/zid-odoo')

export default function ZidOdooIntegrationPage() {
  return <PublicIntegrationDetail platform="zid" />
}
