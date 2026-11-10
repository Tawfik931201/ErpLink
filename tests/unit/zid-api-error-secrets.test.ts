import { inspect } from 'util'

import { AxiosError, AxiosHeaders } from 'axios'

import { zidClient } from '../../src/lib/zid-client'

jest.mock('../../src/lib/auth', () => ({ checkImpersonationWriteBlock: async () => {} }))

it('retains API status/body for retry handling without exposing credentials in logs', async () => {
  const config = { headers: new AxiosHeaders({ Authorization: 'Bearer secret-partner-token',
    'X-Manager-Token': 'secret-store-token', 'Access-Token': 'secret-store-token' }) }
  const adapter = async () => { throw new AxiosError('HTTP 429', 'ERR_BAD_RESPONSE', config,
    { rawHeader: 'secret-store-token' }, { status: 429, statusText: 'Too Many Requests',
      headers: { 'retry-after': '5' }, data: { message: 'Slow down', reflected: 'secret-store-token' }, config }) }
  try {
    await zidClient.get('/offline-test', { adapter })
    throw new Error('Expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(AxiosError)
    const result = error as AxiosError<{ message: string }>
    expect(result.response?.status).toBe(429)
    expect(result.response?.data.message).toBe('Slow down')
    expect(result.response?.headers['retry-after']).toBe('5')
    for (const output of [inspect(error, { depth: 8 }), JSON.stringify(error), JSON.stringify(result.response)]) {
      expect(output).not.toContain('secret-store-token')
      expect(output).not.toContain('secret-partner-token')
    }
  }
})
