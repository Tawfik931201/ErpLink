'use client'

import { 
  Ticket as TicketIcon, 
  Plus, 
  ArrowLeft, 
  ArrowRight, 
  Search, 
  Calendar, 
  Clock3,
  Tag, 
  AlertCircle, 
  HelpCircle,
  MessageSquare,
  Headset,
  Smile,
  Send,
  Loader2,
  User,
  ShieldCheck,
  Paperclip,
  CheckCircle2
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

import type { Ticket, OdooMessage, OdooAttachment} from '@/app/actions/tickets';
import { getTicketMessages, sendTicketMessage, closeTicket, markTicketRead, getClientTickets } from '@/app/actions/tickets'
import CreateTicketForm from '@/components/CreateTicketForm'
import { useLanguage } from '@/components/language-provider'
import { TicketChatImageLightbox, TicketChatSelectedFiles, type TicketChatImagePreview } from '@/components/tickets/ticket-chat-media'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getPastedTicketImages, isTicketChatPreviewImage, mergeTicketChatFiles, type TicketChatFileError } from '@/lib/ticket-chat-media'
import { cn } from '@/lib/utils'

/**
 * Minimal HTML sanitizer for Odoo chatter bodies (XSS fix).
 *
 * Odoo stores rich text, so we keep basic formatting tags but strip
 * everything executable: <script>/<iframe>/<object>/<embed>/<form>,
 * event-handler attributes (on*), javascript:/data: URLs, and <style>.
 * No dependency — allowlist based, runs in the browser.
 */
function sanitizeOdooHtml(dirty: string): string {
  if (!dirty) return ''
  // Prevent server prerender from ever emitting an untrusted HTML string.
  if (typeof window === 'undefined') return ''
  try {
    const doc = new DOMParser().parseFromString(dirty, 'text/html')
    const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'span', 'div', 'blockquote', 'code', 'pre'])
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
    const toRemove: Element[] = []
    while (walker.nextNode()) {
      const el = walker.currentNode as Element
      const tag = el.tagName.toLowerCase()
      if (!ALLOWED.has(tag)) {
        // Unwrap unknown tags (keep text), drop dangerous ones entirely.
        if (['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'img', 'video', 'audio'].includes(tag)) {
          toRemove.push(el)
        } else {
          const parent = el.parentNode
          while (el.firstChild) parent?.insertBefore(el.firstChild, el)
          toRemove.push(el)
        }
        continue
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on') || name === 'style') {
          el.removeAttribute(attr.name)
          continue
        }
        if ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(attr.value)) {
          el.removeAttribute(attr.name)
        }
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || ''
        if (href && !/^(https?:|mailto:|\/|#)/i.test(href)) el.removeAttribute('href')
        el.setAttribute('rel', 'noopener noreferrer')
        el.setAttribute('target', '_blank')
      }
    }
    for (const el of toRemove) el.remove()
    return doc.body.innerHTML
  } catch {
    return ''
  }
}

/** Small dependency-free picker, including commonly used support emojis. */
const CHAT_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😎',
  '🤔', '😕', '😢', '😭', '😡', '😮', '🙏', '👏',
  '👍', '👎', '👌', '🤝', '👋', '💪', '❤️', '💚',
  '🎉', '✅', '❌', '⚠️', '📷', '📎', '💡', '💬',
  '🔥', '⭐', '🚀', '🛠️', '📦', '🧾', '🛒', '✨',
]

const TICKET_ATTACHMENT_ERRORS: Record<'ar' | 'en', Record<TicketChatFileError, string>> = {
  ar: {
    too_many: 'يمكن إرسال 5 مرفقات كحد أقصى في الرسالة.',
    file_too_large: 'الحد الأقصى لحجم المرفق الواحد 10 ميجابايت.',
    total_too_large: 'إجمالي المرفقات يجب ألا يتجاوز 20 ميجابايت.',
    invalid_file: 'الملف المرفق غير صالح.',
  },
  en: {
    too_many: 'You can attach up to 5 files per message.',
    file_too_large: 'Each attachment must be 10 MB or less.',
    total_too_large: 'Combined attachments must be 20 MB or less.',
    invalid_file: 'Invalid attachment.',
  },
}

interface TicketsClientProps {
  initialTickets: Ticket[]
  success: boolean
  error?: string | null
}

const LOCAL_TEXTS = {
  ar: {
    title: 'تذاكر الدعم الفني',
    subtitle: 'إدارة وتتبع تذاكر الدعم الفني الخاصة بك المرسلة لنظام أودو مباشرة.',
    createBtn: 'إنشاء تذكرة جديدة',
    backBtn: 'العودة لقائمة التذاكر',
    searchPlaceholder: 'ابحث عن تذكرة بالعنوان أو الرقم المرجعي...',
    ticketRef: 'الرقم المرجعي',
    createdOn: 'تاريخ الإنشاء',
    noTickets: 'لا توجد تذاكر دعم حالياً',
    noTicketsDesc: 'إذا قمت بتقديم تذكرة دعم، فستظهر هنا. انقر فوق الزر أعلاه لإضافة تذكرة جديدة لمكتب الدعم.',
    descriptionLabel: 'تفاصيل المشكلة والوصف',
    statusLabel: 'حالة التذكرة',
    connStatus: 'متصل بنظام أودو',
    detailsBtn: 'عرض التفاصيل',
    failedTitle: 'فشل الاتصال بنظام أودو',
    failedDesc: 'يرجى مراجعة إعدادات الاتصال والاعتمادات في ملف الإعدادات الخاص بالخادم.',
    ticketDetails: 'تفاصيل التذكرة',
    chatterTitle: 'محادثة التذكرة والدعم',
    chatterPlaceholder: 'اكتب ردك أو استفسارك هنا للدعم الفني...',
    sendReplyBtn: 'إرسال الرد',
    sendingReply: 'جاري الإرسال...',
    noMessages: 'لا توجد رسائل بعد.',
    customerLabel: 'أنت',
    agentLabel: 'الدعم الفني',
    supportNoteTitle: 'ملاحظة من فريق الدعم الفني',
    supportNoteText: 'يقوم مهندسو الدعم لدينا بمراجعة طلبك حالياً. سيتم إرسال التحديثات والتفاصيل مباشرة إلى بريدك الإلكتروني المسجل.',
    closeTicketBtn: 'إغلاق التذكرة',
    closeSuccess: 'تم إغلاق التذكرة بنجاح.',
    closeConfirmTitle: 'تأكيد إغلاق التذكرة',
    closeConfirmDesc: 'هل أنت متأكد من رغبتك في إغلاق هذه التذكرة؟ هذا الإجراء يعني حل المشكلة ولا يمكن التراجع عنه.',
    closeConfirmYes: 'نعم، أغلق التذكرة',
    closeConfirmNo: 'تراجع',
    closedTicketWarning: 'تم إغلاق هذه التذكرة. لا يمكنك إرسال ردود جديدة عليها.',
    autoClosePolicy: 'ملاحظة: إذا ردّ فريق الدعم ولم يصل رد منك خلال 5 أيام كاملة من آخر رسالة للدعم، تُغلق التذكرة تلقائيًا. الرد خلال هذه المدة يمنع إغلاقها.',
  },
  en: {
    title: 'Support Tickets',
    subtitle: 'Manage and track your technical support tickets sent directly to Odoo.',
    createBtn: 'Create New Ticket',
    backBtn: 'Back to Tickets',
    searchPlaceholder: 'Search tickets by title or reference...',
    ticketRef: 'Reference Number',
    createdOn: 'Created On',
    noTickets: 'No tickets found',
    noTicketsDesc: 'If you have submitted a support ticket, it will appear here. Click the button above to add a new ticket.',
    descriptionLabel: 'Issue Details & Description',
    statusLabel: 'Ticket Status',
    connStatus: 'Connected to Odoo Helpdesk',
    detailsBtn: 'View Details',
    failedTitle: 'Failed to connect to Odoo',
    failedDesc: 'Please verify the Odoo credentials and server settings in your server configuration.',
    ticketDetails: 'Ticket Details',
    chatterTitle: 'Ticket Messages & Discussion',
    chatterPlaceholder: 'Type your reply or question for technical support here...',
    sendReplyBtn: 'Send Message',
    sendingReply: 'Sending...',
    noMessages: 'No messages yet.',
    customerLabel: 'You',
    agentLabel: 'Support Agent',
    supportNoteTitle: 'Support Team Note',
    supportNoteText: 'Our support team is currently reviewing your ticket. Updates and correspondence will be sent directly to your registered email address.',
    closeTicketBtn: 'Close Ticket',
    closeSuccess: 'Ticket closed successfully.',
    closeConfirmTitle: 'Confirm Closing Ticket',
    closeConfirmDesc: 'Are you sure you want to close this ticket? This signifies the issue is resolved and cannot be undone.',
    closeConfirmYes: 'Yes, Close Ticket',
    closeConfirmNo: 'Cancel',
    closedTicketWarning: 'This ticket has been closed. You can no longer send replies.',
    autoClosePolicy: 'Note: If our support team replies and you do not respond within five full days of the last support message, the ticket will close automatically. Replying during that period keeps it open.',
  }
}

/**
 * Maps Odoo stage names to appropriate Tailwind UI badge variants
 */
function getStageVariant(stageName: string): 'info' | 'warning' | 'success' | 'destructive' | 'secondary' {
  const name = stageName.toLowerCase()
  if (name.includes('new') || name.includes('جديد') || name.includes('draft')) {
    return 'info'
  }
  if (name.includes('progress') || name.includes('معالجة') || name.includes('open') || name.includes('حل')) {
    return 'warning'
  }
  if (name.includes('solved') || name.includes('تم الحل') || name.includes('closed') || name.includes('done')) {
    return 'success'
  }
  if (name.includes('cancel') || name.includes('ملغى') || name.includes('failed')) {
    return 'destructive'
  }
  return 'secondary'
}

/**
 * Cleans Odoo description (removing basic HTML if returned)
 */
function formatDescription(desc: string | false): string {
  if (!desc) return 'No description provided.'
  const stripped = desc.replace(/<[^>]*>/g, '').trim()
  return stripped || 'No description provided.'
}

export default function TicketsClient({ initialTickets, success, error }: TicketsClientProps) {
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list')
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)

  // Chatter states
  const [messages, setMessages] = useState<OdooMessage[]>([])
  const [attachments, setAttachments] = useState<OdooAttachment[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [activeImage, setActiveImage] = useState<TicketChatImagePreview | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const activeTicketIdRef = useRef<number | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const acknowledgedRef = useRef<Map<number, number>>(new Map())
  const readInFlightRef = useRef<Set<number>>(new Set())
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [closingTicket, setClosingTicket] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  
  const { lang, dir } = useLanguage()
  const tLocal = LOCAL_TEXTS[lang === 'ar' ? 'ar' : 'en']
  const chatLang: 'ar' | 'en' = lang === 'ar' ? 'ar' : 'en'

  const appendFiles = (files: File[]) => {
    if (!files.length || sendingReply) return
    const result = mergeTicketChatFiles(selectedFiles, files)
    if (result.error) {
      setReplyError(TICKET_ATTACHMENT_ERRORS[chatLang][result.error])
      return
    }
    setSelectedFiles(result.files)
    setReplyError(null)
  }

  const pasteImages = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = getPastedTicketImages(event.clipboardData.items)
    if (!files.length) return // Normal text paste continues unchanged.
    event.preventDefault()
    appendFiles(files)
  }

  const insertEmoji = (emoji: string) => {
    const input = composerRef.current
    const cursor = input?.selectionStart ?? replyText.length
    const end = input?.selectionEnd ?? replyText.length
    setReplyText(text => text.slice(0, cursor) + emoji + text.slice(end))
    setShowEmojiPicker(false)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(cursor + emoji.length, cursor + emoji.length)
    })
  }

  useEffect(() => {
    if (!showEmojiPicker) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !emojiPickerRef.current?.contains(event.target)) {
        setShowEmojiPicker(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowEmojiPicker(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onEscape)
    }
  }, [showEmojiPicker])

  // Sync state if initialTickets change on server revalidation
  useEffect(() => {
    setTickets(initialTickets)
  }, [initialTickets])

  // On-demand read only: no recurring Odoo/Supabase polling.
  const loadMessages = async (ticketId: number, silent = false) => {
    if (!silent) setLoadingMessages(true)
    try {
      const res = await getTicketMessages(ticketId)
      // Never display an old ticket's response after changing conversations.
      if (activeTicketIdRef.current !== ticketId) return
      if (res.success && res.messages) {
        setMessages(res.messages)
        setAttachments(res.attachments || [])
      }
    } catch (err) {
      console.error('Failed to load Odoo chatter messages:', err)
    } finally {
      if (!silent && activeTicketIdRef.current === ticketId) setLoadingMessages(false)
    }
  }

  const selectedTicketId = selectedTicket?.id ?? null

  useEffect(() => {
    activeTicketIdRef.current = selectedTicketId
    stickToBottomRef.current = true
    setSelectedFiles([])
    setActiveImage(null)
    setShowEmojiPicker(false)
    if (selectedTicketId !== null) {
      setMessages([])
      setAttachments([])
      void loadMessages(selectedTicketId)
    } else {
      setMessages([])
      setAttachments([])
    }
  }, [selectedTicketId])

  // A single ticket-specific SSE stream while this discussion is open.
  // Odoo Studio fires the webhook for support agent replies. We only fetch
  // messages on that event, reconnect, or tab focus (to recover missed events).
  useEffect(() => {
    if (view !== 'detail' || selectedTicketId === null ||
        typeof EventSource === 'undefined') return
    const ticketId = selectedTicketId
    const source = new EventSource('/api/tickets/live/stream?ticketId=' + ticketId)
    let hasConnected = false
    let dirtyWhileHidden = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined

    const scheduleRefresh = () => {
      if (document.visibilityState !== 'visible') {
        dirtyWhileHidden = true
        return
      }
      if (refreshTimer) clearTimeout(refreshTimer)
      // Odoo may dispatch the webhook just before committing its transaction.
      refreshTimer = setTimeout(() => { void loadMessages(ticketId, true) }, 800)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (dirtyWhileHidden) dirtyWhileHidden = false
        scheduleRefresh()
      }
    }
    const onReady = () => {
      if (hasConnected) scheduleRefresh()
      hasConnected = true
    }
    source.addEventListener('ticket-updated', scheduleRefresh)
    source.addEventListener('ready', onReady)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      source.close()
      if (refreshTimer) clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [view, selectedTicketId])

  // Messenger-style behavior: preserve scroll position while a customer reads
  // older messages; otherwise keep the newest reply visible.
  useEffect(() => {
    if (view !== 'detail' || selectedTicketId === null) return
    const el = chatScrollRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, loadingMessages, view, selectedTicketId])

  const acknowledgeVisibleSupportMessages = async () => {
    const ticketId = selectedTicket?.id
    const el = chatScrollRef.current
    if (ticketId == null || view !== 'detail' || !el ||
        document.visibilityState !== 'visible') return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90
    if (!atBottom || readInFlightRef.current.has(ticketId)) return
    const lastSupportId = messages.reduce((max, msg) =>
      !msg.is_customer && msg.id > max ? msg.id : max, 0)
    if (!lastSupportId || lastSupportId <= (acknowledgedRef.current.get(ticketId) || 0)) return
    readInFlightRef.current.add(ticketId)
    try {
      const result = await markTicketRead(ticketId, lastSupportId)
      if (result.success) {
        acknowledgedRef.current.set(ticketId, lastSupportId)
        setTickets(current => current.map(ticket =>
          ticket.id === ticketId ? { ...ticket, unread_count: 0 } : ticket))
        window.dispatchEvent(new Event('erp-ticket-read'))
      }
    } catch (error) {
      console.warn('[tickets] failed to acknowledge support messages:', error)
    } finally {
      readInFlightRef.current.delete(ticketId)
    }
  }

  // Only acknowledge when the discussion is visible AND scrolled to the newest
  // message, never just because a hidden tab received an SSE invalidation.
  useEffect(() => {
    if (view !== 'detail' || selectedTicketId === null) return
    void acknowledgeVisibleSupportMessages()
  }, [messages, loadingMessages, view, selectedTicketId])

  // Keep per-ticket unread pills in sync when an agent replies while the
  // customer is browsing the ticket list. Never poll Odoo in the background.
  useEffect(() => {
    if (view !== 'list') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true
    const refreshTickets = () => {
      if (document.visibilityState !== 'visible') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void getClientTickets().then(result => {
          if (active && result.success && result.tickets) setTickets(result.tickets)
        }).catch(() => {})
      }, 850)
    }
    window.addEventListener('erp-ticket-updated', refreshTickets)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      window.removeEventListener('erp-ticket-updated', refreshTickets)
    }
  }, [view])

  // Filtered tickets based on search
  const filteredTickets = tickets.filter(ticket => {
    const titleMatch = ticket.name.toLowerCase().includes(searchQuery.toLowerCase())
    const ref = ticket.ticket_ref || `#${ticket.id}`
    const refMatch = ref.toLowerCase().includes(searchQuery.toLowerCase())
    return titleMatch || refMatch
  })

  // Submit reply action
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!replyText.trim() && selectedFiles.length === 0) || !selectedTicket) return

    setSendingReply(true)
    setReplyError(null)

    const formData = new FormData()
    formData.append('ticketId', selectedTicket.id.toString())
    formData.append('message', replyText.trim())
    selectedFiles.forEach((file) => {
      formData.append('attachments', file)
    })

    try {
      const res = await sendTicketMessage(formData)
      if (res.success) {
        setReplyText('')
        setActiveImage(null)
        setSelectedFiles([])
        const fileInput = document.getElementById('chatter-attachments') as HTMLInputElement
        if (fileInput) fileInput.value = ''
        // Refresh chatter history
        await loadMessages(selectedTicket.id)
      } else {
        setReplyError(res.error || 'Failed to submit message to Odoo')
      }
    } catch (err: any) {
      console.error(err)
      setReplyError('An unexpected connection error occurred.')
    } finally {
      setSendingReply(false)
    }
  }

  const handleCloseTicket = async () => {
    if (!selectedTicket) return

    setClosingTicket(true)
    try {
      const res = await closeTicket(selectedTicket.id)
      if (res.success) {
        setShowCloseConfirm(false)
        setShowSuccessToast(true)
        setTimeout(() => setShowSuccessToast(false), 3000)

        // Update stage locally
        setSelectedTicket((prev) => {
          if (!prev) return null
          return {
            ...prev,
            stage_id: [prev.stage_id ? prev.stage_id[0] : 0, 'closed']
          }
        })
        // Update ticket in list
        setTickets((prev) => 
          prev.map((t) => 
            t.id === selectedTicket.id 
              ? { ...t, stage_id: [t.stage_id ? t.stage_id[0] : 0, 'closed'] }
              : t
          )
        )
      } else {
        alert(res.error || 'Failed to close ticket')
      }
    } catch (err: any) {
      console.error(err)
      alert('An error occurred while closing the ticket.')
    } finally {
      setClosingTicket(false)
    }
  }

  // Direction-aware arrow icon for going back
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft

  // Render detail view with chatter conversation
  if (view === 'detail' && selectedTicket) {
    const stageName = Array.isArray(selectedTicket.stage_id) ? selectedTicket.stage_id[1] : 'New'
    const isClosed = stageName.toLowerCase().includes('close') || 
                     stageName.toLowerCase().includes('solve') || 
                     stageName.includes('مغلق') || 
                     stageName.includes('حل')
    const stageVariant = getStageVariant(stageName)
    const refNo = selectedTicket.ticket_ref || `#${selectedTicket.id}`
    const createdDate = new Date(selectedTicket.create_date).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Header with Back button & Close button */}
        <div className="flex items-center justify-between gap-4 w-full">
          <Button 
            onClick={() => {
              setSelectedTicket(null)
              setView('list')
            }} 
            variant="outline" 
            size="sm"
            className="rounded-xl gap-2 font-semibold"
          >
            <BackIcon className="h-4 w-4" />
            {tLocal.backBtn}
          </Button>

          {!isClosed && (
            <Button
              onClick={() => setShowCloseConfirm(true)}
              disabled={closingTicket}
              variant="destructive"
              size="sm"
              className="rounded-xl gap-1.5 font-bold text-xs"
            >
              {closingTicket ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {tLocal.closeTicketBtn}
                </>
              )}
            </Button>
          )}
        </div>

        {/* Detailed Ticket Card & Chatter Thread (Split Layout) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
          {/* Column 1: Ticket Details */}
          <div className="lg:col-span-5 space-y-6">
            <Card className=" border border-border bg-card/60 backdrop-blur-md overflow-hidden relative">

              
              <CardHeader className="pb-4">
                <div className="space-y-2">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground bg-secondary/80 px-2.5 py-1 rounded-full w-fit">
                    <Tag className="h-3 w-3" />
                    {tLocal.ticketRef}: {refNo}
                  </span>
                  <h1 className="text-lg font-extrabold tracking-tight text-foreground leading-tight">
                    {selectedTicket.name}
                  </h1>
                  <Badge variant={stageVariant} className="capitalize py-0.5 px-2.5 text-[10px] font-bold w-fit">
                    {stageName}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-4 border-t border-border/50">
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {tLocal.descriptionLabel}
                  </h3>
                  <div className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed bg-secondary/15 p-4 rounded-xl border border-border/30 max-h-[300px] overflow-y-auto">
                    {formatDescription(selectedTicket.description)}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold pt-2 border-t border-border/30">
                  <Calendar className="h-3.5 w-3.5" />
                  {tLocal.createdOn}: {createdDate}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Column 2: Chatter Discussion */}
          <div className="lg:col-span-7 space-y-6">
            <Card className="flex h-[min(78dvh,700px)] min-h-[480px] flex-col overflow-hidden rounded-2xl border border-[#d1d7db] bg-[#f0f2f5] shadow-lg dark:border-[#2a3942] dark:bg-[#202c33] lg:h-[660px]">
              <CardHeader className="shrink-0 border-b border-[#d1d7db] bg-[#f0f2f5] px-4 py-3 dark:border-[#2a3942] dark:bg-[#202c33]">
                <CardTitle className="flex items-center gap-3 text-sm font-bold">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00a884] text-white">
                    <Headset className="h-5 w-5" />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[#111b21] dark:text-[#e9edef]">{tLocal.chatterTitle}</span>
                    <span className="text-[11px] font-normal text-[#667781] dark:text-[#8696a0]">
                      {lang === 'ar' ? 'المحادثة مع فريق دعم ERP Link' : 'Conversation with ERP Link support'}
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              
              {/* Messenger-style chat: customer messages on the right, support on the left. */}
              <div
                ref={chatScrollRef}
                role="log"
                aria-label={tLocal.chatterTitle}
                onScroll={(event) => {
                  const element = event.currentTarget
                  stickToBottomRef.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 90
                  if (stickToBottomRef.current) void acknowledgeVisibleSupportMessages()
                }}
                className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] px-3 py-5 dark:bg-[#0b141a] sm:px-5"
              >
                {loadingMessages ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {lang === 'ar' ? 'جاري تحميل المحادثة...' : 'Loading conversation...'}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                      <MessageSquare className="h-6 w-6 opacity-70" />
                    </span>
                    <span className="text-sm">{tLocal.noMessages}</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg, index) => {
                      const isMine = msg.is_customer
                      const authorName = Array.isArray(msg.author_id) ? msg.author_id[1] : 'Support'
                      const date = new Date(msg.date)
                      const previousDate = index > 0 ? new Date(messages[index - 1].date) : null
                      const showDate = !previousDate ||
                        date.toDateString() !== previousDate.toDateString()
                      const formattedDay = date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })
                      const formattedTime = date.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                        hour: '2-digit', minute: '2-digit',
                      })

                      // Image attachments are independent media tiles rather than
                      // sitting on the customer's green chat bubble.
                      const attachedFiles = (msg.attachment_ids || [])
                        .map(id => attachments.find(item => item.id === id))
                        .filter((file): file is OdooAttachment => Boolean(file))
                      const imageAttachments = attachedFiles.filter(file => isTicketChatPreviewImage(file.mimetype))
                      const documentAttachments = attachedFiles.filter(file => !isTicketChatPreviewImage(file.mimetype))
                      const plainBody = (msg.body || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
                      const hasText = plainBody.length > 0 && !(
                        imageAttachments.length > 0 && plainBody.toLowerCase() === 'attachment sent'
                      )
                      const showBubble = hasText || documentAttachments.length > 0 || imageAttachments.length === 0

                      return (
                        <div key={msg.id} className="space-y-3">
                          {showDate && (
                            <div className="flex items-center justify-center py-2">
                              <span className="rounded-full border border-[#d1d7db] bg-white/90 px-3 py-1 text-[10px] font-medium text-[#54656f] shadow-sm dark:border-[#2a3942] dark:bg-[#202c33] dark:text-[#8696a0]">
                                {formattedDay}
                              </span>
                            </div>
                          )}

                          <div dir="ltr" className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}>
                            {!isMine && (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#075e54] text-white shadow-sm dark:bg-[#00a884]">
                                <Headset className="h-4 w-4" />
                              </span>
                            )}

                            <div
                              dir={dir}
                              className={cn(
                                'flex min-w-0 max-w-[84%] flex-col gap-1.5 sm:max-w-[76%]',
                                isMine ? 'items-end' : 'items-start'
                              )}
                            >
                              {/* Text and ordinary files keep their chat bubble. */}
                              {showBubble && (
                                <div className={cn(
                                  'max-w-full rounded-xl border px-3.5 py-2.5 shadow-sm',
                                  isMine
                                    ? 'rounded-br-sm border-[#c6e9be] bg-[#d9fdd3] text-[#111b21] dark:border-[#005c4b] dark:bg-[#005c4b] dark:text-[#e9edef]'
                                    : 'rounded-bl-sm border-[#ece5dd] bg-white text-[#111b21] dark:border-[#202c33] dark:bg-[#202c33] dark:text-[#e9edef]'
                                )}>
                                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                                    <span className={cn('text-[11px] font-bold', isMine ? 'text-[#075e54] dark:text-[#7ae6c5]' : 'text-[#075e54] dark:text-[#53bdeb]')}>
                                      {isMine ? tLocal.customerLabel : tLocal.agentLabel}
                                      {!isMine && authorName && authorName !== 'Support' && (
                                        <span className="ms-1 font-normal text-muted-foreground">· {authorName}</span>
                                      )}
                                    </span>
                                  </div>

                                  {hasText && (
                                    <div
                                      className="odoo-chatter-html prose prose-sm max-w-none break-words text-[13px] leading-6 text-[#111b21] dark:prose-invert dark:text-[#e9edef]"
                                      dangerouslySetInnerHTML={{ __html: sanitizeOdooHtml(msg.body) }}
                                    />
                                  )}

                                  {documentAttachments.length > 0 && (
                                    <div className="mt-2.5 flex flex-wrap gap-2 border-t border-[#111b21]/10 pt-2.5 dark:border-white/10">
                                      {documentAttachments.map(attachment => (
                                        <a
                                          key={attachment.id}
                                          href={'/api/tickets/attachments?id=' + attachment.id}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex max-w-[210px] items-center gap-2 rounded-xl border border-[#d1d7db] bg-[#f0f2f5]/90 px-3 py-2 text-[11px] font-medium text-[#111b21] hover:bg-[#dfe5e7] dark:border-[#3b4a54] dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#374952]"
                                        >
                                          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                                          <span className="min-w-0 truncate">{attachment.name}</span>
                                        </a>
                                      ))}
                                    </div>
                                  )}

                                  <div className="mt-2 flex justify-end">
                                    <time dateTime={msg.date} title={formattedDay}
                                      className="text-[10px] tabular-nums text-[#667781] dark:text-[#a1adb5]">
                                      {formattedTime}
                                    </time>
                                  </div>
                                </div>
                              )}

                              {/* Smaller images: no green/white message bubble behind them. */}
                              {imageAttachments.length > 0 && (
                                <div
                                  className={cn(
                                    'flex max-w-full flex-wrap gap-1.5',
                                    isMine ? 'justify-end' : 'justify-start'
                                  )}
                                >
                                  {imageAttachments.map(attachment => {
                                    const url = '/api/tickets/attachments?id=' + attachment.id
                                    const previewUrl = url + '&preview=1'
                                    return (
                                      <button
                                        key={attachment.id}
                                        type="button"
                                        onClick={() => setActiveImage({ src: previewUrl, name: attachment.name })}
                                        aria-label={(chatLang === 'ar' ? 'معاينة الصورة: ' : 'Preview image: ') + attachment.name}
                                        className="group inline-flex max-w-full overflow-hidden rounded-lg border border-black/10 bg-transparent p-0 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] dark:border-white/15"
                                        title={attachment.name}
                                      >
                                        <img
                                          src={previewUrl}
                                          alt={attachment.name}
                                          loading="lazy"
                                          className="block h-auto max-h-[112px] max-w-[150px] object-cover sm:max-h-[120px] sm:max-w-[165px]"
                                        />
                                      </button>
                                    )
                                  })}
                                </div>
                              )}

                              {/* For picture-only messages, show time without a chat bubble. */}
                              {imageAttachments.length > 0 && !showBubble && (
                                <div className="flex items-center gap-2 text-[10px] text-[#54656f] dark:text-[#a1adb5]">
                                  <span>{isMine ? tLocal.customerLabel : tLocal.agentLabel}</span>
                                  <time dateTime={msg.date} title={formattedDay}>{formattedTime}</time>
                                </div>
                              )}
                            </div>

                            {isMine && (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[#075e54] dark:bg-[#005c4b] dark:text-[#a8ebd2]">
                                <User className="h-4 w-4" />
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Send Reply Form or Closed Ticket Info Warning */}
              {isClosed ? (
                <div className="p-6 border-t border-border/50 bg-secondary/15 text-center flex flex-col items-center justify-center gap-2 shrink-0 rounded-b-2xl">
                  <ShieldCheck className="h-6 w-6 text-foreground animate-pulse" />
                  <p className="text-xs font-bold text-foreground/80 leading-relaxed">
                    {tLocal.closedTicketWarning}
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleSendReply}
                  onDragOver={event => {
                    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
                  }}
                  onDrop={event => {
                    if (!event.dataTransfer.files.length) return
                    event.preventDefault()
                    appendFiles(Array.from(event.dataTransfer.files))
                  }}
                  className="shrink-0 space-y-2.5 border-t border-[#d1d7db] bg-[#f0f2f5] p-3 dark:border-[#2a3942] dark:bg-[#202c33]"
                >
                  <p role="note" className="flex items-start gap-2 rounded-lg border border-[#d1d7db] bg-white/85 px-3 py-2 text-[11px] leading-relaxed text-[#54656f] dark:border-[#3b4a54] dark:bg-[#202c33] dark:text-[#c3ced5]">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#008f72] dark:text-[#7ae6c5]" aria-hidden="true" />
                    <span>{tLocal.autoClosePolicy}</span>
                  </p>

                  {replyError && (
                    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{replyError}</span>
                    </div>
                  )}

                  <TicketChatSelectedFiles
                    files={selectedFiles}
                    lang={chatLang}
                    onPreview={setActiveImage}
                    onRemove={index => {
                      setActiveImage(null)
                      setSelectedFiles(files => files.filter((_, i) => i !== index))
                    }}
                  />

                  <div className="flex items-end gap-2" dir={dir}>
                    <div className="relative flex min-w-0 flex-1 items-end rounded-2xl border border-[#d1d7db] bg-white shadow-sm focus-within:border-[#00a884] dark:border-[#3b4a54] dark:bg-[#2a3942]">
                      <div ref={emojiPickerRef} className="relative shrink-0 self-end">
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(open => !open)}
                          disabled={sendingReply}
                          aria-label={chatLang === 'ar' ? 'إضافة رمز تعبيري' : 'Insert emoji'}
                          aria-expanded={showEmojiPicker}
                          aria-controls="ticket-chat-emoji-picker"
                          className="flex h-11 w-10 items-center justify-center text-[#54656f] transition-colors hover:text-[#00a884] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] disabled:opacity-50 dark:text-[#8696a0] dark:hover:text-[#25d366]"
                        >
                          <Smile className="h-[22px] w-[22px]" />
                        </button>
                        {showEmojiPicker && (
                          <div
                            id="ticket-chat-emoji-picker"
                            role="dialog"
                            aria-label={chatLang === 'ar' ? 'الرموز التعبيرية' : 'Emojis'}
                            className="absolute bottom-full start-0 z-30 mb-3 w-[min(318px,78vw)] rounded-xl border border-[#d1d7db] bg-white p-3 shadow-2xl dark:border-[#3b4a54] dark:bg-[#202c33]"
                          >
                            <p className="mb-2 text-xs font-semibold text-[#54656f] dark:text-[#d1d7db]">
                              {chatLang === 'ar' ? 'اختر رمزًا تعبيريًا' : 'Choose an emoji'}
                            </p>
                            <div className="grid grid-cols-8 gap-1" dir="ltr">
                              {CHAT_EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onMouseDown={event => event.preventDefault()}
                                  onClick={() => insertEmoji(emoji)}
                                  aria-label={(chatLang === 'ar' ? 'إدراج ' : 'Insert ') + emoji}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[22px] transition-colors hover:bg-[#e9edef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] dark:hover:bg-[#374952]"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <textarea
                        ref={composerRef}
                        placeholder={tLocal.chatterPlaceholder}
                        value={replyText}
                        onChange={event => setReplyText(event.target.value)}
                        onPaste={pasteImages}
                        disabled={sendingReply}
                        rows={1}
                        onKeyDown={event => {
                          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            if (!sendingReply) event.currentTarget.form?.requestSubmit()
                          }
                        }}
                        className="min-h-[44px] max-h-28 w-full min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[13px] leading-6 text-[#111b21] placeholder:text-[#8696a0] focus-visible:outline-none disabled:opacity-50 dark:text-[#e9edef]"
                      />

                      <input
                        ref={fileInputRef}
                        id="chatter-attachments"
                        name="attachments"
                        type="file"
                        multiple
                        disabled={sendingReply}
                        className="hidden"
                        onChange={event => {
                          const files = event.currentTarget.files
                          if (files?.length) appendFiles(Array.from(files))
                          event.currentTarget.value = ''
                        }}
                      />
                      <button
                        type="button"
                        disabled={sendingReply}
                        onClick={() => fileInputRef.current?.click()}
                        aria-label={chatLang === 'ar' ? 'إرفاق صور أو ملفات' : 'Attach pictures or files'}
                        className="flex h-11 w-10 shrink-0 items-center justify-center text-[#54656f] transition-colors hover:text-[#00a884] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] disabled:opacity-50 dark:text-[#8696a0] dark:hover:text-[#25d366]"
                      >
                        <Paperclip className="h-[21px] w-[21px]" />
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={sendingReply || (!replyText.trim() && selectedFiles.length === 0)}
                      aria-label={tLocal.sendReplyBtn}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-sm transition-colors hover:bg-[#008f72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25d366] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#00a884]"
                    >
                      {sendingReply
                        ? <Loader2 className="h-5 w-5 animate-spin" />
                        : <Send className={cn('h-5 w-5', dir === 'rtl' ? 'rotate-180' : '')} />}
                    </button>
                  </div>
                  <p className="px-1 text-[10px] text-[#667781] dark:text-[#8696a0]">
                    {chatLang === 'ar'
                      ? 'Ctrl + V للصق صورة · Enter للإرسال · Shift + Enter لسطر جديد'
                      : 'Ctrl + V to paste an image · Enter to send · Shift + Enter for a new line'}
                  </p>
                </form>
              )}
            </Card>
          </div>
        </div>

        <TicketChatImageLightbox
          preview={activeImage}
          onClose={() => setActiveImage(null)}
          lang={chatLang}
        />

        {/* Custom Confirmation Modal */}
        {showCloseConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-card border border-border w-full max-w-md rounded-xl p-6 space-y-4 animate-in zoom-in-95 duration-200" dir={dir}>
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-6 w-6 shrink-0" />
                <h3 className="text-sm font-extrabold text-foreground">{tLocal.closeConfirmTitle}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {tLocal.closeConfirmDesc}
              </p>
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleCloseTicket}
                  disabled={closingTicket}
                  variant="destructive"
                  className="flex-1 rounded-xl font-bold text-xs"
                >
                  {closingTicket ? <Loader2 className="h-4 w-4 animate-spin" /> : tLocal.closeConfirmYes}
                </Button>
                <Button
                  onClick={() => setShowCloseConfirm(false)}
                  disabled={closingTicket}
                  variant="outline"
                  className="flex-1 rounded-xl font-bold text-xs"
                >
                  {tLocal.closeConfirmNo}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Success Toast Notification */}
        {showSuccessToast && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background font-bold text-xs px-5 py-3 rounded-xl flex items-center gap-2 border border-border animate-in slide-in-from-top-4 duration-300">
            <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
            <span>{tLocal.closeSuccess}</span>
          </div>
        )}
      </div>
    )
  }

  // Render creation view
  if (view === 'create') {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4">
          <Button 
            onClick={() => setView('list')} 
            variant="outline" 
            size="sm"
            className="rounded-xl gap-2 font-semibold"
          >
            <BackIcon className="h-4 w-4" />
            {tLocal.backBtn}
          </Button>
        </div>

        <div className="max-w-xl mx-auto">
          <p role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-card/65 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-foreground/65" aria-hidden="true" />
            <span>{tLocal.autoClosePolicy}</span>
          </p>
          <CreateTicketForm 
            onSuccess={() => {
              window.dispatchEvent(new Event('erp-tickets-changed'))
              void getClientTickets().then(result => {
                if (result.success && result.tickets) setTickets(result.tickets)
              })
              setView('list')
            }} 
            onCancel={() => setView('list')} 
          />
        </div>
      </div>
    )
  }

  // List View (standard linear vertical rows, not Kanban)
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
            <TicketIcon className="h-8 w-8 text-foreground" />
            {tLocal.title}
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {tLocal.subtitle}
          </p>
        </div>

        {success && (
          <div className="flex items-center gap-4 shrink-0">
            <Button 
              onClick={() => setView('create')} 
              variant="brand" 
              className="font-bold gap-2 rounded-xl"
            >
              <Plus className="h-4 w-4" />
              {tLocal.createBtn}
            </Button>
          </div>
        )}
      </div>

      {success && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-border bg-card/65 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-foreground/65" aria-hidden="true" />
          <span>{tLocal.autoClosePolicy}</span>
        </p>
      )}

      {/* Main List Layout */}
      {!success ? (
        <Card className="border-destructive/20 bg-destructive/5 text-destructive p-6 rounded-xl flex items-start gap-3">
          <AlertCircle className="h-6 w-6 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold">{tLocal.failedTitle}</h3>
            <p className="text-sm mt-1 text-destructive/80">
              {error || tLocal.failedDesc}
            </p>
          </div>
        </Card>
      ) : tickets.length === 0 ? (
        <Card className="border-dashed border-2 border-border bg-card/10 py-20 px-6 text-center rounded-xl flex flex-col items-center justify-center">
          <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <HelpCircle className="h-8 w-8 text-muted-foreground/80" />
          </div>
          <h3 className="text-lg font-bold">{tLocal.noTickets}</h3>
          <p className="text-muted-foreground text-sm max-w-sm mt-1.5 leading-relaxed">
            {tLocal.noTicketsDesc}
          </p>
          <Button 
            onClick={() => setView('create')} 
            variant="outline" 
            className="mt-5 font-bold gap-2 rounded-xl"
          >
            <Plus className="h-4 w-4" />
            {tLocal.createBtn}
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Search bar row */}
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={tLocal.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 bg-card/40 rounded-xl"
            />
          </div>

          {/* Vertical list of support tickets (Standard linear rows, no Kanban) */}
          <div className="flex flex-col gap-3">
            {filteredTickets.map((ticket) => {
              const stageName = Array.isArray(ticket.stage_id) ? ticket.stage_id[1] : 'New'
              const stageVariant = getStageVariant(stageName)
              const refNo = ticket.ticket_ref || `#${ticket.id}`
              const createdDate = new Date(ticket.create_date).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })

              return (
                <Card 
                  key={ticket.id} 
                  onClick={() => {
                    setSelectedTicket(ticket)
                    setView('detail')
                  }}
                  className="group hover:border-foreground/45 hover:bg-secondary/10 cursor-pointer transition-all duration-200 bg-card/50 backdrop-blur-sm rounded-xl border border-border w-full"
                >
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left details */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/80 bg-secondary/80 px-2.5 py-1 rounded-full shrink-0">
                        <Tag className="h-3 w-3" />
                        {refNo}
                      </span>
                      
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="min-w-0 truncate text-sm font-bold transition-colors duration-200 group-hover:text-foreground">
                            {ticket.name}
                          </h3>
                          {ticket.unread_count > 0 && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white" aria-label={ticket.unread_count + ' unread messages'}>
                              {ticket.unread_count > 99 ? '99+' : ticket.unread_count}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {formatDescription(ticket.description)}
                        </p>
                      </div>
                    </div>

                    {/* Right details */}
                    <div className="flex items-center justify-between md:justify-end gap-6 shrink-0 border-t md:border-t-0 pt-2.5 md:pt-0 border-border/30">
                      <Badge variant={stageVariant} className="capitalize text-[10px] py-0.5 px-2.5 font-bold">
                        {stageName}
                      </Badge>
                      
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-semibold">
                        <Calendar className="h-3.5 w-3.5" />
                        {createdDate}
                      </span>
                      
                      <span className="text-foreground text-xs font-bold flex items-center gap-1">
                        {tLocal.detailsBtn}
                        <BackIcon className={cn("h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5", dir === 'rtl' ? "rotate-180" : "")} />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          
          {filteredTickets.length === 0 && searchQuery && (
            <div className="text-center py-10 text-sm text-muted-foreground bg-card/10 rounded-xl border border-dashed border-border">
              No tickets match your search query.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
