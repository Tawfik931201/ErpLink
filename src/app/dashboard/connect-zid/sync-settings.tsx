'use client'

import { useState, Fragment } from 'react'
import { Save, Loader2, CheckSquare, Plus, Minus, ChevronDown, ChevronUp, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { updateZidSyncSettings } from '@/app/actions/workspaces'
import { useLanguage } from '@/components/language-provider'
import { cn } from '@/lib/utils'

const SYNC_GROUPS = [
  {
    title: 'Order',
    options: [
      { key: 'order_create', label: 'Order Create' },
      { key: 'order_status_update', label: 'Order Status Update' },
      { key: 'order_payment_status_update', label: 'Order Payment Status Update' },
      { key: 'order_tagged', label: 'Order Tagged' }
    ]
  },
  {
    title: 'Product',
    options: [
      { key: 'product_create', label: 'Product Create' },
      { key: 'product_update', label: 'Product Update' },
      { key: 'product_delete', label: 'Product Delete' },
      { key: 'product_publish', label: 'Product Publish' }
    ]
  },
  {
    title: 'Product Stock',
    options: [
      { key: 'product_stock_create', label: 'Product Stock Create' },
      { key: 'product_stock_update', label: 'Product Stock Update' },
      { key: 'product_stock_delete', label: 'Product Stock Delete' }
    ]
  },
  {
    title: 'Location',
    options: [
      { key: 'location_create', label: 'Location Create' },
      { key: 'location_update', label: 'Location Update' },
      { key: 'location_delete', label: 'Location Delete' },
      { key: 'location_shipping_zone_attach', label: 'Location Shipping Zone Attach' },
      { key: 'location_shipping_zone_detach', label: 'Location Shipping Zone Detach' }
    ]
  },
  {
    title: 'Abandoned Cart',
    options: [
      { key: 'abandoned_cart_created', label: 'Abandoned Cart Created' },
      { key: 'abandoned_cart_completed', label: 'Abandoned Cart Completed' }
    ]
  },
  {
    title: 'Category',
    options: [
      { key: 'category_create', label: 'Category Create' },
      { key: 'category_delete', label: 'Category Delete' },
      { key: 'category_update', label: 'Category Update' }
    ]
  },
  {
    title: 'Customer',
    options: [
      { key: 'customer_create', label: 'Customer Create' },
      { key: 'customer_login', label: 'Customer Login' },
      { key: 'customer_update', label: 'Customer Update' },
      { key: 'customer_merchant_update', label: 'Customer Merchant Update' }
    ]
  }
]

interface CustomCheckboxProps {
  checked: boolean
  onChange: (val: boolean) => void
  color?: string
}

function CustomCheckbox({ checked, onChange, color = 'bg-violet-600' }: CustomCheckboxProps) {
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

interface SyncSettingsTableProps {
  merchantId: string
  initialSettings: any
}

export default function SyncSettingsTable({ merchantId, initialSettings }: SyncSettingsTableProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [isMainOpen, setIsMainOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const { t, lang, dir } = useLanguage()

  const [settings, setSettings] = useState<Record<string, { odoo2zid: boolean; zid2odoo: boolean }>>(() => {
    const initial = {} as any
    const parsedInitial = typeof initialSettings === 'string' 
      ? JSON.parse(initialSettings) 
      : (initialSettings || {})

    SYNC_GROUPS.forEach(group => {
      group.options.forEach(opt => {
        initial[opt.key] = {
          odoo2zid: parsedInitial[opt.key]?.odoo2zid ?? false,
          zid2odoo: parsedInitial[opt.key]?.zid2odoo ?? false,
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

  const handleCheckboxChange = (key: string, field: 'odoo2zid' | 'zid2odoo', value: boolean) => {
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
    const res = await updateZidSyncSettings(merchantId, settings)
    setLoading(false)

    if (res.success) {
      toast({
        title: t('zid.settingsSaved'),
        description: lang === 'ar' ? 'تم تحديث خيارات المزامنة بين أودو وزد بنجاح.' : 'Sync options updated between Odoo and Zid successfully.',
      })
    } else {
      toast({
        title: t('zid.settingsFailed'),
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
          <CheckSquare className="h-5 w-5 text-primary animate-pulse" />
          <span>{t('zid.syncSettings')}</span>
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
                    <span className="text-blue-600 font-mono tracking-tight block dark:text-blue-400">
                      {lang === 'ar' ? 'حدث زد' : 'Zid Event'}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono lowercase block mt-0.5">(store2erp)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {SYNC_GROUPS.map((group) => {
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
                              checked={settings[opt.key]?.zid2odoo || false}
                              onChange={(val) => handleCheckboxChange(opt.key, 'zid2odoo', val)}
                              color="bg-violet-600"
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
              className="bg-gradient-to-r from-[#1e3a5f] to-[#2b4a72] dark:from-[#1a3050] dark:to-[#243d60] text-white/90 flex items-center gap-2 px-6 py-5 rounded-xl shadow-none hover:brightness-110 transition-all duration-300 font-bold border border-white/5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('zid.saveSettings')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
