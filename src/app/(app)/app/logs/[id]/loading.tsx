import { Loader2 } from 'lucide-react'

export default function LogDetailLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="mb-2 h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-xs font-medium text-muted-foreground">Loading record…</p>
    </div>
  )
}
