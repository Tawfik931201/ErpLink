'use client'

import { useState, Fragment } from 'react'
import { Save, Loader2, CheckSquare, Plus, Minus, ChevronDown, ChevronUp, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { updateSallaSyncSettings } from '@/app/actions/workspaces'
import { useLanguage } from '@/components/language-provider'
import { cn } from '@/lib/utils'

const SALLA_SYNC_GROUPS = [
  {
    title: 'Order',
    options: [
      { key: 'order.created', label: 'Order Created' },
      { key: 'order.updated', label: 'Order Updated' },
      { key: 'order.status.updated', label: 'Order Status Updated' },
      { key: 'order.cancelled', label: 'Order Cancelled' },
      { key: 'order.refunded', label: 'Order Refunded' },
      { key: 'order.deleted', label: 'Order Deleted' },
      { key: 'order.payment.updated', label: 'Order Payment Updated' }
    ]
  },
  {
    title: 'Product',
    options: [
      { key: 'product.created', label: 'Product Created' },
      { key: 'product.updated', label: 'Product Updated' },
      { key: 'product.deleted', label: 'Product Deleted' },
      { key: 'product.publish', label: 'Product Published' }
    ]
  },
  {
    title: 'Product Stock',
    options: [
      { key: 'product.available', label: 'Product Available' },
      { key: 'product.quantity.low', label: 'Product Quantity Low' }
    ]
  },
  {
    title: 'Location / Branch',
    options: [
      { key: 'store.branch.created', label: 'Branch Created' },
      { key: 'store.branch.updated', label: 'Branch Updated' },
      { key: 'store.branch.deleted', label: 'Branch Deleted' }
    ]
  },
  {
    title: 'Abandoned Cart',
    options: [
      { key: 'abandoned.cart', label: 'Abandoned Cart' },
      { key: 'abandoned.cart.update', label: 'Abandoned Cart Update' },
      { key: 'abandoned.cart.purchased', label: 'Abandoned Cart Purchased' }
    ]
  },
  {
    title: 'Category',
    options: [
      { key: 'category.created', label: 'Category Created' },
      { key: 'category.updated', label: 'Category Updated' }
    ]
  },
  {
    title: 'Customer',
    options: [
      { key: 'customer.created', label: 'Customer Created' },
      { key: 'customer.updated', label: 'Customer Updated' },
      { key: 'customer.login', label: 'Customer Login' }
    ]
  }
]

interface CustomCheckboxProps {
  checked: boolean
  onChange: (val: boolean) => void
  color?: string
}

function CustomCheckbox({ checked, onChange, color = 'bg-[#00878a]' }: CustomCheckboxProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center justify-center h-5 w-5 rounded-md border text-white transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-primary/20 hover:scale-105 active:scale-95",
        checked 
          ? `${color} border-transparent shadow-sm` 
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40"
      )}
    >
      <Check className={cn("h-3.5 w-3.5 stroke-[3.5] transition-transform duration-200", checked ? "scale-100" : "scale-0")} />
    </button>
  )
}

interface SallaSyncSettingsTableProps {
  merchantId: string
  initialSettings: any
}

export default function SallaSyncSettingsTable({ merchantId, initialSettings }: SallaSyncSettingsTableProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [isMainOpen, setIsMainOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const { t, lang, dir } = useLanguage()

  const [settings, setSettings] = useState<Record<string, { odoo2salla: boolean; salla2odoo: boolean }>>(() => {
    const initial = {} as any
    const parsedInitial = typeof initialSettings === 'string' 
      ? JSON.parse(initialSettings) 
      : (initialSettings || {})

    SALLA_SYNC_GROUPS.forEach(group => {
      group.options.forEach(opt => {
        initial[opt.key] = {
          odoo2salla: parsedInitial[opt.key]?.odoo2salla ?? false,
          salla2odoo: parsedInitial[opt.key]?.salla2odoo ?? false,
        }
      })
    })
    return initial
  })

  const toggleGroup = (title: string) => {
    setOpenGroups(prev => ({
      ...prev,
      [title]: !prev[title]
    }))
  }

  const handleCheckboxChange = (key: string, field: 'odoo2salla' | 'salla2odoo', value: boolean) => {
    setSettings(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }))
  }

  const handleSave = async () => {
    setLoading(true)
    const res = await updateSallaSyncSettings(merchantId, settings)
    setLoading(false)

    if (res.success) {
      toast({
        title: t('salla.settingsSaved'),
        description: lang === 'ar' ? 'تم تحديث خيارات المزامنة بين أودو وسلة بنجاح.' : 'Sync options updated between Odoo and Salla successfully.',
      })
    } else {
      toast({
        title: t('salla.settingsFailed'),
        description: res.error || (lang === 'ar' ? 'فشل حفظ الإعدادات، يرجى المحاولة لاحقاً.' : 'Failed to save settings, please try again later.'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6" dir={dir}>
      {/* Main Accordion Trigger Header */}
      <button 
        onClick={() => setIsMainOpen(!isMainOpen)}
        className="w-full flex items-center justify-between border-b border-border/60 pb-3 hover:opacity-80 transition-opacity"
      >
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2.5">
          <CheckSquare className="h-5 w-5 text-emerald-500 animate-pulse" />
          <span>{t('salla.syncSettings')}</span>
        </h3>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          {isMainOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {isMainOpen && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="overflow-x-auto rounded-2xl border border-border shadow-sm bg-card">
            <table className="w-full border-collapse text-start">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="py-3.5 px-6 font-bold text-foreground/90 text-start w-1/2 text-sm">
                    {t('zid.event')}
                  </th>
                  <th className="py-3.5 px-4 font-bold text-center w-1/2 text-sm">
                    <span className="text-teal-600 font-mono tracking-tight block dark:text-teal-400">
                      {lang === 'ar' ? 'حدث سلة' : 'Salla Event'}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono lowercase block mt-0.5">(store2erp)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {SALLA_SYNC_GROUPS.map((group) => {
                  const isOpen = !!openGroups[group.title]
                  return (
                    <Fragment key={group.title}>
                      {/* Category Header Row (Sub-accordion Trigger) */}
                      <tr 
                        onClick={() => toggleGroup(group.title)}
                        className="bg-secondary/40 hover:bg-secondary/60 transition-colors border-b border-border cursor-pointer select-none"
                      >
                        <td colSpan={2} className="py-3 px-6 font-bold text-sm text-foreground/90 text-start flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-card border border-border text-muted-foreground shrink-0">
                            {isOpen ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                          </span>
                          <span>{group.title}</span>
                        </td>
                      </tr>

                      {/* Options in Category - Only visible when sub-accordion group is open */}
                      {isOpen && group.options.map((opt) => (
                        <tr key={opt.key} className="hover:bg-secondary/20 transition-colors border-b border-border/60 last:border-b-0 animate-in slide-in-from-top-1 duration-150">
                          <td className="py-3 px-12 text-sm font-medium text-muted-foreground text-start select-none">
                            {opt.label}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <CustomCheckbox
                              checked={settings[opt.key]?.salla2odoo || false}
                              onChange={(val) => handleCheckboxChange(opt.key, 'salla2odoo', val)}
                              color="bg-[#00878a]"
                            />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <Button 
              onClick={handleSave} 
              disabled={loading}
              className="bg-gradient-to-r from-[#1a4a40] to-[#1f5a50] dark:from-[#163d35] dark:to-[#1a4a40] text-white/90 flex items-center gap-2 px-6 py-5 rounded-xl shadow-none hover:brightness-110 transition-all duration-300 font-bold border border-white/5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('salla.saveSettings')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
