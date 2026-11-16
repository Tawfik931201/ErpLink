export async function enrichSallaCustomer(
  data: Record<string, unknown>,
  storeIdStr: string,
  entityId: unknown,
  isLegacyDelivery: boolean,
): Promise<Record<string, unknown>> {
  const { getSallaCustomer } = await import('@/lib/salla-client')
  const full = await getSallaCustomer(storeIdStr, String(entityId))
  if (full) data = isLegacyDelivery ? { ...data, ...full } : { ...full, ...data }
  return data
}
