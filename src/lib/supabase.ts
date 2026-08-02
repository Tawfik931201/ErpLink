import { createClient } from '@supabase/supabase-js'
import { checkImpersonationWriteBlock } from './auth'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method?.toUpperCase() || 'GET'
  
  // Block any database mutations during impersonation
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await checkImpersonationWriteBlock('Database (Supabase)')
  }
  
  return fetch(input, init)
}

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  global: {
    fetch: customFetch,
  },
})

