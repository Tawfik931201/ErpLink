'use client'

import { useUser } from '@clerk/nextjs'
import {
  Users,
  Loader2,
  Plus,
  X,
  ShieldCheck,
  Trash2,
  Crown,
  Mail,
  Check,
} from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'

import {
  getWorkspaceMembers,
  inviteMember,
  removeMember,
  revokeInvitation,
  updateMemberPermissions,
} from '@/app/actions/workspace-members'
import { getWorkspaces } from '@/app/actions/workspaces'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { ALL_PAGES } from '@/lib/workspace-members-constants'

interface Member {
  user_id: string
  email: string
  name: string
  role: string
  permissions: string[]
  created_at: string
}

interface PendingInvitation {
  id: string
  name: string
  email: string
  invited_by: string
  permissions: string[]
  status: string
  created_at: string
}

export default function TeamPage() {
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Member[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([])
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const { lang, dir } = useLanguage()
  const { user: clerkUser } = useUser()

  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermissions, setInvitePermissions] = useState<string[]>(
    ALL_PAGES.map((p) => p.id),
  )
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [editingPermissions, setEditingPermissions] = useState<{
    userId: string
    permissions: string[]
  } | null>(null)
  const [savingPermissions, setSavingPermissions] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  const fetchData = useCallback(async (currentUserId?: string) => {
    setLoading(true)
    setMessage(null)

    const wsRes = await getWorkspaces()
    if (!wsRes.success || !wsRes.workspaces || wsRes.workspaces.length === 0) {
      setLoading(false)
      return
    }

    const activeId = wsRes.activeWorkspaceId || wsRes.workspaces[0].id
    const activeWs = wsRes.workspaces.find((w: any) => w.id === activeId)
    setWorkspaceId(activeId)
    setIsOwner(activeWs?.user_id === currentUserId || false)

    const res = await getWorkspaceMembers(activeId)
    if (res.success) {
      setMembers(res.members || [])
      setPendingInvitations(res.pendingInvitations || [])
      setOwnerId(res.ownerId || null)
      setOwnerEmail(res.ownerEmail || '')
      setOwnerName(res.ownerName || '')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(clerkUser?.id)
  }, [fetchData, clerkUser?.id])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim() || !workspaceId) return

    setSubmitting(true)
    setMessage(null)

    const res = await inviteMember(workspaceId, inviteEmail.trim(), invitePermissions, inviteName.trim())
    if (res.success) {
      setMessage({ type: 'success', text: res.message || (lang === 'ar' ? 'تمت الدعوة بنجاح' : 'Invitation sent successfully') })
      setInviteName('')
      setInviteEmail('')
      setShowInviteForm(false)
      fetchData(clerkUser?.id)
    } else {
      setMessage({ type: 'error', text: res.error || (lang === 'ar' ? 'فشلت الدعوة' : 'Invitation failed') })
    }
    setSubmitting(false)
  }

  const handleRevoke = async (invitationId: string) => {
    setRevokeTarget(invitationId)
  }

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return
    const res = await revokeInvitation(revokeTarget)
    setRevokeTarget(null)
    if (res.success) {
      fetchData(clerkUser?.id)
    } else {
      setMessage({ type: 'error', text: res.error || (lang === 'ar' ? 'فشل في إلغاء الدعوة' : 'Failed to revoke invitation') })
    }
  }

  const handleRemove = async (userId: string) => {
    setRemoveTarget(userId)
  }

  const handleRemoveConfirm = async () => {
    if (!removeTarget || !workspaceId) return
    const res = await removeMember(workspaceId, removeTarget)
    setRemoveTarget(null)
    if (res.success) {
      fetchData(clerkUser?.id)
    } else {
      setMessage({ type: 'error', text: res.error || (lang === 'ar' ? 'فشل في حذف العضو' : 'Failed to remove member') })
    }
  }

  const handleSavePermissions = async () => {
    if (!editingPermissions || !workspaceId) return
    setSavingPermissions(true)

    const res = await updateMemberPermissions(
      workspaceId,
      editingPermissions.userId,
      editingPermissions.permissions,
    )
    if (res.success) {
      setEditingPermissions(null)
      fetchData(clerkUser?.id)
    } else {
      setMessage({ type: 'error', text: res.error || (lang === 'ar' ? 'فشل في تحديث الصلاحيات' : 'Failed to update permissions') })
    }
    setSavingPermissions(false)
  }

  const togglePermission = (pageId: string) => {
    if (!editingPermissions) return
    const exists = editingPermissions.permissions.includes(pageId)
    if (exists) {
      setEditingPermissions({
        ...editingPermissions,
        permissions: editingPermissions.permissions.filter((p) => p !== pageId),
      })
    } else {
      setEditingPermissions({
        ...editingPermissions,
        permissions: [...editingPermissions.permissions, pageId],
      })
    }
  }

  const toggleInvitePermission = (pageId: string) => {
    const exists = invitePermissions.includes(pageId)
    if (exists) {
      setInvitePermissions(invitePermissions.filter((p) => p !== pageId))
    } else {
      setInvitePermissions([...invitePermissions, pageId])
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8" dir={dir}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
            {lang === 'ar' ? 'فريق العمل' : 'Team Members'}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {lang === 'ar'
              ? 'إدارة أعضاء فريق العمل وتحديد صلاحيات الوصول لكل عضو.'
              : 'Manage team members and set page-level access permissions.'}
          </p>
        </div>
        {isOwner && (
          <Button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="bg-foreground text-background flex items-center gap-2 px-5 py-6 rounded-xl transition-all duration-300 self-start sm:self-center font-bold"
          >
            <Plus className="h-5 w-5" />{' '}
            {lang === 'ar' ? 'دعوة عضو جديد' : 'Invite Member'}
          </Button>
        )}
      </div>

      {/* Message */}
      {message && (
        <div
          className={cn(
            'rounded-xl px-4 py-3 text-sm font-medium border',
            message.type === 'success'
              ? 'bg-muted/50 border-border text-foreground'
              : 'bg-destructive/5 border-destructive/20 text-destructive',
          )}
        >
          {message.text}
        </div>
      )}

      {/* Invite Form */}
      {showInviteForm && isOwner && (
        <div className="rounded-xl border bg-card p-6 border-border animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-foreground">
            <Mail className="h-5 w-5" />{' '}
            {lang === 'ar' ? 'دعوة عضو جديد' : 'Invite New Member'}
          </h3>
          <form onSubmit={handleInvite} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-muted-foreground">
                {lang === 'ar' ? 'الاسم' : 'Name'}
              </label>
              <input
                type="text"
                placeholder={lang === 'ar' ? 'مثال: أحمد محمد' : 'Example: John Doe'}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 transition-all"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-muted-foreground">
                {lang === 'ar' ? 'البريد الإلكتروني' : 'Email Address'}
              </label>
              <input
                type="email"
                placeholder={lang === 'ar' ? 'member@example.com' : 'member@example.com'}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 transition-all"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-muted-foreground">
                {lang === 'ar' ? 'الصلاحيات' : 'Page Permissions'}
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_PAGES.map((page) => {
                  const selected = invitePermissions.includes(page.id)
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => toggleInvitePermission(page.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all',
                        selected
                        ? 'bg-muted border-border text-foreground'
                        : 'bg-secondary/30 border-border/50 text-muted-foreground hover:border-foreground/30',
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {lang === 'ar' ? page.labelAr : page.labelEn}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl px-5"
                onClick={() => setShowInviteForm(false)}
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                variant="brand"
                className="rounded-xl px-6 bg-foreground text-background font-bold"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : lang === 'ar' ? (
                  'إرسال الدعوة'
                ) : (
                  'Send Invitation'
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Members List */}
      {members.length === 0 && pendingInvitations.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl bg-secondary/10 flex flex-col items-center justify-center p-6">
          <Users className="h-16 w-16 text-muted-foreground/45 mb-4 stroke-[1.2]" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {lang === 'ar' ? 'لا يوجد أعضاء بعد' : 'No Members Yet'}
          </h3>
          <p className="text-muted-foreground max-w-sm text-sm mb-6 leading-relaxed">
            {lang === 'ar'
              ? 'قم بدعوة أعضاء للانضمام إلى بيئة العمل وتحديد الصفحات المتاحة لكل عضو.'
              : 'Invite members to join this workspace and set which pages they can access.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Owner Card */}
          {ownerId && (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-muted/30 dark:bg-muted/50 dark:border-border">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shrink-0">
                <Crown className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground truncate">
                    {ownerName || ownerEmail}
                  </span>
                  <span className="text-[10px] font-bold bg-muted dark:bg-muted/50 text-foreground border border-border px-2 py-0.5 rounded-full shrink-0">
                    {lang === 'ar' ? 'المالك' : 'Owner'}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{ownerEmail}</span>
              </div>
              <ShieldCheck className="h-4 w-4 text-foreground shrink-0" />
            </div>
          )}

          {/* Pending Invitations */}
          {pendingInvitations.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-4 pb-1">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {lang === 'ar' ? 'دعوات معلقة' : 'Pending Invitations'}
                </span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
              {pendingInvitations.map((inv) => (
                <div
                  key={inv.id}
                  className="group flex flex-col p-4 rounded-xl border border-dashed border-border bg-muted/20 dark:bg-muted/50 transition-all duration-300 gap-3"
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted dark:bg-muted/50 text-foreground text-sm font-extrabold shrink-0">
                        {(inv.name || inv.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground block truncate">
                            {inv.name || inv.email.split('@')[0]}
                          </span>
                  <span className="text-[10px] font-bold bg-muted dark:bg-muted/50 text-foreground border border-border px-2 py-0.5 rounded-full shrink-0">
                            {lang === 'ar' ? 'قيد الانتظار' : 'Pending'}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground block truncate">
                          {inv.email}
                        </span>
                      </div>
                    </div>

                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevoke(inv.id)}
                        className="rounded-lg h-8 w-8 border border-border/50 hover:bg-destructive/10 hover:border-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                        title={lang === 'ar' ? 'إلغاء الدعوة' : 'Revoke invitation'}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Members Section Header */}
          {members.length > 0 && (
            <div className="flex items-center gap-2 pt-4 pb-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'الأعضاء النشطون' : 'Active Members'}
              </span>
              <div className="h-px flex-1 bg-border/40" />
            </div>
          )}

          {/* Member Cards */}
          {members.map((member) => (
            <div
              key={member.user_id}
              className="group flex flex-col p-4 rounded-xl border bg-card transition-all duration-300 gap-3 hover:border-border/80"
            >
              {/* Row 1: Info + Actions */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background text-sm font-extrabold shrink-0">
                    {(member.name || member.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-sm text-foreground block truncate">
                      {member.name || member.email.split('@')[0]}
                    </span>
                    <span className="text-xs text-muted-foreground block truncate">
                      {member.email}
                    </span>
                  </div>
                </div>

                {isOwner && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setEditingPermissions({
                          userId: member.user_id,
                          permissions: [...member.permissions],
                        })
                      }
                      className="rounded-lg h-8 w-8 border border-border/50 hover:bg-secondary"
                      title={lang === 'ar' ? 'تعديل الصلاحيات' : 'Edit permissions'}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(member.user_id)}
                      className="rounded-lg h-8 w-8 border border-border/50 hover:bg-destructive/10 hover:border-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                      title={lang === 'ar' ? 'حذف العضو' : 'Remove member'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Row 2: Permission badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-medium text-muted-foreground mr-1">
                  {lang === 'ar' ? 'الصلاحيات:' : 'Permissions:'}
                </span>
                {ALL_PAGES.map((page) => {
                  const hasAccess = member.permissions.includes(page.id)
                  return (
                    <span
                      key={page.id}
                      className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all',
                        hasAccess
                          ? 'bg-muted/50 border-border text-foreground'
                          : 'bg-secondary/40 border-border/50 text-muted-foreground/50 line-through',
                      )}
                    >
                      {lang === 'ar' ? page.labelAr : page.labelEn}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Permissions Modal */}
      {editingPermissions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-card rounded-xl border border-border shadow-2xl p-6 w-full max-w-md animate-in fade-in-50 zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-foreground" />
                {lang === 'ar' ? 'تعديل الصلاحيات' : 'Edit Permissions'}
              </h3>
              <button
                onClick={() => setEditingPermissions(null)}
                className="h-8 w-8 rounded-lg border border-border/50 flex items-center justify-center hover:bg-secondary transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 mb-6">
              {ALL_PAGES.map((page) => {
                const selected = editingPermissions.permissions.includes(page.id)
                return (
                  <button
                    key={page.id}
                    onClick={() => togglePermission(page.id)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-start',
                      selected
                      ? 'bg-muted/50 border-border text-foreground'
                      : 'bg-secondary/20 border-border/50 text-muted-foreground hover:border-foreground/20',
                    )}
                  >
                    <div
                      className={cn(
                        'h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all',
                        selected
                        ? 'bg-foreground border-foreground text-background'
                        : 'border-muted-foreground/40',
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </div>
                    <span>{lang === 'ar' ? page.labelAr : page.labelEn}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                className="rounded-xl px-5"
                onClick={() => setEditingPermissions(null)}
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
                onClick={handleSavePermissions}
                disabled={savingPermissions}
                variant="brand"
                className="rounded-xl px-6 bg-foreground text-background font-bold"
              >
                {savingPermissions ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : lang === 'ar' ? (
                  'حفظ'
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}
        title={lang === 'ar' ? 'إلغاء الدعوة' : 'Revoke Invitation'}
        description={lang === 'ar' ? 'هل أنت متأكد من إلغاء الدعوة؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure you want to revoke this invitation? This action cannot be undone.'}
        confirmText={lang === 'ar' ? 'إلغاء الدعوة' : 'Revoke'}
        onConfirm={handleRevokeConfirm}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}
        title={lang === 'ar' ? 'حذف العضو' : 'Remove Member'}
        description={lang === 'ar' ? 'هل أنت متأكد من حذف هذا العضو من بيئة العمل؟' : 'Are you sure you want to remove this member from the workspace?'}
        confirmText={lang === 'ar' ? 'حذف العضو' : 'Remove'}
        onConfirm={handleRemoveConfirm}
      />
    </div>
  )
}
