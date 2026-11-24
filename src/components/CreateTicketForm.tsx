'use client'

import { AlertCircle, CheckCircle2, Loader2, Send, X, Paperclip, FileText } from 'lucide-react'
import { useState } from 'react'

import { createTicket } from '@/app/actions/tickets'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface CreateTicketFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function CreateTicketForm({ onSuccess, onCancel }: CreateTicketFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Please enter a ticket title.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    const formData = new FormData()
    formData.append('title', title.trim())
    formData.append('description', description.trim())
    selectedFiles.forEach((file) => {
      formData.append('attachments', file)
    })

    try {
      const result = await createTicket(formData)
      if (result.success) {
        setSuccess('Your ticket has been submitted to support successfully.')
        setTitle('')
        setDescription('')
        setSelectedFiles([])
        if (onSuccess) {
          setTimeout(() => {
            onSuccess()
          }, 1200)
        }
      } else {
        setError(result.error || 'Failed to submit support ticket.')
      }
    } catch (err: unknown) {
      console.error('[tickets] submit action failed:', err)
      setError(
        err instanceof Error && /body|size|large|413/i.test(err.message)
          ? 'The attachments may be too large. Please try smaller files or submit the ticket without attachments.'
          : 'Could not contact the support service. Please check your connection and try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="shadow-lg border border-border bg-card/60 backdrop-blur-md overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-primary/70 via-primary to-primary" />
      
      <CardHeader className="p-4 sm:p-6 pb-4 flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <Send className="h-5 w-5 text-primary animate-pulse shrink-0" />
            Create Support Ticket
          </CardTitle>
          <CardDescription>
            Submit a new ticket directly to our Odoo helpdesk team.
          </CardDescription>
        </div>
        {onCancel && (
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 rounded-full shrink-0"
            onClick={onCancel}
            disabled={loading}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="p-4 sm:p-6 pt-0">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20 animate-in fade-in duration-300">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm border border-emerald-500/20 animate-in fade-in duration-300">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-semibold flex items-center gap-1.5">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              name="title"
              type="text"
              placeholder="e.g. Invoices mismatch between Zid and Odoo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading}
              className="bg-card/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-semibold">
              Description
            </Label>
            <textarea
              id="description"
              name="description"
              rows={5}
              placeholder="Provide clear details about the issue you are facing..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              className={cn(
                'flex w-full rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-foreground',
                'placeholder:text-muted-foreground font-medium resize-none',
                'transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary',
                'hover:border-border/80',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
                'shadow-inner-sm'
              )}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              Attachments (Images, PDF, Video)
            </Label>
            <div className="flex flex-col gap-2">
              <input
                id="attachments"
                name="attachments"
                type="file"
                multiple
                disabled={loading}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    const newFiles = Array.from(e.target.files)
                    setSelectedFiles((prev) => [...prev, ...newFiles])
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => document.getElementById('attachments')?.click()}
                className="w-full flex items-center justify-center gap-2 border-dashed rounded-xl h-11 text-xs border-border/80 hover:bg-secondary/40"
              >
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                Select files to attach...
              </Button>
            </div>
            
            {selectedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedFiles.map((file, idx) => (
                  <span key={idx} className="flex items-center gap-1 bg-secondary/80 px-2 py-0.5 rounded-lg border border-border text-[11px] font-semibold">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate max-w-[150px] font-medium text-muted-foreground">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-destructive shrink-0 ml-1 rounded-md p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-center gap-3">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:flex-1 font-bold"
                onClick={onCancel}
                disabled={loading}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              className="w-full sm:flex-1 font-bold transition-all duration-200"
              variant="brand"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Submitting...
                </>
              ) : (
                'Submit Ticket'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
