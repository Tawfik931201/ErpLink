import {
  agentIntegrationList,
  agentGuideList,
  agentDocsList,
  isAgentPublicPath,
  publicMarkdown,
} from '@/lib/public-agent-content'

/**
 * Intentionally public, stateless, read-only. No request is forwarded to the
 * application's authenticated APIs, Supabase, Odoo, Zid or Shopify.
 */
export const PUBLIC_MCP_NAME = 'com.bizsahla.erplink/public'
export const PUBLIC_MCP_VERSION = '1.0.0'
export const PUBLIC_MCP_PROTOCOL = '2025-06-18'

type RpcId = string | number | null
type RpcResponse = { jsonrpc: '2.0'; id: RpcId; result?: unknown; error?: { code: number; message: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const tools = [
  {
    name: 'list_public_integrations',
    title: 'List ERP Link integrations',
    description: 'List ERP Link public Zid, Salla and Shopify integration guides for Odoo.',
    inputSchema: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['ar', 'en'], description: 'Guide language.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_public_guides',
    title: 'List ERP Link knowledge guides',
    description: 'List ERP Link public integration and setup guides for Zid, Salla, Shopify and Odoo.',
    inputSchema: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['ar', 'en'], description: 'Guide language.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_public_docs',
    title: 'List ERP Link documentation',
    description: 'List official ERP Link documentation guides and sections for Zid, Salla, Shopify, and Odoo.',
    inputSchema: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['ar', 'en'], description: 'Documentation language.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'read_public_page',
    title: 'Read ERP Link public information',
    description: 'Read curated public marketing, integration, documentation, and testing content. No private account information.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'One of the explicitly published marketing, guide, or documentation paths.',
        },
        language: { type: 'string', enum: ['ar', 'en'], description: 'Content language.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
] as const

function success(id: RpcId, result: unknown): RpcResponse { return { jsonrpc: '2.0', id, result } }
function failure(id: RpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function handlePublicMcp(input: unknown): RpcResponse | null {
  if (!isRecord(input) || input.jsonrpc !== '2.0' || typeof input.method !== 'string') {
    return failure(null, -32600, 'Invalid JSON-RPC request')
  }
  const idValue = input.id
  const notification = !Object.prototype.hasOwnProperty.call(input, 'id')
  if (!notification && idValue !== null && typeof idValue !== 'string' && typeof idValue !== 'number') {
    return failure(null, -32600, 'Invalid request id')
  }
  if (notification) return null

  const id = idValue as RpcId
  if (input.method === 'initialize') {
    return success(id, {
      protocolVersion: PUBLIC_MCP_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: PUBLIC_MCP_NAME, version: PUBLIC_MCP_VERSION },
      instructions: 'Public read-only information about ERP Link. Never use this endpoint for customer, store, order, payment, invoice or workspace data.',
    })
  }
  if (input.method === 'ping') return success(id, {})
  if (input.method === 'tools/list') return success(id, { tools })

  if (input.method === 'tools/call') {
    const params = input.params
    if (!isRecord(params) || typeof params.name !== 'string') return failure(id, -32602, 'Missing tool name')
    const args = params.arguments === undefined ? {} : params.arguments
    if (!isRecord(args)) return failure(id, -32602, 'Invalid tool arguments')
    const language = args.language === undefined ? 'ar' : args.language
    if (language !== 'ar' && language !== 'en') return failure(id, -32602, 'Invalid language')

    if (params.name === 'list_public_integrations') {
      if (Object.keys(args).some((key) => key !== 'language')) return failure(id, -32602, 'Unknown argument')
      return success(id, { content: [{ type: 'text', text: JSON.stringify(agentIntegrationList(language)) }], isError: false })
    }
    if (params.name === 'list_public_guides') {
      if (Object.keys(args).some((key) => key !== 'language')) return failure(id, -32602, 'Unknown argument')
      return success(id, { content: [{ type: 'text', text: JSON.stringify(agentGuideList(language)) }], isError: false })
    }
    if (params.name === 'list_public_docs') {
      if (Object.keys(args).some((key) => key !== 'language')) return failure(id, -32602, 'Unknown argument')
      return success(id, { content: [{ type: 'text', text: JSON.stringify(agentDocsList(language)) }], isError: false })
    }
    if (params.name === 'read_public_page') {
      const path = args.path
      if (typeof path !== 'string' || !isAgentPublicPath(path) ||
          Object.keys(args).some((key) => key !== 'language' && key !== 'path')) {
        return failure(id, -32602, 'Only listed public marketing paths are allowed')
      }
      return success(id, { content: [{ type: 'text', text: publicMarkdown(path, language) }], isError: false })
    }
    return failure(id, -32602, 'Unknown public tool')
  }
  return failure(id, -32601, 'Method not found')
}
