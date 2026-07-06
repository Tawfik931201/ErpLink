'use client'

import { Briefcase, Calendar, CheckCircle, Database, Edit3, Loader2, Plus, Store, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaces,
  setActiveWorkspace,
  updateWorkspace,
} from '@/app/actions/workspaces'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/language-provider'
import { cn } from '@/lib/utils'

interface Workspace {
  id: string
  name: string
  created_at: string
  merchant_tokens?: { merchant_id: string; name?: string | null }[]
  erp_connections?: { id: string }[]
}

export default function WorkspacePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { t, lang, dir } = useLanguage()
  
  // Form/Modal states
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [editName, setEditName] = useState('')

  const fetchWorkspaces = async () => {
    setLoading(true)
    const res = await getWorkspaces()
    if (res.success && res.workspaces) {
      setWorkspaces(res.workspaces as any)
      setActiveId(res.activeWorkspaceId || null)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchWorkspaces()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setIsSubmitting(true)
    const res = await createWorkspace(newName)
    if (res.success) {
      setNewName('')
      setIsAddOpen(false)
      fetchWorkspaces()
    } else {
      alert(res.error || (lang === 'ar' ? 'فشل في إنشاء بيئة العمل' : 'Failed to create workspace'))
    }
    setIsSubmitting(false)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingWorkspace || !editName.trim()) return
    setIsSubmitting(true)
    const res = await updateWorkspace(editingWorkspace.id, editName)
    if (res.success) {
      setEditingWorkspace(null)
      setEditName('')
      fetchWorkspaces()
    } else {
      alert(res.error || (lang === 'ar' ? 'فشل في تعديل اسم بيئة العمل' : 'Failed to edit workspace name'))
    }
    setIsSubmitting(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من رغبتك في حذف بيئة العمل هذه؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure you want to delete this workspace? This action cannot be undone.')) return
    const res = await deleteWorkspace(id)
    if (res.success) {
      fetchWorkspaces()
    } else {
      alert(res.error || (lang === 'ar' ? 'فشل في حذف بيئة العمل' : 'Failed to delete workspace'))
    }
  }

  const handleSetActive = async (id: string) => {
    const res = await setActiveWorkspace(id)
    if (res.success) {
      setActiveId(id)
    } else {
      alert(res.error || (lang === 'ar' ? 'فشل في تعيين بيئة العمل كنشطة' : 'Failed to set workspace as active'))
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-8" dir={dir}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            {t('ws.title')}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {t('ws.desc')}
          </p>
        </div>
        <Button 
          onClick={() => setIsAddOpen(true)} 
          className="gradient-brand text-white flex items-center gap-2 px-5 py-6 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300 self-start sm:self-center font-bold"
        >
          <Plus className="h-5 w-5" /> {t('ws.createBtn')}
        </Button>
      </div>

      {/* Add Workspace Card/Form */}
      {isAddOpen && (
        <div className="rounded-2xl border bg-card p-6 shadow-xl border-primary/20 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
            <Plus className="h-5 w-5" /> {t('ws.createBtn')}
          </h3>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="workspace-name" className="text-sm font-medium text-muted-foreground">{t('ws.nameLabel')}</label>
              <input
                id="workspace-name"
                type="text"
                placeholder={lang === 'ar' ? 'مثال: الفرع الرئيسي، متجر جدة، البيئة التجريبية' : 'Example: Main Branch, Jeddah Store, Staging'}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" className="rounded-xl px-5" onClick={() => setIsAddOpen(false)}>
                {t('ws.cancelBtn')}
              </Button>
              <Button type="submit" disabled={isSubmitting} variant="brand" className="rounded-xl px-6 text-white gradient-brand font-bold">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('ws.saveBtn')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Workspace Card/Form */}
      {editingWorkspace && (
        <div className="rounded-2xl border bg-card p-6 shadow-xl border-primary/30 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
            <Edit3 className="h-5 w-5" /> {lang === 'ar' ? 'تعديل اسم بيئة العمل' : 'Edit Workspace Name'}
          </h3>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-workspace-name" className="text-sm font-medium text-muted-foreground">{lang === 'ar' ? 'الاسم الجديد' : 'New Name'}</label>
              <input
                id="edit-workspace-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" className="rounded-xl px-5" onClick={() => setEditingWorkspace(null)}>
                {t('ws.cancelBtn')}
              </Button>
              <Button type="submit" disabled={isSubmitting} variant="brand" className="rounded-xl px-6 text-white gradient-brand font-bold">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('ws.saveBtn')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Workspaces List */}
      {loading ? (
        <div className="flex justify-center items-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-2xl bg-secondary/10 flex flex-col items-center justify-center p-6">
          <Briefcase className="h-16 w-16 text-muted-foreground/45 mb-4 stroke-[1.2]" />
          <h3 className="text-lg font-semibold text-foreground mb-2">{t('ws.noWorkspaces')}</h3>
          <p className="text-muted-foreground max-w-sm text-sm mb-6 leading-relaxed">
            {lang === 'ar' ? 'بيئة العمل تسمح لك بربط متجر إلكتروني مستقل مع نظام أودو وتفعيل مزامنة المنتجات والطلبات الخاصة به.' : 'A workspace allows you to connect an independent online store with Odoo to enable product and order synchronization.'}
          </p>
          <Button onClick={() => setIsAddOpen(true)} className="gradient-brand text-white rounded-xl px-6 shadow-md font-bold">
            {t('ws.createBtn')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeId
            const zidConnected = (ws.merchant_tokens?.length ?? 0) > 0
            const erpConnected = (ws.erp_connections?.length ?? 0) > 0
            const zidStoreName = ws.merchant_tokens?.[0]?.name
            
            return (
              <div
                key={ws.id}
                className={cn(
                  "group flex flex-col p-4 rounded-xl border bg-card transition-all duration-300 relative gap-3 overflow-hidden",
                  isActive 
                    ? 'border-primary/50 shadow-sm bg-primary/[0.01]' 
                    : 'hover:border-border/80 hover:bg-secondary/5'
                )}
              >
                {/* Visual Accent for Active Workspace */}
                {isActive && (
                  <div className={cn("absolute top-0 bottom-0 w-[3px] bg-gradient-to-b from-primary to-purple-600", lang === 'ar' ? 'right-0' : 'left-0')} />
                )}

                {/* Row 1: Name + Actions */}
                <div className={cn("flex items-center justify-between gap-4 flex-wrap", isActive && (lang === 'ar' ? 'pr-2' : 'pl-2'))}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h3 className="font-bold text-sm text-foreground truncate">
                      {ws.name}
                    </h3>
                    {isActive && (
                      <span className="text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                        <CheckCircle className="h-2.5 w-2.5 fill-primary/10" /> {t('ws.activeBadge')}
                      </span>
                    )}
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetActive(ws.id)}
                        className="text-xs font-bold text-primary hover:bg-primary/10 rounded-lg px-2.5 py-1 h-7.5"
                      >
                        {t('ws.activateBtn')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-lg h-7.5 w-7.5 border border-border/50 hover:bg-secondary"
                      onClick={() => {
                        setEditingWorkspace(ws)
                        setEditName(ws.name)
                      }}
                      title={lang === 'ar' ? 'تعديل الاسم' : 'Edit name'}
                    >
                      <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-lg h-7.5 w-7.5 border border-border/50 hover:bg-destructive/10 hover:border-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                      onClick={() => handleDelete(ws.id)}
                      title={lang === 'ar' ? 'حذف بيئة العمل' : 'Delete workspace'}
                      disabled={isActive && workspaces.length > 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Row 2: Metadata + Connection Badges */}
                <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-border/30", isActive && (lang === 'ar' ? 'pr-2' : 'pl-2'))}>
                  {/* ID & Creation Date */}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/85 font-medium flex-wrap">
                    <span className="font-mono select-all">ID: {ws.id}</span>
                    <span className="h-1 w-1 rounded-full bg-border" />
                    <span>{lang === 'ar' ? 'أنشئت في ' : 'Created at '}{formatDate(ws.created_at)}</span>
                  </div>

                  {/* Integration Status Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    {/* Zid Connection */}
                    <div className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold",
                      zidConnected 
                        ? 'bg-emerald-500/[0.03] border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                        : 'bg-secondary/40 border-border/50 text-muted-foreground'
                    )}>
                      <Store className="h-3.5 w-3.5" />
                      <span>Zid: {zidConnected ? (zidStoreName || t('db.connected')) : t('db.disconnected')}</span>
                    </div>

                    {/* ERP Connection */}
                    <div className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold",
                      erpConnected 
                        ? 'bg-indigo-500/[0.03] border-indigo-500/20 text-indigo-600 dark:text-indigo-400' 
                        : 'bg-secondary/40 border-border/50 text-muted-foreground'
                    )}>
                      <Database className="h-3.5 w-3.5" />
                      <span>ERP: {erpConnected ? t('db.connected') : t('db.disconnected')}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
