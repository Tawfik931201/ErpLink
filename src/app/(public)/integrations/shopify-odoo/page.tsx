import { PublicIntegrationDetail } from '@/components/public-integration-detail'
import { publicPageMetadata } from '@/lib/public-seo'

export const generateMetadata = () => publicPageMetadata('/integrations/shopify-odoo')

export default function ShopifyOdooIntegrationPage() {
  return <PublicIntegrationDetail platform="shopify" />
}
