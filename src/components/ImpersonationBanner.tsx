import { cookies } from 'next/headers'
import StopImpersonationButton from './StopImpersonationButton'
import { Eye } from 'lucide-react'

export default function ImpersonationBanner() {
  const cookieStore = cookies()
  const impersonatedUserId = cookieStore.get('impersonated_user_id')?.value

  if (!impersonatedUserId) {
    return null
  }

  return (
    <div className="sticky top-0 z-[9999] w-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 border-b border-amber-600 shadow-md font-sans">
      <div className="max-w-7xl mx-auto px-4 py-2.5 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
        <div className="flex items-center gap-2 text-amber-950">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-900/10">
            <Eye className="h-4 w-4 text-amber-900" />
          </div>
          <span className="text-sm font-medium leading-tight text-right sm:text-left">
            <strong className="font-bold">وضع المحاكاة:</strong> أنت تتصفح حالياً بصفتك العميل <code className="bg-amber-600/20 px-1.5 py-0.5 rounded text-amber-900 font-mono text-xs select-all">{impersonatedUserId}</code>
            <span className="mx-2 hidden md:inline">|</span>
            <span className="block md:inline mt-0.5 md:mt-0">
              <strong>Impersonating User:</strong> <code className="bg-amber-600/20 px-1.5 py-0.5 rounded text-amber-900 font-mono text-xs select-all">{impersonatedUserId}</code>
            </span>
          </span>
        </div>
        <div className="shrink-0">
          <StopImpersonationButton />
        </div>
      </div>
    </div>
  )
}
