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

interface Workspace {
  id: string
  name: string
  created_at: string
  merchant_tokens?: { merchant_id: string }[]
  odoo_connections?: { id: string }[]
}

export default function WorkspacePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  
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
      alert(res.error || 'فشل في إنشاء بيئة العمل')
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
      alert(res.error || 'فشل في تعديل اسم بيئة العمل')
    }
    setIsSubmitting(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في حذف بيئة العمل هذه؟ لا يمكن التراجع عن هذا الإجراء.')) return
    const res = await deleteWorkspace(id)
    if (res.success) {
      fetchWorkspaces()
    } else {
      alert(res.error || 'فشل في حذف بيئة العمل')
    }
  }

  const handleSetActive = async (id: string) => {
    const res = await setActiveWorkspace(id)
    if (res.success) {
      setActiveId(id)
    } else {
      alert(res.error || 'فشل في تعيين بيئة العمل كنشطة')
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-8" dir="rtl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            بيئات العمل (Workspaces)
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base leading-relaxed">
            قم بإنشاء وإدارة بيئات عمل مستقلة لربط متجرك الإلكتروني على زد (Zid) مع نظام ERP أودو (Odoo).
          </p>
        </div>
        <Button 
          onClick={() => setIsAddOpen(true)} 
          className="gradient-brand text-white flex items-center gap-2 px-5 py-6 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300 self-start sm:self-center"
        >
          <Plus className="h-5 w-5" /> إنشاء بيئة عمل جديدة
        </Button>
      </div>

      {/* Add Workspace Card/Form */}
      {isAddOpen && (
        <div className="rounded-2xl border bg-card/50 backdrop-blur-md p-6 shadow-xl border-primary/20 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
            <Plus className="h-5 w-5" /> إضافة بيئة عمل جديدة
          </h3>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="workspace-name" className="text-sm font-medium text-muted-foreground">اسم بيئة العمل</label>
              <input
                id="workspace-name"
                type="text"
                placeholder="مثال: الفرع الرئيسي، متجر جدة، البيئة التجريبية"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-xl border border-input bg-background/50 px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" className="rounded-xl px-5" onClick={() => setIsAddOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={isSubmitting} variant="brand" className="rounded-xl px-6 text-white gradient-brand">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إنشاء البيئة'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Workspace Card/Form */}
      {editingWorkspace && (
        <div className="rounded-2xl border bg-card/50 backdrop-blur-md p-6 shadow-xl border-primary/30 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
            <Edit3 className="h-5 w-5" /> تعديل اسم بيئة العمل
          </h3>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-workspace-name" className="text-sm font-medium text-muted-foreground">الاسم الجديد</label>
              <input
                id="edit-workspace-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-xl border border-input bg-background/50 px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" className="rounded-xl px-5" onClick={() => setEditingWorkspace(null)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={isSubmitting} variant="brand" className="rounded-xl px-6 text-white gradient-brand">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ التعديلات'}
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
        <div className="text-center py-20 border border-dashed rounded-2xl bg-card/30 flex flex-col items-center justify-center p-6">
          <Briefcase className="h-16 w-16 text-muted-foreground/40 mb-4 stroke-[1.2]" />
          <h3 className="text-lg font-semibold text-foreground mb-2">لا توجد بيئات عمل حالياً</h3>
          <p className="text-muted-foreground max-w-sm text-sm mb-6 leading-relaxed">
            بيئة العمل تسمح لك بربط متجر إلكتروني مستقل مع نظام أودو وتفعيل مزامنة المنتجات والطلبات الخاصة به.
          </p>
          <Button onClick={() => setIsAddOpen(true)} className="gradient-brand text-white rounded-xl px-6 shadow-md">
            إنشاء أول بيئة عمل
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeId
            const zidConnected = (ws.merchant_tokens?.length ?? 0) > 0
            const odooConnected = (ws.odoo_connections?.length ?? 0) > 0
            
            return (
              <div
                key={ws.id}
                className={`group flex flex-col justify-between p-6 rounded-2xl border bg-card/45 backdrop-blur-sm transition-all duration-300 relative overflow-hidden ${
                  isActive 
                    ? 'border-primary ring-2 ring-primary/20 shadow-md bg-gradient-to-br from-primary/[0.01] to-purple-500/[0.01]' 
                    : 'hover:border-border/80 hover:shadow-md hover:bg-card/70'
                }`}
              >
                {/* Visual Accent for Active Workspace */}
                {isActive && (
                  <div className="absolute top-0 right-0 left-0 h-[3px] bg-gradient-to-r from-primary to-purple-600" />
                )}

                <div className="space-y-4">
                  {/* Top Bar inside Card */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h2 className="font-bold text-xl text-foreground group-hover:text-primary transition-colors duration-200">
                          {ws.name}
                        </h2>
                        {isActive && (
                          <span className="text-[11px] font-bold bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 fill-primary/10" /> النشطة
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/80 font-mono select-all">معرف: {ws.id}</p>
                    </div>
                  </div>

                  {/* Integration Status Badges */}
                  <div className="grid grid-cols-2 gap-3 py-2 border-y border-border/40">
                    {/* Zid Connection */}
                    <div className={`flex items-center gap-3.5 p-2.5 rounded-xl border ${
                      zidConnected 
                        ? 'bg-emerald-500/[0.03] border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                        : 'bg-muted/40 border-border/50 text-muted-foreground'
                    }`}>
                      <div className={`p-1.5 rounded-lg ${zidConnected ? 'bg-emerald-500/10' : 'bg-muted'}`}>
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-[11px] text-muted-foreground">منصة زد</span>
                        <span className="text-xs font-bold leading-none mt-1">
                          {zidConnected ? 'متصل بنجاح' : 'غير متصل'}
                        </span>
                      </div>
                    </div>

                    {/* Odoo Connection */}
                    <div className={`flex items-center gap-3.5 p-2.5 rounded-xl border ${
                      odooConnected 
                        ? 'bg-indigo-500/[0.03] border-indigo-500/20 text-indigo-600 dark:text-indigo-400' 
                        : 'bg-muted/40 border-border/50 text-muted-foreground'
                    }`}>
                      <div className={`p-1.5 rounded-lg ${odooConnected ? 'bg-indigo-500/10' : 'bg-muted'}`}>
                        <Database className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-[11px] text-muted-foreground">نظام أودو ERP</span>
                        <span className="text-xs font-bold leading-none mt-1">
                          {odooConnected ? 'متصل بنجاح' : 'غير متصل'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Controls inside Card */}
                <div className="flex items-center justify-between gap-4 mt-6 pt-2">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    أنشئت في {formatDate(ws.created_at)}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetActive(ws.id)}
                        className="text-xs font-bold text-primary hover:bg-primary/10 rounded-lg px-3 py-1.5"
                      >
                        تفعيل
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-lg h-9 w-9 border border-border/50 hover:bg-accent"
                      onClick={() => {
                        setEditingWorkspace(ws)
                        setEditName(ws.name)
                      }}
                      title="تعديل الاسم"
                    >
                      <Edit3 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-lg h-9 w-9 border border-border/50 hover:bg-destructive/10 hover:border-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                      onClick={() => handleDelete(ws.id)}
                      title="حذف بيئة العمل"
                      disabled={isActive && workspaces.length > 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
