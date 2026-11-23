import { NextResponse, type NextRequest } from 'next/server'

import { handlePublicMcp } from '@/lib/public-mcp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8192
const responseHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}

function jsonResponse(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: responseHeaders })
}

async function boundedJson(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') || '0')
  if (declared > MAX_BODY_BYTES) throw new Error('too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('empty_body')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('too_large')
    }
    chunks.push(value)
  }
  const decoder = new TextDecoder()
  const text = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode()
  return JSON.parse(text)
}

/**
 * A stateless public MCP Streamable HTTP endpoint.
 * No sessions, authentication, database access or mutating tools.
 * GET/SSE is intentionally unsupported and returns HTTP 405 as allowed.
 */
export async function GET() {
  return new NextResponse('Server does not support SSE', {
    status: 405,
    headers: { ...responseHeaders, Allow: 'POST' },
  })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && origin !== 'https://erplink.bizsahla.com' &&
      !(process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d{2,5}$/.test(origin))) {
    return jsonResponse({ error: 'Forbidden origin' }, 403)
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
  }
  let input: unknown
  try {
    input = await boundedJson(request)
  } catch (error) {
    if (error instanceof Error && error.message === 'too_large') {
      return jsonResponse({ error: 'Request too large' }, 413)
    }
    return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }, 400)
  }
  // Batch JSON-RPC messages are not supported by this public endpoint.
  const result = handlePublicMcp(input)
  if (!result) return new NextResponse(null, { status: 202, headers: responseHeaders })
  return jsonResponse(result)
}
