'use client'

import { useState, Fragment } from 'react'
import { Save, Loader2, CheckSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { updateZidSyncSettings } from '@/app/actions/workspaces'

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

interface SyncSettingsTableProps {
  merchantId: string
  initialSettings: any
}

export default function SyncSettingsTable({ merchantId, initialSettings }: SyncSettingsTableProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

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
        title: 'تم الحفظ بنجاح',
        description: 'تم تحديث خيارات المزامنة بين أودو وزد بنجاح.',
      })
    } else {
      toast({
        title: 'خطأ في الحفظ',
        description: res.error || 'فشل حفظ الإعدادات، يرجى المحاولة لاحقاً.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-primary" />
          خيارات مزامنة البيانات (Sync Settings Options)
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border-none text-right">
          <thead>
            <tr className="border-b border-border/40">
              <th className="py-3 px-4 font-bold text-foreground text-right w-1/2">
                الحدث (Event)
              </th>
              <th className="py-3 px-4 font-bold text-foreground text-center w-1/4">
                odoo2zid
              </th>
              <th className="py-3 px-4 font-bold text-foreground text-center w-1/4">
                zid2odoo
              </th>
            </tr>
          </thead>
          <tbody>
            {SYNC_GROUPS.map((group) => (
              <Fragment key={group.title}>
                {/* Category Header Row */}
                <tr className="bg-muted/40 border-y border-border/40">
                  <td colSpan={3} className="py-2 px-4 font-extrabold text-sm text-primary text-right select-none">
                    {group.title}
                  </td>
                </tr>
                {/* Options in Category */}
                {group.options.map((opt) => (
                  <tr key={opt.key} className="hover:bg-muted/30 transition-colors border-none">
                    <td className="py-2.5 px-8 text-sm font-medium text-foreground text-right select-none">
                      {opt.label}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={settings[opt.key]?.odoo2zid || false}
                        onChange={(e) => handleCheckboxChange(opt.key, 'odoo2zid', e.target.checked)}
                        className="h-5 w-5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-emerald-500 focus:ring-2 focus:ring-emerald-500 accent-emerald-500 cursor-pointer transition-all"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={settings[opt.key]?.zid2odoo || false}
                        onChange={(e) => handleCheckboxChange(opt.key, 'zid2odoo', e.target.checked)}
                        className="h-5 w-5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-emerald-500 focus:ring-2 focus:ring-emerald-500 accent-emerald-500 cursor-pointer transition-all"
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end pt-4 border-t border-border/40">
        <Button 
          onClick={handleSave} 
          disabled={loading}
          className="gradient-brand text-white flex items-center gap-2 px-6 py-5 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          حفظ إعدادات المزامنة (Save Sync Options)
        </Button>
      </div>
    </div>
  )
}
