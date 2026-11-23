import { PublicIntegrationDetail } from '@/components/public-integration-detail'
import { publicPageMetadata } from '@/lib/public-seo'

export const generateMetadata = () => publicPageMetadata('/integrations/salla-odoo')

export default function SallaOdooIntegrationPage() {
  return <PublicIntegrationDetail platform="salla" />
}
