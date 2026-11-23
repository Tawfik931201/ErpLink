import { NextResponse, type NextRequest } from 'next/server'
import { isAgentPublicPath, publicMarkdown } from '@/lib/public-agent-content'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Static-equivalent, curated PUBLIC content only. Never proxy or convert
 * arbitrary URLs, private HTML, authenticated pages or customer data.
 */
export function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('page') ?? ''
  const language = request.nextUrl.searchParams.get('lang')
  if (!isAgentPublicPath(path) || (language !== 'ar' && language !== 'en')) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
  }

  const markdown = publicMarkdown(path, language)
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Vary': 'Accept',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
