import { createClient } from '@supabase/supabase-js'

import { checkImpersonationWriteBlock } from './auth'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

/**
 * ⚠️ لا يوجد fallback إلى anon key هنا إطلاقاً.
 *
 * السبب: `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY` كان يعني
 * أن غياب مفتاح service role لا يُنتج أي خطأ — بل يُرسل الطلبات بمفتاح
 * زائر، فتفشل كل عمليات الكتابة بصمت (RLS) ويظن الفريق أن المزامنة تعمل.
 * الآن غياب المفتاح يُوقف التشغيل صراحةً.
 */
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey && process.env.NODE_ENV === 'production') {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is missing. Refusing to start: falling back to the anon key would make every write fail silently (RLS).'
  )
}

// في التطوير فقط: نسمح بالمفتاح الزائر حتى تعمل المعاينة، مع تحذير صريح.
if (!supabaseServiceKey) {
  console.warn(
    '[supabase] SUPABASE_SERVICE_ROLE_KEY is not set — using NEXT_PUBLIC_SUPABASE_ANON_KEY (dev only). Writes will be blocked by RLS.'
  )
}

const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method?.toUpperCase() || 'GET'

  // Block any database mutations during impersonation
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await checkImpersonationWriteBlock('Database (Supabase)')
  }

  return fetch(input, init)
}

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  global: {
    fetch: customFetch,
  },
})
