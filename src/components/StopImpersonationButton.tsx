'use client'

import { ShieldAlert, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { stopImpersonation } from '@/app/actions/impersonate'


export default function StopImpersonationButton() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleStop = async () => {
    setLoading(true)
    try {
      await stopImpersonation()
      // Refresh the current route to update server-side components and data
      router.refresh()
    } catch (error) {
      console.error('Failed to stop impersonation:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleStop}
      disabled={loading}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 active:bg-red-800 rounded-lg border border-red-700 shadow-sm transition-all duration-150 disabled:opacity-75 disabled:cursor-not-allowed select-none focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-amber-500 font-sans"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ShieldAlert className="h-3.5 w-3.5" />
      )}
      <span>{loading ? 'جاري الإنهاء...' : 'إنهاء المحاكاة (Stop Impersonating)'}</span>
    </button>
  )
}
