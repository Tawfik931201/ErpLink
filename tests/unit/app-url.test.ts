import { NextRequest } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'

describe('getAppBaseUrl', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.NEXTAUTH_URL
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('prefers NEXT_PUBLIC_APP_URL when configured', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/'
    const req = new NextRequest('http://0.0.0.0:3000/api/zid/connect')
    expect(getAppBaseUrl(req)).toBe('https://app.example.com')
  })

  it('uses NEXTAUTH_URL when NEXT_PUBLIC_APP_URL is absent', () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com/'
    const req = new NextRequest('http://0.0.0.0:3000/api/zid/connect')
    expect(getAppBaseUrl(req)).toBe('https://auth.example.com')
  })

  it('resolves x-forwarded-host and x-forwarded-proto from reverse proxy', () => {
    const req = new NextRequest('http://0.0.0.0:3000/api/zid/connect', {
      headers: {
        'x-forwarded-host': 'dashboard.erplink.sa',
        'x-forwarded-proto': 'https',
      },
    })
    expect(getAppBaseUrl(req)).toBe('https://dashboard.erplink.sa')
  })

  it('resolves host header when no forwarded headers exist', () => {
    const req = new NextRequest('http://0.0.0.0:3000/api/zid/connect', {
      headers: {
        host: 'dashboard.erplink.sa',
      },
    })
    expect(getAppBaseUrl(req)).toBe('https://dashboard.erplink.sa')
  })

  it('never returns 0.0.0.0 even if internal request was bound to 0.0.0.0', () => {
    const req = new NextRequest('http://0.0.0.0:3000/api/zid/connect', {
      headers: {
        host: '0.0.0.0:3000',
      },
    })
    const url = getAppBaseUrl(req)
    expect(url).not.toContain('0.0.0.0')
    expect(url).toBe('http://localhost:3000')
  })
})
