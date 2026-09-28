'use client'

import { useState } from 'react'

export function ExpandableError({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = message.length > 80
  return (
    <div className="relative">
      <span className={expanded ? '' : 'line-clamp-1'}>{message}</span>
      {truncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] font-semibold text-primary hover:text-primary/80 mt-0.5 block"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
