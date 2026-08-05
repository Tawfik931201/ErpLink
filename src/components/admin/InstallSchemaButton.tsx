'use client'

import { Database, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

export default function InstallSchemaButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')

  async function handleInstall() {
    setState('loading')
    setMessage('')
    try {
      const res = await fetch('/api/admin/install-partner-schema', { method: 'POST' })
      const json: { ok?: boolean; error?: string } | null = await res
        .json()
        .catch(() => null)
      if (res.ok && json?.ok) {
        setState('success')
        setMessage('Schema installed successfully.')
        // Refresh server components so the page picks up the new tables.
        setTimeout(() => location.reload(), 800)
      } else {
        setState('error')
        setMessage(json?.error || `Install failed (${res.status}).`)
      }
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Network error while installing schema.')
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-900">
            Affiliate system tables are not installed in this database.
          </p>
          <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
            Click the button below to run the migration. (Equivalent to pasting
            the SQL file into the Supabase SQL Editor.)
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleInstall}
          disabled={state === 'loading' || state === 'success'}
          className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold"
        >
          {state === 'loading' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Installing schema…
            </>
          ) : state === 'success' ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Installed
            </>
          ) : (
            <>
              <Database className="h-4 w-4 mr-2" />
              Install Affiliate Schema
            </>
          )}
        </Button>

        {state === 'error' && (
          <p className="text-xs text-red-700 font-semibold">{message}</p>
        )}
        {state === 'success' && (
          <p className="text-xs text-emerald-700 font-semibold">{message}</p>
        )}
      </div>
    </div>
  )
}
