import { readFileSync } from 'fs'
import path from 'path'

import {
  agentIntegrationList, isAgentPublicPath, publicMarkdown,
} from '@/lib/public-agent-content'
import { publicBusinessProfile } from '@/lib/public-business-profile'
import { handlePublicMcp, PUBLIC_MCP_NAME, PUBLIC_MCP_VERSION } from '@/lib/public-mcp'

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8')

describe('agent-ready public information remains isolated from ERP Link customer data', () => {
  it('only permits hardcoded marketing content; never private routes', () => {
    for (const value of ['/app', '/ar-sa/app/dashboard', '/api/webhooks/zid', '/admin', '/invoice', '/sign-in', '/privacy', '/terms', 'https://private.example/']) {
      expect(isAgentPublicPath(value)).toBe(false)
    }
    expect(isAgentPublicPath('/')).toBe(true)
    expect(isAgentPublicPath('/integrations/zid-odoo')).toBe(true)
    expect(publicMarkdown('/', 'ar')).toContain('ERP Link')
    expect(publicMarkdown('/integrations/zid-odoo', 'ar')).toContain('المرتجع')
    expect(publicMarkdown('/integrations/shopify-odoo', 'en')).toContain('Shopify')
    expect(agentIntegrationList('en')).toHaveLength(3)
  })

  it('implements an actual read-only MCP protocol handler and refuses other operations', () => {
    const initialize = handlePublicMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(initialize).toEqual(expect.objectContaining({
      id: 1,
      result: expect.objectContaining({
        serverInfo: { name: PUBLIC_MCP_NAME, version: PUBLIC_MCP_VERSION },
        capabilities: { tools: { listChanged: false } },
      }),
    }))
    const list = handlePublicMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list).toEqual(expect.objectContaining({ id: 2, result: { tools: expect.any(Array) } }))
    const readOnly = handlePublicMcp({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'read_public_page', arguments: { path: '/integrations/zid-odoo', language: 'ar' } },
    })
    expect(JSON.stringify(readOnly)).toContain('ربط زد بأودوو')
    for (const privatePath of ['/app', '/api/webhooks/zid', '/admin', '/ar-sa/app/dashboard']) {
      expect(handlePublicMcp({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'read_public_page', arguments: { path: privatePath } },
      })).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: -32602 }) }))
    }
    expect(handlePublicMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'update_order', arguments: {} } }))
      .toEqual(expect.objectContaining({ error: expect.objectContaining({ code: -32602 }) }))
    expect(handlePublicMcp({ jsonrpc: '2.0', id: 6, method: 'resources/list' }))
      .toEqual(expect.objectContaining({ error: expect.objectContaining({ code: -32601 }) }))
    expect(handlePublicMcp({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('publishes verified sameAs links only, ignoring unrelated business-environment fields', () => {
    const keys = [
      'PUBLIC_BUSINESS_PHONE_E164', 'PUBLIC_BUSINESS_ADDRESS_CITY',
      'PUBLIC_BUSINESS_ADDRESS_COUNTRY', 'PUBLIC_BUSINESS_SAME_AS',
    ]
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    try {
      keys.forEach((key) => delete process.env[key])
      expect(publicBusinessProfile()).toEqual({ sameAs: [] })
      process.env.PUBLIC_BUSINESS_PHONE_E164 = '+201234567890'
      process.env.PUBLIC_BUSINESS_ADDRESS_CITY = 'Cairo'
      process.env.PUBLIC_BUSINESS_ADDRESS_COUNTRY = 'EG'
      process.env.PUBLIC_BUSINESS_SAME_AS = 'https://evil.example/erp-link,http://linkedin.com/company/erplink'
      expect(publicBusinessProfile()).toEqual({ sameAs: [] })
      process.env.PUBLIC_BUSINESS_SAME_AS = 'https://www.linkedin.com/company/example-verified-business/'
      expect(publicBusinessProfile()).toEqual({
        sameAs: ['https://www.linkedin.com/company/example-verified-business/'],
      })
    } finally {
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key]
        else process.env[key] = before[key]
      }
    }
  })

  it('keeps the Server Card consistent with the real endpoint and protocol', () => {
    const card = JSON.parse(read('public', '.well-known', 'mcp', 'server-card.json'))
    const catalog = JSON.parse(read('public', '.well-known', 'ai-catalog.json'))
    expect(card.name).toBe(PUBLIC_MCP_NAME)
    expect(card.version).toBe(PUBLIC_MCP_VERSION)
    expect(card.remotes[0].url).toBe('https://erplink.bizsahla.com/api/public-mcp')
    expect(card.remotes[0].type).toBe('streamable-http')
    expect(catalog.entries[0].url).toBe('https://erplink.bizsahla.com/.well-known/mcp/server-card.json')
    const endpoint = read('src', 'app', 'api', 'public-mcp', 'route.ts')
    expect(endpoint).toContain('handlePublicMcp(input)')
    expect(endpoint).toContain('MAX_BODY_BYTES')
    expect(endpoint).not.toContain("from '@/lib/supabase")
    expect(endpoint).not.toContain('odooExecute')
    expect(endpoint).not.toContain('createClient(')
  })

  it('has an opt-in markdown Accept branch and browser-only read-only WebMCP tools', () => {
    const middleware = read('src', 'middleware.ts')
    const browser = read('public', 'agent-tools.js')
    const api = read('src', 'app', 'api', 'public-markdown', 'route.ts')
    expect(middleware).toContain("req.method === 'GET'")
    expect(middleware).toContain('isAgentPublicPath(publicPath)')
    expect(middleware).toContain("type === 'text/markdown'")
    expect(api).toContain("'Content-Type': 'text/markdown; charset=utf-8'")
    expect(browser).toContain('document.modelContext.registerTool')
    expect(browser).toContain('readOnlyHint: true')
    expect(browser).not.toContain('navigator.modelContext')
    expect(browser).not.toContain('/api/')
    expect(browser).not.toContain('fetch(')
    expect(browser).not.toContain('submitContact')
  })
})
