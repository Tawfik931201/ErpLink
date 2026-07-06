'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { disconnectZidStore, disconnectSallaStore } from '@/app/actions/workspaces'

interface DisconnectButtonProps {
  merchantId: string
  confirmText: string
  buttonText: string
  platform?: 'zid' | 'salla'
}

export default function DisconnectButton({ merchantId, confirmText, buttonText, platform = 'zid' }: DisconnectButtonProps) {
  const handleSubmit = (e: React.FormEvent) => {
    if (!confirm(confirmText)) {
      e.preventDefault()
    }
  }

  const handleAction = async () => {
    if (platform === 'salla') {
      await disconnectSallaStore(merchantId)
    } else {
      await disconnectZidStore(merchantId)
    }
  }

  return (
    <form action={handleAction} className="m-0" onSubmit={handleSubmit}>
      <Button type="submit" variant="destructive" size="sm" className="rounded-lg gap-1.5 h-8 text-xs hover:bg-destructive/90 whitespace-nowrap flex items-center justify-center">
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span>{buttonText}</span>
      </Button>
    </form>
  )
}
