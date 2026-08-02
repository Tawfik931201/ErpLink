import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isAdmin } from '@/lib/auth'
import { cookies } from 'next/headers'

/**
 * API route to start user impersonation.
 * URL: /api/admin/impersonate?userId=clerk_user_id
 */
export async function GET(request: NextRequest) {
  const { userId: realUserId } = await auth()
  
  if (!realUserId || !isAdmin(realUserId)) {
    return new NextResponse('Unauthorized - Admin access required', { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get('userId')

  if (!targetUserId) {
    return new NextResponse('Bad Request - Missing userId parameter', { status: 400 })
  }

  const cookieStore = cookies()
  cookieStore.set({
    name: 'impersonated_user_id',
    value: targetUserId,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600, // 1 hour
    path: '/',
  })

  // Redirect back to dashboard to see the system as the impersonated user
  const baseUrl = new URL(request.url).origin
  return NextResponse.redirect(`${baseUrl}/dashboard`)
}
