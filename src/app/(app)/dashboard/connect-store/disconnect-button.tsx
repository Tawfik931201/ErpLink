'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { disconnectSallaStore, disconnectShopifyStore, disconnectZidStore } from '@/app/actions/workspaces'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface DisconnectButtonProps {
  merchantId: string
  confirmText: string
  buttonText: string
  platform?: 'zid' | 'salla' | 'shopify'
}

export default function DisconnectButton({ merchantId, confirmText, buttonText, platform = 'zid' }: DisconnectButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false)

  const handleDisconnect = async () => {
    if (platform === 'salla') {
      await disconnectSallaStore(merchantId)
    } else if (platform === 'shopify') {
      await disconnectShopifyStore(merchantId)
    } else {
      await disconnectZidStore(merchantId)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setShowConfirm(true)}
        className="h-7 text-[11px] gap-1 text-foreground/70 hover:text-destructive hover:border-destructive/50"
      >
        <Trash2 className="h-3 w-3" />
        <span>{buttonText}</span>
      </Button>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title=""
        description={confirmText}
        onConfirm={handleDisconnect}
      />
    </>
  )
}
