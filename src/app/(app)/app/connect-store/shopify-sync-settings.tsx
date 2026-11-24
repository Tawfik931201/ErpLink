'use client'

import { Save, Loader2, CheckSquare, Plus, Minus, ChevronDown, ChevronUp, Check, RefreshCw } from 'lucide-react'
import { useState, Fragment } from 'react'

import { syncShopifyWebhooks, updateShopifySyncSettings } from '@/app/actions/workspaces'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// Topic unification: keys here must match SHOPIFY_TOPIC_CATALOG in
// src/lib/shopify-topics.ts (+ shopify.app.toml + mapping-constants SHOPIFY_EVENTS).
const SHOPIFY_SYNC_GROUPS = [
  {
    title: 'Order (الطلبات)',
    options: [
      { key: 'orders/create', label: 'Order Created (إنشاء طلب)' },
      { key: 'orders/updated', label: 'Order Updated (تحديث طلب)' },
      { key: 'orders/cancelled', label: 'Order Cancelled (إلغاء طلب)' },
      { key: 'orders/fulfilled', label: 'Order Fulfilled (تنفيذ طلب)' },
      { key: 'orders/paid', label: 'Order Paid (دفع طلب)' },
      { key: 'orders/partially_fulfilled', label: 'Order Partially Fulfilled (تنفيذ جزئي للطلب)' },
      { key: 'orders/edited', label: 'Order Edited (تعديل بنود الطلب)' },
      { key: 'orders/delete', label: 'Order Deleted (حذف طلب)' }
    ]
  },
  {
    title: 'Product (المنتجات)',
    options: [
      { key: 'products/create', label: 'Product Created (إنشاء منتج)' },
      { key: 'products/update', label: 'Product Updated (تحديث منتج)' },
      { key: 'products/delete', label: 'Product Deleted (حذف منتج)' }
    ]
  },
  {
    title: 'Customer (العملاء)',
    options: [
      { key: 'customers/create', label: 'Customer Created (إنشاء عميل)' },
      { key: 'customers/update', label: 'Customer Updated (تحديث عميل)' },
      { key: 'customers/delete', label: 'Customer Deleted (حذف عميل)' }
    ]
  },
  {
    title: 'Category (التصنيفات)',
    options: [
      { key: 'collections/create', label: 'Collection Created (إنشاء تصنيف)' },
      { key: 'collections/update', label: 'Collection Updated (تحديث تصنيف)' },
      { key: 'collections/delete', label: 'Collection Deleted (حذف تصنيف)' }
    ]
  },
  {
    title: 'Carts (السلات المتروكة)',
    options: [
      { key: 'carts/create', label: 'Cart Created (إنشاء سلة)' },
      { key: 'carts/update', label: 'Cart Updated (تحديث سلة)' },
      { key: 'checkouts/create', label: 'Checkout Created (بدء الدفع)' },
      { key: 'checkouts/update', label: 'Checkout Updated (تحديث الدفع)' },
      { key: 'checkouts/delete', label: 'Checkout Deleted (إلغاء الدفع)' }
    ]
  },
  {
    title: 'Inventory (المخزون)',
    options: [
      { key: 'inventory_levels/update', label: 'Inventory Levels Updated (تحديث مستويات المخزون)' },
      { key: 'inventory_items/create', label: 'Inventory Item Created (إنشاء عنصر مخزون)' },
      { key: 'inventory_items/update', label: 'Inventory Item Updated (تحديث عنصر مخزون)' },
      { key: 'inventory_items/delete', label: 'Inventory Item Deleted (حذف عنصر مخزون)' }
    ]
  },
  {
    title: 'Refunds (المرتجعات)',
    options: [
      { key: 'refunds/create', label: 'Refund Created (إنشاء مرتجع للطلب)' }
    ]
  }
]

// P0 core preset: full catalog + all order topics + customers (store → ERP)
// ON by default. Must mirror SHOPIFY_CORE_TOPICS in src/lib/shopify-topics.ts
// (what a new connection auto-registers) — keep the two lists in sync.
// NOTE (direction unification): the reverse column (`odoo2shopify`, ERP → store)
// is tracked in state and saved with the settings, but kept hidden in this table —
// reverse sync is managed from Mapping Center / Data Transfer (see note below).
const CORE_SHOPIFY_EVENTS = [
  'products/create',
  'products/update',
  'products/delete',
  'collections/create',
  'collections/update',
  'collections/delete',
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'orders/paid',
  'orders/partially_fulfilled',
  'orders/edited',
  'orders/delete',
  'customers/create',
  'customers/update',
  'customers/delete',
]

function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center justify-center h-5 w-5 sm:h-4 sm:w-4 rounded border transition-colors active:scale-95",
        checked ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border hover:border-primary/50"
      )}>
      <Check className={cn("h-3.5 w-3.5 sm:h-3 sm:w-3 stroke-[3]", checked ? "opacity-100" : "opacity-0")} />
    </button>
  )
}

interface ShopifySyncSettingsTableProps {
  shopDomain: string
  initialSettings: any
}

export default function ShopifySyncSettingsTable({ shopDomain, initialSettings }: ShopifySyncSettingsTableProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [isMainOpen, setIsMainOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const { t, lang, dir } = useLanguage()

  const [settings, setSettings] = useState<Record<string, { odoo2shopify: boolean; shopify2odoo: boolean }>>(() => {
    const initial = {} as any
    const parsedInitial = typeof initialSettings === 'string' 
      ? JSON.parse(initialSettings) 
      : (initialSettings || {})
    // First run (no saved settings): enable the core preset in store → ERP direction.
    const hasSaved = !!parsedInitial && Object.keys(parsedInitial).length > 0

    SHOPIFY_SYNC_GROUPS.forEach(group => {
      group.options.forEach(opt => {
        initial[opt.key] = {
          odoo2shopify: hasSaved ? (parsedInitial[opt.key]?.odoo2shopify ?? false) : false,
          shopify2odoo: hasSaved ? (parsedInitial[opt.key]?.shopify2odoo ?? false) : CORE_SHOPIFY_EVENTS.includes(opt.key),
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

  const handleCheckboxChange = (key: string, field: 'odoo2shopify' | 'shopify2odoo', value: boolean) => {
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
      SHOPIFY_SYNC_GROUPS.forEach(group => {
        group.options.forEach(opt => {
          next[opt.key] = { ...next[opt.key], shopify2odoo: CORE_SHOPIFY_EVENTS.includes(opt.key) }
        })
      })
      return next
    })
  }

  const applySelectAll = () => {
    setSettings(prev => {
      const next = { ...prev }
      SHOPIFY_SYNC_GROUPS.forEach(group => {
        group.options.forEach(opt => {
          next[opt.key] = { ...next[opt.key], shopify2odoo: true }
        })
      })
      return next
    })
  }

  const handleSave = async () => {
    setLoading(true)
    const res = await updateShopifySyncSettings(shopDomain, settings)
    setLoading(false)

    if (res.success) {
      toast({
        title: t('shopify.settingsSaved'),
        // Toggle ON يسجّل webhook حقيقي و OFF يحذفه (workspaces.ts) — لا حاجة لخطوة يدوية.
        description: lang === 'ar' ? 'تم الحفظ + مزامنة الاشتراكات (ON يسجّل webhook و OFF يحذفه).' : 'Saved + subscriptions synced (ON registers, OFF deletes).',
      })
    } else {
      toast({
        title: t('shopify.settingsFailed'),
        description: (res as any).error || (lang === 'ar' ? 'فشل حفظ الإعدادات، يرجى المحاولة لاحقاً.' : 'Failed to save settings, please try again later.'),
        variant: 'destructive',
      })
    }
  }

  const [syncing, setSyncing] = useState(false)
  const handleSyncSubscriptions = async () => {
    setSyncing(true)
    const res = await syncShopifyWebhooks(shopDomain)
    setSyncing(false)
    if (res.success) {
      toast({
        title: lang === 'ar' ? 'تمت مزامنة الاشتراكات' : 'Subscriptions synced',
        description:
          lang === 'ar'
            ? `سُجّل ${(res as any).registered ?? 0} وحُذف ${(res as any).removed ?? 0} حسب الإعدادات المحفوظة.`
            : `Registered ${(res as any).registered ?? 0}, removed ${(res as any).removed ?? 0} per saved settings.`,
      })
    } else {
      toast({
        title: t('shopify.settingsFailed'),
        description: (res as any).error || '',
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
          <span>{t('shopify.syncSettings')}</span>
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
          <p className="text-[10px] text-muted-foreground leading-relaxed">{t('sync.reverseNote')}</p>
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full border-collapse text-start">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="py-3 px-4 font-medium text-foreground text-start w-1/2">
                    {t('zid.event')}
                  </th>
                  <th className="py-3 px-4 font-medium text-center w-1/2">
                    <span className="text-muted-foreground">{lang === 'ar' ? 'حدث شوبيفاي' : 'Shopify Event'}</span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">(store2erp)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {SHOPIFY_SYNC_GROUPS.map((group) => {
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
                            <CustomCheckbox checked={settings[opt.key]?.shopify2odoo || false}
                              onChange={(val) => handleCheckboxChange(opt.key, 'shopify2odoo', val)} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button onClick={handleSyncSubscriptions} disabled={syncing || loading} variant="outline" size="sm" className="h-7 text-[11px] gap-1.5">
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {lang === 'ar' ? 'مزامنة الاشتراكات' : 'Sync subscriptions'}
            </Button>
            <Button onClick={handleSave} disabled={loading} variant="outline" size="sm" className="h-7 text-[11px] gap-1.5">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {t('shopify.saveSettings')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
