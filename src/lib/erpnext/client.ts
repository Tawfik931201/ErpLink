import { runErpCreateEffect } from '@/lib/erp-effect-context';

export class ErpNextClient {
  private url: string
  private authHeader: string

  constructor(params: { url: string; username: string; apiKey: string }) {
    this.url = params.url.replace(/\/+$/, '')
    this.authHeader = `token ${params.username.trim()}:${params.apiKey.trim()}`
  }

  async search(docType: string, filters: any[][]): Promise<string[]> {
    const filtersStr = JSON.stringify(filters)
    const url = `${this.url}/api/resource/${encodeURIComponent(docType)}?filters=${encodeURIComponent(filtersStr)}&fields=%5B%22name%22%5D&limit_page_length=1`

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`ERPNext search failed with HTTP ${res.status}: ${res.statusText}`)
    }

    const json = await res.json()
    const data = json?.data
    if (!Array.isArray(data) || data.some((row: any) => typeof row?.name !== 'string' || !row.name.trim())) {
      throw new Error('ERPNext search returned an invalid record list')
    }
    return data.map((row: { name: string }) => row.name)
  }

  async create(docType: string, values: any): Promise<string> {
    return runErpCreateEffect(docType, values, () => this.createRequest(docType, values),
      error => !!error && typeof error === 'object' && 'erpRejected' in error,
      id => id)
  }

  private async createRequest(docType: string, values: any): Promise<string> {
    const url = `${this.url}/api/resource/${encodeURIComponent(docType)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      const error = new Error(`ERPNext create failed with HTTP ${res.status}: ${errText || res.statusText}`)
      // A 5xx/proxy timeout cannot establish whether the write committed.
      if ([400, 401, 403, 404, 409, 417, 422].includes(res.status)) Object.assign(error, { erpRejected: true })
      throw error
    }

    const json = await res.json()
    const name = json?.data?.name
    if (typeof name !== 'string' || !name.trim()) {
      // A successful HTTP response without a record identifier does not
      // establish whether a create committed. Do not report success.
      throw new Error('ERPNext create returned no record identifier')
    }
    return name
  }

  async update(docType: string, name: string, values: any): Promise<boolean> {
    const url = `${this.url}/api/resource/${encodeURIComponent(docType)}/${encodeURIComponent(name)}`

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext update failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    return true
  }

  async delete(docType: string, name: string): Promise<boolean> {
    const url = `${this.url}/api/resource/${encodeURIComponent(docType)}/${encodeURIComponent(name)}`

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext delete failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    return true
  }
}
