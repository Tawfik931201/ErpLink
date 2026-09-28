'use client'

import { Save, Loader2, CheckSquare, Plus, Minus, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { useState, Fragment } from 'react'

import { updateSallaSyncSettings } from '@/app/actions/workspaces'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
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

// P0 core preset: orders + products + customers (store → ERP) ON by default.
// Reverse direction (ERP → store) stays OFF — managed from Mapping Center.
const CORE_SALLA_EVENTS = [
  'order.created',
  'order.updated',
  'order.status.updated',
  'order.cancelled',
  'order.refunded',
  'order.payment.updated',
  'product.created',
  'product.updated',
  'product.deleted',
  'product.publish',
  'customer.created',
  'customer.updated',
]

function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center justify-center h-4 w-4 rounded border transition-colors",
        checked ? "bg-foreground border-foreground text-background" : "bg-background border-border hover:border-foreground/50"
      )}>
      <Check className={cn("h-3 w-3 stroke-[3]", checked ? "opacity-100" : "opacity-0")} />
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
    // First run (no saved settings): enable the core preset in store → ERP direction.
    const hasSaved = !!parsedInitial && Object.keys(parsedInitial).length > 0

    SALLA_SYNC_GROUPS.forEach(group => {
      group.options.forEach(opt => {
        initial[opt.key] = {
          odoo2salla: hasSaved ? (parsedInitial[opt.key]?.odoo2salla ?? false) : false,
          salla2odoo: hasSaved ? (parsedInitial[opt.key]?.salla2odoo ?? false) : CORE_SALLA_EVENTS.includes(opt.key),
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

  const applyCorePreset = () => {
    setSettings(prev => {
      const next = { ...prev }
      SALLA_SYNC_GROUPS.forEach(group => {
        group.options.forEach(opt => {
          next[opt.key] = { odoo2salla: false, salla2odoo: CORE_SALLA_EVENTS.includes(opt.key) }
        })
      })
      return next
    })
  }

  const applySelectAll = () => {
    setSettings(prev => {
      const next = { ...prev }
      SALLA_SYNC_GROUPS.forEach(group => {
        group.options.forEach(opt => {
          next[opt.key] = { odoo2salla: true, salla2odoo: true }
        })
      })
      return next
    })
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
      <button onClick={() => setIsMainOpen(!isMainOpen)}
        className="w-full flex items-center justify-between hover:opacity-80 transition-opacity">
        <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          <span>{t('salla.syncSettings')}</span>
        </h3>
        <div className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground">
          {isMainOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isMainOpen && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{t('sync.presetCore')}</span>
            <div className="ms-auto flex gap-2">
              <Button onClick={applySelectAll} variant="outline" size="sm" className="h-7 text-[11px]">
                {t('sync.selectAll')}
              </Button>
              <Button onClick={applyCorePreset} variant="outline" size="sm" className="h-7 text-[11px]">
                {t('sync.coreOnly')}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full border-collapse text-start">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="py-3 px-4 font-medium text-foreground text-start w-1/3">
                    {t('zid.event')}
                  </th>
                  <th className="py-3 px-4 font-medium text-center w-1/3">
                    <span className="text-muted-foreground">{lang === 'ar' ? 'سلة → أودو' : 'Salla → ERP'}</span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">(store2erp)</span>
                  </th>
                  <th className="py-3 px-4 font-medium text-center w-1/3">
                    <span className="text-muted-foreground">{lang === 'ar' ? 'أودو → سلة' : 'ERP → Salla'}</span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">(erp2store)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {SALLA_SYNC_GROUPS.map((group) => {
                  const isOpen = !!openGroups[group.title]
                  return (
                    <Fragment key={group.title}>
                      {/* Category Header Row (Sub-accordion Trigger) */}
                      <tr onClick={() => toggleGroup(group.title)}
                        className="hover:bg-muted/30 transition-colors border-b border-border cursor-pointer select-none">
                        <td colSpan={3} className="py-2 px-4 text-[11px] font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{isOpen ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}</span>
                            <span>{group.title}</span>
                          </div>
                        </td>
                      </tr>

                      {/* Options in Category - Only visible when sub-accordion group is open */}
                      {isOpen && group.options.map((opt) => (
                        <tr key={opt.key} className="hover:bg-muted/20 transition-colors border-b border-border/40 last:border-b-0">
                          <td className="py-2 px-8 text-[11px] text-muted-foreground">{opt.label}</td>
                          <td className="py-2 px-4 text-center">
                            <CustomCheckbox checked={settings[opt.key]?.salla2odoo || false}
                              onChange={(val) => handleCheckboxChange(opt.key, 'salla2odoo', val)} />
                          </td>
                          <td className="py-2 px-4 text-center">
                            <CustomCheckbox checked={settings[opt.key]?.odoo2salla || false}
                              onChange={(val) => handleCheckboxChange(opt.key, 'odoo2salla', val)} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-3 border-t border-border">
            <Button onClick={handleSave} disabled={loading} variant="outline" size="sm" className="h-7 text-[11px] gap-1.5">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {t('salla.saveSettings')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
