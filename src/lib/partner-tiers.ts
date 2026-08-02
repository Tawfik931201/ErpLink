export type PartnerTier = 'starter' | 'growth' | 'gold'
export type PartnerStatus = 'pending' | 'active' | 'suspended' | 'rejected'

export interface PartnerTierConfig {
  key: PartnerTier
  labelAr: string
  labelEn: string
  maxClients: number | null
  commissionRate: number
}

export const PARTNER_TIERS: Record<PartnerTier, PartnerTierConfig> = {
  starter: {
    key: 'starter',
    labelAr: 'مبتدئ',
    labelEn: 'Starter',
    maxClients: 50,
    commissionRate: 0.15,
  },
  growth: {
    key: 'growth',
    labelAr: 'نمو',
    labelEn: 'Growth',
    maxClients: 200,
    commissionRate: 0.2,
  },
  gold: {
    key: 'gold',
    labelAr: 'ذهبي',
    labelEn: 'Gold',
    maxClients: null,
    commissionRate: 0.3,
  },
}

export const DEFAULT_PARTNER_TIER: PartnerTier = 'starter'

export function isPartnerTier(value: unknown): value is PartnerTier {
  return value === 'starter' || value === 'growth' || value === 'gold'
}

export function getTierConfig(tier: string | null | undefined): PartnerTierConfig {
  if (isPartnerTier(tier)) return PARTNER_TIERS[tier]
  return PARTNER_TIERS[DEFAULT_PARTNER_TIER]
}

export function formatCommissionRate(rate: number | string): string {
  const num = typeof rate === 'string' ? Number(rate) : rate
  if (!Number.isFinite(num)) return '0%'
  return `${Math.round(num * 100)}%`
}

export function tierLabel(tier: string | null | undefined, lang: 'ar' | 'en' = 'ar'): string {
  const t = getTierConfig(tier)
  return lang === 'ar' ? t.labelAr : t.labelEn
}
