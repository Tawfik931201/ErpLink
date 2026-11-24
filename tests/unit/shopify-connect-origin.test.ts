/** @jest-environment node */
import { createHmac } from 'crypto'

import { NextRequest } from 'next/server'

import { GET } from '../../src/app/api/shopify/connect/route'

jest.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))

it('resumes the signed shop launch on the public origin after login behind a proxy', async () => {
  const previous = process.env
  process.env = { ...previous, NEXT_PUBLIC_APP_URL: 'https://erp.example', SHOPIFY_CLIENT_SECRET: 'test-secret' }
  try {
    const query = 'shop=demo.myshopify.com&timestamp=123'
    const signature = createHmac('sha256', 'test-secret').update(query).digest('hex')
    const path = '/api/shopify/connect?' + query + '&hmac=' + signature
    const response = await GET(new NextRequest('http://0.0.0.0:3000' + path))
    const login = new URL(response.headers.get('location')!)
    expect(login.origin + login.pathname).toBe('https://erp.example/sign-in')
    expect(login.searchParams.get('redirect_url')).toBe('https://erp.example' + path)
  } finally {
    process.env = previous
  }
})
