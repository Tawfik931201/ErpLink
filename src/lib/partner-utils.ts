import { randomBytes, createHash } from 'crypto'

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashPdfSha256(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function generateActivationExpiry(days: number = 14): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

export function isInvitationExpired(expiresAt: Date | string): boolean {
  const expires = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return expires.getTime() < Date.now()
}

export interface CommissionCalcInput {
  grossAmount: number
  rate: number
}

export function calculateCommissionAmount({ grossAmount, rate }: CommissionCalcInput): number {
  const amount = Number(grossAmount) || 0
  const r = Number(rate) || 0
  return Math.round(amount * r * 100) / 100
}

export function roundCurrency(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
