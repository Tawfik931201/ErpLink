import axios from 'axios'

export interface SallaTokenRow {
  merchant_id: string
  access_token: string
  refresh_token: string
  expires_in: number | null
  updated_at: string
}

/**
 * Refreshes Salla access token and updates the database.
 */
export async function refreshSallaToken(merchantId: string, refreshToken: string): Promise<string> {
  console.info(`[SallaClient] Refreshing token for merchant="${merchantId}"...`)
  const clientId = process.env.SALLA_CLIENT_ID
  const clientSecret = process.env.SALLA_CLIENT_SECRET
  const redirectUri = process.env.SALLA_REDIRECT_URI

  if (!clientId || !clientSecret) {
    throw new Error('Salla Client ID or Secret is not configured in env variables.')
  }

  try {
    const response = await axios.post(
      'https://accounts.salla.sa/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        redirect_uri: redirectUri || '',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    const { access_token, refresh_token, expires_in } = response.data

    // Update in Supabase
    const { error } = await supabase
      .from('salla_tokens')
      .update({
        access_token,
        refresh_token,
        expires_in: expires_in ? BigInt(expires_in) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('merchant_id', merchantId)

    if (error) {
      throw new Error(`Failed to update refreshed Salla token in database: ${error.message}`)
    }

    console.info(`[SallaClient] Token refreshed successfully for merchant="${merchantId}"`)
    return access_token
  } catch (err: any) {
    console.error(`[SallaClient] Failed to refresh Salla token:`, err.response?.data || err.message)
    throw new Error(`Failed to refresh Salla OAuth token: ${err.message}`)
  }
}

/**
 * Gets a valid access token for the given Salla merchant.
 * Auto-refreshes if the token is close to expiry or expired.
 */
export async function getSallaAccessToken(merchantId: string): Promise<string> {
  const { data: sallaToken, error } = await supabase
    .from('salla_tokens')
    .select('*')
    .eq('merchant_id', merchantId)
    .maybeSingle()

  if (error || !sallaToken) {
    throw new Error(`Salla token not found for merchant ID: ${merchantId}`)
  }

  const { access_token, refresh_token, expires_in, updated_at } = sallaToken as unknown as SallaTokenRow

  if (!expires_in) {
    return access_token
  }

  // Calculate if token is expired or close to expiry (within 5 minutes)
  const updatedAtTime = new Date(updated_at).getTime()
  const expiresAtTime = updatedAtTime + Number(expires_in) * 1000
  const timeBuffer = 5 * 60 * 1000 // 5 minutes buffer
  const isExpired = Date.now() + timeBuffer > expiresAtTime

  if (isExpired) {
    return refreshSallaToken(merchantId, refresh_token)
  }

  return access_token
}

/**
 * Helper to call Salla Merchant API.
 */
async function callSallaApi(merchantId: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', endpoint: string, data?: any) {
  const token = await getSallaAccessToken(merchantId)
  const url = `https://api.salla.dev/admin/v2${endpoint}`

  try {
    const response = await axios({
      method,
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      data,
    })
    return response.data
  } catch (err: any) {
    console.error(`[SallaClient] API Error on ${method} ${endpoint}:`, err.response?.data || err.message)
    throw err
  }
}

/**
 * Finds a product in Salla by matching a specific field.
 */
export async function findSallaProductByMatchField(
  merchantId: string,
  matchField: string,
  value: string
): Promise<any | null> {
  console.info(`[SallaClient] Searching product by ${matchField}="${value}"...`)
  
  if (matchField === 'id') {
    try {
      const res = await callSallaApi(merchantId, 'GET', `/products/${value}`)
      return res.data
    } catch {
      return null
    }
  }

  // Query products list. We can use sku filter parameter if Odoo is matching sku.
  // Salla API: GET /products?sku=SKU_VALUE
  const queryParam = matchField === 'sku' ? `?sku=${encodeURIComponent(value)}` : `?keyword=${encodeURIComponent(value)}`
  
  try {
    const res = await callSallaApi(merchantId, 'GET', `/products${queryParam}`)
    const products = res.data || []
    
    // Exact match filter just to be double safe
    const match = products.find((p: any) => {
      if (matchField === 'sku') return String(p.sku || '').trim() === value.trim()
      if (matchField === 'barcode') return String(p.barcode || '').trim() === value.trim()
      return false
    })
    
    return match || null
  } catch (err) {
    console.error(`[SallaClient] Failed to search product:`, err)
    return null
  }
}

/**
 * Updates a product in Salla.
 */
export async function updateSallaProduct(merchantId: string, sallaProductId: string, data: any) {
  console.info(`[SallaClient] Updating product ID="${sallaProductId}" in Salla...`)
  return callSallaApi(merchantId, 'PUT', `/products/${sallaProductId}`, data)
}
