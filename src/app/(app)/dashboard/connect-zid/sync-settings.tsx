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

function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center justify-center h-4 w-4 rounded border transition-colors",
        checked
          ? "bg-foreground border-foreground text-background"
          : "bg-background border-border hover:border-foreground/50"
      )}
    >
      <Check className={cn("h-3 w-3 stroke-[3]", checked ? "opacity-100" : "opacity-0")} />
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
      <button onClick={() => setIsMainOpen(!isMainOpen)}
        className="w-full flex items-center justify-between hover:opacity-80 transition-opacity">
        <h3 className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          <span>{t('zid.syncSettings')}</span>
        </h3>
        <div className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground">
          {isMainOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isMainOpen && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full border-collapse text-start">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="py-3 px-4 font-medium text-foreground text-start w-1/2">
                    {t('zid.event')}
                  </th>
                  <th className="py-3 px-4 font-medium text-center w-1/2">
                    <span className="text-muted-foreground">
                      {lang === 'ar' ? 'حدث زد' : 'Zid Event'}
                    </span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">(store2erp)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {SYNC_GROUPS.map((group) => {
                  const isOpen = !!openGroups[group.title]
                  return (
                    <Fragment key={group.title}>
                      {/* Category Header Row (Sub-accordion Trigger) */}
                      <tr onClick={() => toggleGroup(group.title)}
                        className="hover:bg-muted/30 transition-colors border-b border-border cursor-pointer select-none">
                        <td colSpan={2} className="py-2 px-4 text-[11px] font-medium text-foreground">
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
                            <CustomCheckbox checked={settings[opt.key]?.zid2odoo || false}
                              onChange={(val) => handleCheckboxChange(opt.key, 'zid2odoo', val)} />
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
              {t('zid.saveSettings')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
