'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface DeleteWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName: string
  onConfirm: () => Promise<void>
}

export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspaceName,
  onConfirm,
}: DeleteWorkspaceDialogProps) {
  const [typedName, setTypedName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const { lang, dir } = useLanguage()
  const isRtl = dir === 'rtl'

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
    } finally {
      setIsDeleting(false)
      setTypedName('')
      onOpenChange(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTypedName('')
    }
    onOpenChange(open)
  }

  const nameMatches = typedName === workspaceName

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" dir={dir}>
        <DialogHeader>
          <div className={cn('flex items-center gap-3', isRtl ? 'text-right' : 'text-left')}>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <DialogTitle>
                {lang === 'ar' ? 'حذف بيئة العمل' : 'Delete Workspace'}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {lang === 'ar'
                  ? 'هذا الإجراء لا يمكن التراجع عنه. سيتم حذف جميع البيانات المرتبطة ببيئة العمل بما في ذلك الاتصالات والمزامنة.'
                  : 'This action cannot be undone. All data associated with this workspace, including connections and syncs, will be permanently deleted.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className={cn('text-sm font-medium text-foreground', isRtl ? 'text-right' : 'text-left')}>
            {lang === 'ar'
              ? 'يرجى كتابة '
              : 'Please type '}
            <strong>{lang === 'ar' ? 'اسم بيئة العمل' : 'the workspace name'}</strong>
            {lang === 'ar' ? ' لتأكيد الحذف:' : ' to confirm:'}
          </p>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <code className="text-sm font-bold text-destructive">{workspaceName}</code>
          </div>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={workspaceName}
            className={cn(
              'text-center font-medium',
              typedName && !nameMatches && 'border-destructive/50 focus-visible:border-destructive focus-visible:ring-destructive/30',
              nameMatches && 'border-emerald-500/50 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30',
            )}
          />
        </div>

        <DialogFooter className={cn(isRtl && 'sm:flex-row-reverse')}>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!nameMatches || isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {lang === 'ar' ? 'جاري الحذف...' : 'Deleting...'}
              </>
            ) : (
              lang === 'ar' ? 'حذف بيئة العمل' : 'Delete Workspace'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
