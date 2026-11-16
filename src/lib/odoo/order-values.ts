import { fetchFieldMeta, getSaleOrderSelectionKeys } from '@/lib/odoo/field-meta'
import { extractOrderCurrency, resolveOrderExchangeRate } from '@/lib/odoo/order-currency'
import { resolveOrderCurrencySettings } from '@/lib/odoo/order-currency-resolution'
import { buildOrderLineItems } from '@/lib/odoo/order-lines'
import { extractOrderLocationInfo, resolvePaymentMethod, resolveShippingCarrier, resolveWarehouse } from '@/lib/odoo/order-location'
import { getOrderStatusRow, resolveOrderState } from '@/lib/odoo/order-workflow'
import { safeCreateOdooRecord } from '@/lib/odoo/records'
import { applyFixedSettingsToValues } from '@/lib/odoo/value-settings'
import { resolveOrderRelatedRecord } from '@/lib/orders/related-matching'
import { getPlatformFromEvent } from '@/lib/sync/events'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { logSync, supabaseAdmin } from '@/lib/sync-runtime'
import type { OdooFieldMeta } from '@/lib/sync-types'
import { resolveZidStatus } from '@/lib/zid/order-helpers'
import { readOrderRelatedDetails } from '@/lib/zid/order-related-data'

import type { ExecuteOdooParams, OdooSyncRecord, OdooValuesPreparation } from './operation-types'

export type PendingOrderCustomer = { values: Record<string, unknown>; sourceId: string }

export async function prepareOdooOrder({
  client, mapping, event, zidData, odooValues, mergedSettings, odooModel, platformHint, storeId, odooOperation, existingLogId, zidEntityId, triggerType,
  execPlatform, isSallaOrderCreate, existingSaleOrderId,
}: OdooValuesPreparation & {
  execPlatform: NonNullable<ExecuteOdooParams['platformHint']>
  isSallaOrderCreate: boolean
  existingSaleOrderId: number | null
}): Promise<{ values: Record<string, unknown>; pendingOrderCustomer: PendingOrderCustomer | null } | { record: OdooSyncRecord }> {
  let pendingOrderCustomer: PendingOrderCustomer | null = null
  const platform = (platformHint || getPlatformFromEvent(event)) as 'zid' | 'salla' | 'shopify'
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  const effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, platform, odooModel)

  // NEVER send the technical `name` field on sale.order (create or update):
  // Odoo owns the SO... sequence. Sending it overrides the sequence and breaks
  // numbering, so strip it unconditionally here (covers presets, dynamic
  // mappings, and the duplicate-create-update branch below).
  if ('name' in effectiveOdooValues) {
    delete effectiveOdooValues.name
  }
  // NEVER send location_id on sale.order:
  // Odoo's sale.order does NOT have a location_id field (only warehouse_id).
  delete (effectiveOdooValues as any).location_id
  delete (odooValues as any).location_id

  const orderSettings = mergedSettings.order || (isSallaOrderCreate ? mergedSettings : undefined)
  if (platform === 'zid') {
    const customerPolicy = mergedSettings.customer_fallback_policy ?? orderSettings?.customer_fallback_policy ?? 'create_new'
    if (!['create_new', 'skip_order', 'default_customer'].includes(customerPolicy)) throw new Error('Invalid configured order customer fallback policy')
    const defaultCustomerId = Number(mergedSettings.default_customer_id ?? orderSettings?.default_customer_id)
    if (customerPolicy === 'default_customer' && (!Number.isSafeInteger(defaultCustomerId) || defaultCustomerId <= 0)) throw new Error('Configured default order customer is missing or invalid')
  }
  // Existing orders keep their customer; status retries must not create unused partners.
  if (existingSaleOrderId && platform === 'zid') {
    const [existingOrder] = await client.searchRead<any>('sale.order', [['id', '=', existingSaleOrderId]], ['partner_id', 'company_id'], 1)
    const partnerId = Number(Array.isArray(existingOrder?.partner_id) ? existingOrder.partner_id[0] : existingOrder?.partner_id)
    if (!Number.isSafeInteger(partnerId) || partnerId <= 0) throw new Error('Existing sale order customer could not be verified')
    effectiveOdooValues.partner_id = partnerId
    const companyId = Number(Array.isArray(existingOrder?.company_id) ? existingOrder.company_id[0] : existingOrder?.company_id)
    if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error('Existing sale order company could not be verified')
    effectiveOdooValues.company_id = companyId
  }
  // ── Auto-resolve partner_id from customer data ──────────────
  if (!effectiveOdooValues.partner_id) {
    const customerData = (zidData as any)?.customer || (zidData as any)?.order?.customer || {}
    const shippingAddress = (zidData as any)?.shipping_address || (zidData as any)?.order?.shipping_address || {}
    const billingAddress = (zidData as any)?.billing_address || (zidData as any)?.order?.billing_address || {}

    const rawName = customerData.name
      || [customerData.first_name, customerData.last_name].filter(Boolean).join(' ')
      || (zidData as any)?.customer_name
      || shippingAddress.name
      || [shippingAddress.first_name, shippingAddress.last_name].filter(Boolean).join(' ')
      || billingAddress.name
      || [billingAddress.first_name, billingAddress.last_name].filter(Boolean).join(' ')
      || ''
    const custName = String(rawName).trim()

    // Shopify puts the buyer contact on the order top level (`email` /
    // `contact_email`, `phone`) and splits address names into
    // `first_name` / `last_name` with the street in `address1` — none of
    // which the Zid-shaped keys above cover. Without these fallbacks a
    // guest order (customer === null) matches no partner and mints a
    // duplicate on every delivery.
    const custEmail = String(customerData.email || (zidData as any)?.customer_email || (zidData as any)?.email || (zidData as any)?.contact_email || shippingAddress.email || billingAddress.email || '').trim()
    const custPhone = String(customerData.phone || customerData.mobile || customerData.telephone || (zidData as any)?.customer_phone || (zidData as any)?.phone || shippingAddress.mobile || shippingAddress.phone || billingAddress.mobile || billingAddress.phone || '').trim()
    const custTaxId = String(customerData.tax_number || customerData.vat || customerData.tax_id || (zidData as any)?.tax_number || '').trim()
    const custCommercialReg = String(customerData.commercial_registration || customerData.cr_number || (zidData as any)?.commercial_registration || '').trim()
    const custBusinessName = String(customerData.business_name || customerData.company_name || (zidData as any)?.company_name || '').trim()

    const rawStreet = shippingAddress.address || shippingAddress.address1 || shippingAddress.street || billingAddress.address || billingAddress.address1 || billingAddress.street || customerData.address || customerData.address1 || ''
    const custStreet = typeof rawStreet === 'string' ? rawStreet.trim() : (rawStreet?.name || '')

    const rawCity = shippingAddress.city || billingAddress.city || customerData.city || ''
    const custCity = typeof rawCity === 'string' ? rawCity.trim() : (rawCity?.name || rawCity?.en || rawCity?.ar || '')

    const custZip = String(shippingAddress.postal_code || shippingAddress.zip || billingAddress.postal_code || '').trim()

    if (custName || custEmail || custPhone || custTaxId || custCommercialReg || custBusinessName || (platform === 'zid' && customerData.id)) {
      try {
        let partnerId: number | null = null
        let configuredCustomerMatch = false
        let customerMatchValues: Record<string, unknown> = {}

        const partnerFieldsToCheck = [
          'phone', 'mobile', 'email', 'vat', 'company_registry', 'name',
          'street', 'city', 'zip', 'company_type', 'is_company', 'customer_rank',
          'company_name', 'property_account_receivable_id', 'property_account_payable_id', 'company_id'
        ]
        const partnerFieldMeta = await fetchFieldMeta(client, 'res.partner', partnerFieldsToCheck)
        const hasPartnerField = (f: string) => f === 'mobile' ? false : (partnerFieldMeta.size === 0 ? true : partnerFieldMeta.has(f))

        // Load Customer Standard Mapping settings early
        let custStd: Record<string, any> | null = null
        if (mapping.workspace_id && platform) {
          try {
            custStd = await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'customers', storeId || mapping.merchant_id || '')
          } catch (custStdErr) {
            if (platform === 'zid') throw custStdErr
            console.warn('[SyncEngine] Failed to load customer standard mapping:', custStdErr)
          }
        }

        if (platform === 'zid') {
          const customerSource = {
            ...customerData,
            id: customerData.id ?? (zidData as any).customer_id,
            name: customerData.name ?? custName,
            email: customerData.email ?? custEmail,
            phone: customerData.phone ?? customerData.telephone ?? customerData.mobile ?? custPhone,
          }
          const match = await resolveOrderRelatedRecord(client, supabaseAdmin,
            { workspaceId: mapping.workspace_id, platform, storeId: storeId || mapping.merchant_id || '' },
            'customers', customerSource, custStd,
            () => readOrderRelatedDetails(client, { workspaceId: mapping.workspace_id, platform, storeId: storeId || mapping.merchant_id || '' }, 'customers', customerSource))
          configuredCustomerMatch = match.configured
          customerMatchValues = match.matchValues || {}
          partnerId = match.recordId
        }

        // Priority 0: Search by custom match field from Customer Standard Mapping if configured
        if (platform !== 'zid' && custStd?.match_odoo_field && !partnerId && hasPartnerField(custStd.match_odoo_field)) {
          const zidCustMatchVal = customerData[custStd.match_zid_field || 'id'] || customerData.id
          if (zidCustMatchVal) {
            try {
              const ids = await client.search('res.partner', [[custStd.match_odoo_field, '=', String(zidCustMatchVal)]], 1)
              if (ids && ids.length > 0) {
                partnerId = ids[0]
                console.info(`[SyncEngine] Matched partner #${partnerId} via ${custStd.match_odoo_field}="${zidCustMatchVal}"`)
              }
            } catch (e) {
              console.warn(`[SyncEngine] Search partner by ${custStd.match_odoo_field} failed:`, e)
            }
          }
        }

        const searchCustomer = async (domain: unknown[]) => {
          const ids = await client.search('res.partner', domain, platform === 'zid' ? 2 : 1)
          if (platform === 'zid' && ids.length > 1) throw new Error('Ambiguous Odoo order customer match')
          return ids
        }

        // Priority 1: Search by tax_id/vat (most reliable identifier)
        if (!configuredCustomerMatch && custTaxId && !partnerId && hasPartnerField('vat')) {
          try {
            const ids = await searchCustomer([['vat', '=', custTaxId]])
            if (ids && ids.length > 0) partnerId = ids[0]
          } catch (e) {
            if (platform === 'zid') throw e
            console.warn('[SyncEngine] Search partner by vat failed:', e)
          }
        }

        // Priority 2: Search by email
        if (!configuredCustomerMatch && custEmail && !partnerId && hasPartnerField('email')) {
          try {
            const ids = await searchCustomer([['email', '=', custEmail]])
            if (ids && ids.length > 0) partnerId = ids[0]
          } catch (e) {
            if (platform === 'zid') throw e
            console.warn('[SyncEngine] Search partner by email failed:', e)
          }
        }

        // Priority 3: Search by phone (standard in all Odoo versions, avoiding invalid mobile field in Odoo 19)
        if (!configuredCustomerMatch && custPhone && !partnerId) {
          try {
            // Prepare phone variants (with and without country codes)
            const phoneVariants = [custPhone]
            const noPlus = custPhone.replace(/^\+/, '')
            if (noPlus !== custPhone) phoneVariants.push(noPlus)
            if (noPlus.startsWith('9665')) phoneVariants.push('05' + noPlus.slice(4))
            if (noPlus.startsWith('201')) phoneVariants.push('01' + noPlus.slice(3))

            for (const phoneToTry of phoneVariants) {
              if (partnerId) break
              const ids = await searchCustomer([['phone', platform === 'zid' ? '=' : 'ilike', phoneToTry]])
              if (ids && ids.length > 0) {
                partnerId = ids[0]
                console.info(`[SyncEngine] Matched partner #${partnerId} via phone="${phoneToTry}"`)
                break
              }
            }
          } catch (e) {
            if (platform === 'zid') throw e
            console.warn('[SyncEngine] Search partner by phone failed:', e)
          }
        }

        // Priority 4: Search by name with ilike
        if (!configuredCustomerMatch && custName && !partnerId && hasPartnerField('name')) {
          try {
            const ids = await searchCustomer([['name', '=ilike', custName]])
            if (ids && ids.length > 0) partnerId = ids[0]
            else if (platform !== 'zid') {
              const ids2 = await client.search('res.partner', [['name', 'ilike', custName]], 1)
              if (ids2 && ids2.length > 0) partnerId = ids2[0]
            }
          } catch (e) {
            if (platform === 'zid') throw e
            console.warn('[SyncEngine] Search partner by name failed:', e)
          }
        }

        // Priority 5: Search by commercial registration
        if (!configuredCustomerMatch && custCommercialReg && !partnerId && hasPartnerField('company_registry')) {
          try {
            const ids = await searchCustomer([['company_registry', '=', custCommercialReg]])
            if (ids && ids.length > 0) partnerId = ids[0]
          } catch (e) {
            if (platform === 'zid') throw e
            console.warn('[SyncEngine] Search partner by commercial registration failed:', e)
          }
        }

        const customerPolicy = (mergedSettings)?.customer_fallback_policy
          || orderSettings?.customer_fallback_policy
          || 'create_new'
        const defaultCustomerId = (mergedSettings)?.default_customer_id
          || orderSettings?.default_customer_id
          || null

        // If no partner found, apply customer fallback policy
        if (!partnerId) {
          if (customerPolicy === 'default_customer' && defaultCustomerId && Number(defaultCustomerId) > 0) {
            partnerId = Number(defaultCustomerId)
            console.info(`[SyncEngine] Customer not matched in Odoo. Using configured default customer #${partnerId}`)
          } else if (customerPolicy === 'skip_order') {
            const skipMsg = `تم إلغاء تسجيل الطلب: العميل "${custName || custEmail || custPhone || 'غير معروف'}" غير مسجل في أودو وإعداد المطابقة محدد على إلغاء تسجيل الطلب (Order skipped: Customer not found in Odoo and policy is skip_order)`
            console.warn(`[SyncEngine] ${skipMsg}`)
            await logSync({
              id: existingLogId,
              workspace_id: mapping.workspace_id,
              field_mapping_id: mapping.id,
              event,
              store_id: storeId,
              zid_entity_id: zidEntityId,
              odoo_model: odooModel,
              status: 'skipped',
              error_message: skipMsg,
              payload: zidData,
              trigger_type: triggerType,
            })
            return { record: {
              mappingId: mapping.id,
              mappingName: mapping.name,
              model: odooModel,
              status: 'skipped',
              message: skipMsg,
            } }
          } else {
            // policy is 'create_new' (auto-register customer in Odoo according to Customer Standard Mapping)
            const resolvedName = custName || custBusinessName || custPhone || custEmail || `عميل متجر #${zidEntityId || 'جديد'}`
            const partnerVals: Record<string, any> = {
              name: resolvedName,
            }
            if (hasPartnerField('customer_rank')) partnerVals.customer_rank = 1
            if (custEmail && hasPartnerField('email')) partnerVals.email = custEmail
            if (custPhone) {
              partnerVals.phone = custPhone
            }
            if (custTaxId && hasPartnerField('vat')) partnerVals.vat = custTaxId
            if (custCommercialReg && hasPartnerField('company_registry')) partnerVals.company_registry = custCommercialReg
            if (custBusinessName && hasPartnerField('company_name')) partnerVals.company_name = custBusinessName
            if (custStreet && hasPartnerField('street')) partnerVals.street = custStreet
            if (custCity && hasPartnerField('city')) partnerVals.city = custCity
            if (custZip && hasPartnerField('zip')) partnerVals.zip = custZip

            // Apply Customer Standard Mapping settings (receivable/payable accounts, company, customer_type)
            if (custStd) {
              if (custStd.customer_type === 'company' && hasPartnerField('company_type')) {
                partnerVals.company_type = 'company'
                if (hasPartnerField('is_company')) partnerVals.is_company = true
              } else if (custStd.customer_type === 'person' && hasPartnerField('company_type')) {
                partnerVals.company_type = 'person'
                if (hasPartnerField('is_company')) partnerVals.is_company = false
              } else if (hasPartnerField('company_type')) {
                // auto detect
                const isComp = !!(custTaxId || custCommercialReg || custBusinessName)
                partnerVals.company_type = isComp ? 'company' : 'person'
                if (isComp && hasPartnerField('is_company')) partnerVals.is_company = true
              }

              if (custStd.receivable_account_id && Number(custStd.receivable_account_id) > 0 && hasPartnerField('property_account_receivable_id')) {
                partnerVals.property_account_receivable_id = Number(custStd.receivable_account_id)
              }
              if (custStd.payable_account_id && Number(custStd.payable_account_id) > 0 && hasPartnerField('property_account_payable_id')) {
                partnerVals.property_account_payable_id = Number(custStd.payable_account_id)
              }
              if (custStd.link_company !== false && custStd.company_id && Number(custStd.company_id) > 0 && hasPartnerField('company_id')) {
                partnerVals.company_id = Number(custStd.company_id)
              }
              if (platform !== 'zid' && custStd.match_odoo_field && hasPartnerField(custStd.match_odoo_field)) {
                const zidCustVal = customerData[custStd.match_zid_field || 'id'] || customerData.id || ''
                if (zidCustVal) partnerVals[custStd.match_odoo_field] = String(zidCustVal)
              }
            } else {
              if ((custTaxId || custCommercialReg || custBusinessName) && hasPartnerField('company_type')) {
                partnerVals.company_type = 'company'
                if (hasPartnerField('is_company')) partnerVals.is_company = true
              }
            }

            if (platform === 'zid') {
              if (configuredCustomerMatch && Object.keys(customerMatchValues).length === 0) throw new Error('Configured customer match cannot be written on a new Odoo customer; select an existing match or a default customer')
              Object.assign(partnerVals, customerMatchValues)
              pendingOrderCustomer = { values: partnerVals, sourceId: String(customerData.id ?? (zidData as any).customer_id ?? '') }
            } else try {
              const newId = await safeCreateOdooRecord(client, 'res.partner', partnerVals, {})
              if (newId) {
                partnerId = newId
                console.info(`[SyncEngine] Created new partner #${partnerId} for "${resolvedName}" according to Customer Standard Mapping`)
              }
            } catch (createErr: any) {
              console.warn(`[SyncEngine] Failed to create partner with full settings, retrying with core fields:`, createErr?.message || createErr)
              try {
                const basicPartnerVals: Record<string, any> = {
                  name: resolvedName,
                }
                if (hasPartnerField('customer_rank')) basicPartnerVals.customer_rank = 1
                if (custEmail && hasPartnerField('email')) basicPartnerVals.email = custEmail
                if (custPhone) basicPartnerVals.phone = custPhone
                if (custStreet && hasPartnerField('street')) basicPartnerVals.street = custStreet
                if (custCity && hasPartnerField('city')) basicPartnerVals.city = custCity
                const retryId = await safeCreateOdooRecord(client, 'res.partner', basicPartnerVals, {})
                if (retryId) {
                  partnerId = retryId
                  console.info(`[SyncEngine] Created partner #${partnerId} on basic retry for "${resolvedName}"`)
                }
              } catch (retryErr: any) {
                console.error(`[SyncEngine] Basic partner creation retry failed:`, retryErr?.message || retryErr)
              }
            }
          }
        }

        if (partnerId) {
          effectiveOdooValues.partner_id = partnerId
          if (!effectiveOdooValues.partner_invoice_id) {
            effectiveOdooValues.partner_invoice_id = partnerId
          }
          if (!effectiveOdooValues.partner_shipping_id) {
            effectiveOdooValues.partner_shipping_id = partnerId
          }
        }
      } catch (err) {
        if (platform === 'zid') throw err
        console.warn('[SyncEngine] Failed to auto-resolve partner for order:', err)
      }
    }
  }

  let resolvedConversionRate = 1.0

  // Fallback check if partner_id is still missing after customer processing
  if (!effectiveOdooValues.partner_id && !pendingOrderCustomer) {
    const customerPolicy = (mergedSettings)?.customer_fallback_policy
      || orderSettings?.customer_fallback_policy
      || 'create_new'
    const defaultCustomerId = (mergedSettings)?.default_customer_id
      || orderSettings?.default_customer_id
      || null

    if (customerPolicy === 'default_customer' && defaultCustomerId && Number(defaultCustomerId) > 0) {
      const defId = Number(defaultCustomerId)
      effectiveOdooValues.partner_id = defId
      if (!effectiveOdooValues.partner_invoice_id) effectiveOdooValues.partner_invoice_id = defId
      if (!effectiveOdooValues.partner_shipping_id) effectiveOdooValues.partner_shipping_id = defId
      console.info(`[SyncEngine] Customer not resolved from data. Using configured default customer #${defId}`)
    } else if (customerPolicy === 'skip_order') {
      const skipMsg = `تم إلغاء تسجيل الطلب: لم يتم التعرف على العميل في أودو وإعداد المطابقة محدد على إلغاء تسجيل الطلب (Order skipped: Customer not resolved and policy is skip_order)`
      console.warn(`[SyncEngine] ${skipMsg}`)
      await logSync({
        id: existingLogId,
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: zidEntityId,
        odoo_model: odooModel,
        status: 'skipped',
        error_message: skipMsg,
        payload: zidData,
        trigger_type: triggerType,
      })
      return { record: {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: odooModel,
        status: 'skipped',
        message: skipMsg,
      } }
    } else if (defaultCustomerId && Number(defaultCustomerId) > 0) {
      // Safety net: if create_new failed or customer data was empty, fallback to configured default customer
      const defId = Number(defaultCustomerId)
      effectiveOdooValues.partner_id = defId
      if (!effectiveOdooValues.partner_invoice_id) effectiveOdooValues.partner_invoice_id = defId
      if (!effectiveOdooValues.partner_shipping_id) effectiveOdooValues.partner_shipping_id = defId
      console.warn(`[SyncEngine] Safety fallback: assigned default customer #${defId} because partner_id was not set`)
    } else {
      const skipMsg = `تم إلغاء تسجيل الطلب: تعذر التعرف على العميل في أودو وفشل إنشاؤه تلقائياً ولا يوجد عميل افتراضي محدد (Order skipped: Customer could not be identified or created in Odoo)`
      console.warn(`[SyncEngine] ${skipMsg}`)
      await logSync({
        id: existingLogId,
        workspace_id: mapping.workspace_id,
        field_mapping_id: mapping.id,
        event,
        store_id: storeId,
        zid_entity_id: zidEntityId,
        odoo_model: odooModel,
        status: 'skipped',
        error_message: skipMsg,
        payload: zidData,
        trigger_type: triggerType,
      })
      return { record: {
        mappingId: mapping.id,
        mappingName: mapping.name,
        model: odooModel,
        status: 'skipped',
        message: skipMsg,
      } }
    }
  }
  // Resolve order state from DB mapping or fallback
  const zidStatus = resolveZidStatus(zidData)
  if (!zidStatus) {
    console.info(`[SyncEngine] No order status in payload (top keys: ${Object.keys((zidData as any) || {}).slice(0, 25).join(',')})`)
  }
  // Status mapping with teeth: when a mapping row exists AND is enabled, skip
  // the passive `state` write (Odoo state is workflow-driven — direct writes
  // fake the state without creating pickings) and let
  // maybeApplyOrderStatusAction perform the real transition after the record
  // write. Disabled rows leave Odoo fully untouched for this status;
  // unmapped statuses keep the legacy smart-default passive write.
  if (isSallaOrderCreate) delete effectiveOdooValues.state
  if (zidStatus && !effectiveOdooValues.state && !isSallaOrderCreate) {
    const statusRow = await getOrderStatusRow(mapping.workspace_id, zidStatus, platform, storeId)
    if (!statusRow) {
      const resolvedState = await resolveOrderState(
        mapping.workspace_id,
        zidStatus,
        platform,
        storeId
      )
      if (resolvedState && platform !== 'zid') {
        effectiveOdooValues.state = resolvedState
      }
    } else if (statusRow.enabled) {
      console.info(`[SyncEngine] Status "${zidStatus}" → Odoo "${statusRow.odoo_state}" action armed (mapping enabled)`)
    } else {
      console.info(`[SyncEngine] Status "${zidStatus}" mapping is DISABLED — Odoo state untouched`)
    }
  }

  // ── Inject Platform Status into Custom Selection Field on sale.order ──
  const customStatusField = orderSettings?.order_status_custom_field
    || (mergedSettings)?.order_status_custom_field
    || (mergedSettings)?.order?.order_status_custom_field
  const isCustomStatusEnabled = (
    orderSettings?.update_custom_status_field !== false &&
    (mergedSettings)?.update_custom_status_field !== false &&
    (mergedSettings)?.order?.update_custom_status_field !== false
  )
  if (zidStatus && customStatusField && isCustomStatusEnabled) {
    const knownKeys = await getSaleOrderSelectionKeys(client, mapping.workspace_id, customStatusField)
    if (!knownKeys || knownKeys.has(zidStatus)) {
      effectiveOdooValues[customStatusField] = zidStatus
      console.info(`[SyncEngine] Injected ${execPlatform} status "${zidStatus}" into custom field "${customStatusField}" on sale.order`)
    } else {
      if (isSallaOrderCreate) throw new Error(`Salla status "${zidStatus}" is not available in configured field "${customStatusField}"`)
      console.warn(`[SyncEngine] Skipping custom status "${zidStatus}" — not an option of "${customStatusField}" on sale.order (Odoo would reject the whole order write)`)
    }
  }

  if (orderSettings) {
    // Resolve payment method → Odoo journal from DB mapping
    const zidPaymentMethod = (zidData as any)?.payment_method?.title
      || (zidData as any)?.payment_gateway?.title
      || (zidData as any)?.payment_method
      || ''
    if (zidPaymentMethod && !effectiveOdooValues.journal_id) {
      const pm = await resolvePaymentMethod(mapping.workspace_id, String(zidPaymentMethod), platform)
      if (pm) {
        if (pm.journal_id) effectiveOdooValues.journal_id = pm.journal_id
        if (pm.payment_method_id) effectiveOdooValues.x_payment_method_id = pm.payment_method_id
      }
    }
    // Resolve shipping method → Odoo carrier from DB mapping
    const zidShippingMethod = (zidData as any)?.shipping_method?.title
      || (zidData as any)?.shipping?.title
      || (zidData as any)?.shipping_method
      || ''
    if (zidShippingMethod && !effectiveOdooValues.carrier_id) {
      const carrier = await resolveShippingCarrier(mapping.workspace_id, String(zidShippingMethod), platform)
      if (carrier?.carrier_id) {
        effectiveOdooValues.carrier_id = carrier.carrier_id
      }
    }
    // Resolve currency from Multi-Currency settings or DB currency_mappings
    resolvedConversionRate = 1.0
    const sourceCurrency = extractOrderCurrency(zidData, execPlatform)
    const isMultiCurrencyEnabled = !!(orderSettings?.multi_currency_enabled ?? orderSettings?.order?.multi_currency_enabled)
    const baseCurrencyId = Number(orderSettings?.base_currency_id ?? orderSettings?.order?.base_currency_id) || null

    if (execPlatform === 'zid' || isSallaOrderCreate) {
      if (isSallaOrderCreate && !existingSaleOrderId && orderSettings.default_pricelist_id && !effectiveOdooValues.pricelist_id) {
        effectiveOdooValues.pricelist_id = orderSettings.default_pricelist_id
      }
      let mappedCurrencyId: number | undefined
      let mappedConversionRate: number | undefined
      if (!existingSaleOrderId && !isMultiCurrencyEnabled && !effectiveOdooValues.currency_id && !effectiveOdooValues.pricelist_id && !baseCurrencyId && !orderSettings.default_pricelist_id) {
        const { data: currencyMapping, error } = await supabaseAdmin.from('currency_mappings')
          .select('odoo_currency_id, conversion_rate, auto_update').eq('workspace_id', mapping.workspace_id)
          .eq('platform', execPlatform).eq('source_currency', sourceCurrency).maybeSingle()
        if (error) throw new Error(`Could not read configured order currency: ${error.message}`)
        mappedCurrencyId = Number(currencyMapping?.odoo_currency_id) || undefined
        if (currencyMapping?.auto_update === false && currencyMapping.conversion_rate !== null && currencyMapping.conversion_rate !== undefined) {
          mappedConversionRate = Number(currencyMapping.conversion_rate)
        }
      }
      const resolvedCurrency = await resolveOrderCurrencySettings({
        client, payload: zidData, values: effectiveOdooValues, settings: orderSettings,
        create: odooOperation === 'create', existingOrderId: existingSaleOrderId, mappedCurrencyId, mappedConversionRate,
        platform: isSallaOrderCreate ? 'salla' : 'zid',
      })
      if (!isSallaOrderCreate || mergedSettings.link_company !== false) effectiveOdooValues.company_id = resolvedCurrency.companyId
      effectiveOdooValues.currency_id = resolvedCurrency.currencyId
      effectiveOdooValues.pricelist_id = resolvedCurrency.pricelistId
      resolvedConversionRate = resolvedCurrency.rate
    } else if (isMultiCurrencyEnabled && sourceCurrency) {
      try {
        const odooCurrs = await client.searchRead<any>(
          'res.currency',
          [['name', '=', sourceCurrency]],
          ['id', 'name', 'active', 'rate'],
          1
        ).catch(() => [])

        const matchedCurr = odooCurrs?.[0]
        if (matchedCurr && matchedCurr.active) {
          // Currency is active in Odoo!
          // In Odoo (v14 to v20), sale.order.currency_id depends strictly on pricelist_id.currency_id.
          // A sale.order CANNOT be recorded in a currency unless its pricelist has that currency.
          let matchedPricelistId: number | null = null
          try {
            const matchedPricelists = await client.searchRead<any>(
              'product.pricelist',
              [['currency_id', '=', matchedCurr.id], ['active', '=', true]],
              ['id', 'name'],
              1
            ).catch(() => [])
            if (matchedPricelists?.[0]?.id) {
              matchedPricelistId = matchedPricelists[0].id
              console.info(`[SyncEngine] 💱 Found existing pricelist #${matchedPricelistId} ("${matchedPricelists[0].name}") for currency "${sourceCurrency}" in Odoo`)
            }
          } catch {
            // Non-fatal
          }

          // If no active pricelist exists for this currency in Odoo, try to auto-create one
          if (!matchedPricelistId && odooOperation === 'create') {
            try {
              matchedPricelistId = await client.create('product.pricelist', {
                name: `${sourceCurrency} Pricelist`,
                currency_id: matchedCurr.id,
                active: true,
              })
              console.info(`[SyncEngine] 💱 Auto-created pricelist #${matchedPricelistId} for currency "${sourceCurrency}" in Odoo`)
            } catch (plCreateErr: any) {
              console.warn(`[SyncEngine] Could not auto-create pricelist for currency "${sourceCurrency}" in Odoo:`, plCreateErr?.message || plCreateErr)
            }
          }

          if (matchedPricelistId) {
            // Both currency and pricelist exist in Odoo! Assign both directly
            effectiveOdooValues.currency_id = matchedCurr.id
            effectiveOdooValues.pricelist_id = matchedPricelistId
            resolvedConversionRate = 1.0
            console.info(`[SyncEngine] 💱 Multi-currency: Order currency "${sourceCurrency}" is active in Odoo (ID=${matchedCurr.id}, pricelist_id=${matchedPricelistId}). Recording order in ${sourceCurrency}.`)
          } else {
            // Currency is active, but NO pricelist exists in Odoo and none could be created.
            // In Odoo, sale.order CANNOT be created in this currency without a pricelist.
            // Fallback to base currency and convert line amounts!
            console.warn(`[SyncEngine] 💱 Multi-currency: Currency "${sourceCurrency}" is active in Odoo but has no matching pricelist. Recording in base currency and converting amounts.`)
            if (baseCurrencyId) {
              effectiveOdooValues.currency_id = baseCurrencyId
            }
            resolvedConversionRate = resolveOrderExchangeRate(zidData, sourceCurrency, 'SAR', matchedCurr?.rate)
            console.info(`[SyncEngine] 💱 Currency conversion rate applied: 1 ${sourceCurrency} = ${resolvedConversionRate} Base (SAR)`)
          }
        } else {
          // Currency is NOT active in Odoo (or not found)
          console.warn(`[SyncEngine] 💱 Multi-currency: Order currency "${sourceCurrency}" is NOT active in Odoo. Recording order in base currency and converting amounts.`)
          if (baseCurrencyId) {
            effectiveOdooValues.currency_id = baseCurrencyId
          }
          resolvedConversionRate = resolveOrderExchangeRate(zidData, sourceCurrency, 'SAR', matchedCurr?.rate)
          console.info(`[SyncEngine] 💱 Currency conversion rate applied: 1 ${sourceCurrency} = ${resolvedConversionRate} Base (SAR)`)
        }
      } catch (currErr) {
        console.warn('[SyncEngine] Error resolving multi-currency from Odoo:', currErr)
      }
    } else {
      const zidCurrency = String((zidData as any)?.currency || (zidData as any)?.amounts?.currency || (zidData as any)?.payment?.currency || '')
      if (zidCurrency && !effectiveOdooValues.currency_id) {
        try {
          const { data: curRow } = await supabaseAdmin
            .from('currency_mappings')
            .select('odoo_currency_id')
            .eq('workspace_id', mapping.workspace_id)
            .eq('source_currency', zidCurrency)
            .maybeSingle()
          if (curRow?.odoo_currency_id) {
            effectiveOdooValues.currency_id = curRow.odoo_currency_id
          }
        } catch (err) {
          console.warn(`[SyncEngine] Failed to resolve currency "${zidCurrency}":`, err)
        }
      }
    }
    // Apply per-warehouse rule if one matches. Rules are keyed by the platform
    // side: the order's location (ID, UUID, or Name), then the store id (legacy
    // free-text keys). The default warehouse below covers the rest.
    const storeWhMappings = (orderSettings as any)?.store_warehouse_mappings as Record<string, unknown> | undefined
    const { locationId: orderLocId, locationName: orderLocName } = extractOrderLocationInfo(zidData, execPlatform)

    console.info(`[SyncEngine] 🏬 Warehouse resolution for order:`, {
      orderId: zidEntityId,
      orderLocId,
      orderLocName,
      storeId,
      rulesCount: storeWhMappings ? Object.keys(storeWhMappings).length : 0,
      defaultWarehouseId: orderSettings?.default_warehouse_id,
    })

    if (storeWhMappings && !effectiveOdooValues.warehouse_id) {
      const clean = (s: string) => String(s || '').trim().toLowerCase().replace(/[-_\s]/g, '')
      const normalizedRules = new Map<string, number>()
      for (const [rKey, rVal] of Object.entries(storeWhMappings)) {
        const num = Number(rVal)
        if (!Number.isNaN(num) && num > 0) {
          normalizedRules.set(clean(rKey), num)
          normalizedRules.set(rKey.trim().toLowerCase(), num)
        }
      }

      const candidates = [
        orderLocId ? clean(orderLocId) : '',
        orderLocId ? orderLocId.trim().toLowerCase() : '',
        orderLocName ? clean(orderLocName) : '',
        orderLocName ? orderLocName.trim().toLowerCase() : '',
        storeId ? clean(String(storeId)) : '',
        storeId ? String(storeId).trim().toLowerCase() : '',
      ].filter(Boolean)

      for (const cand of candidates) {
        const whId = normalizedRules.get(cand)
        if (whId) {
          effectiveOdooValues.warehouse_id = whId
          console.info(`[SyncEngine] ✅ Multi-warehouse rule matched: "${cand}" → Odoo warehouse_id=${whId}`)
          break
        }
      }
    }

    // If not resolved from multi-warehouse rules, check warehouse_mappings table
    if (!effectiveOdooValues.warehouse_id && mapping.workspace_id && (orderLocId || orderLocName)) {
      try {
        const wh = await resolveWarehouse(mapping.workspace_id, execPlatform, orderLocId, orderLocName)
        if (wh?.warehouse_id) {
          effectiveOdooValues.warehouse_id = wh.warehouse_id
          console.info(`[SyncEngine] ✅ Static warehouse_mappings table matched → Odoo warehouse_id=${wh.warehouse_id}`)
        }
      } catch (err) {
        console.warn('[SyncEngine] Error in static warehouse resolution:', err)
      }
    }

    // Apply default warehouse from settings if not already set
    if (orderSettings.default_warehouse_id && !effectiveOdooValues.warehouse_id) {
      effectiveOdooValues.warehouse_id = orderSettings.default_warehouse_id
      console.info(`[SyncEngine] Using default warehouse_id=${orderSettings.default_warehouse_id}`)
    }
    // Apply default pricelist from settings if not already set
    if (odooOperation === 'create' && orderSettings.default_pricelist_id && !effectiveOdooValues.pricelist_id) {
      effectiveOdooValues.pricelist_id = orderSettings.default_pricelist_id
    }
    // Apply default payment term from settings if not already set
    if (orderSettings.default_payment_term_id && !effectiveOdooValues.payment_term_id) {
      effectiveOdooValues.payment_term_id = orderSettings.default_payment_term_id
    }
    // Auto-confirm order (state is computed in Odoo — real confirmation happens
    // after create via action_confirm; see the create branch below)
    // Auto-extract order notes from common payload paths (if not already mapped)
    if (!effectiveOdooValues.note) {
      const zidNote = String(
        (zidData as any)?.notes
        || (zidData as any)?.customer_notes
        || (zidData as any)?.note
        || (zidData as any)?.shipping?.notes
        || (zidData as any)?.customer?.note
        || ''
      )
      if (zidNote) {
        effectiveOdooValues.note = zidNote
      }
    }
    // Auto-extract coupon/promotion code and append to note or set x_coupon_code
    const couponCode = String(
      (zidData as any)?.coupon?.code
      || (zidData as any)?.coupon_code
      || (zidData as any)?.promotion?.code
      || (zidData as any)?.discount_code
      || ''
    )
    if (couponCode) {
      const existingNote = String(effectiveOdooValues.note || '')
      const couponPrefix = 'Coupon: '
      if (!existingNote.includes(couponCode)) {
        effectiveOdooValues.note = existingNote
          ? `${existingNote}\n${couponPrefix}${couponCode}`
          : `${couponPrefix}${couponCode}`
      }
      if (!effectiveOdooValues.x_coupon_code &&
          (!isSallaOrderCreate || (await fetchFieldMeta(client, 'sale.order', ['x_coupon_code'])).has('x_coupon_code'))) {
        effectiveOdooValues.x_coupon_code = couponCode
      }
    }
  }
  // ── Build order_lines (products + shipping + discount) for create operations ──
  // The fixed/standard mapping path never built lines (only the dynamic mapping
  // path did), so orders were created header-only. Rows follow the standard
  // mapping settings (add_shipping_as_line / add_discount_as_line, product ids).
  // Built for create AND update; update writes convert the (0,0) creates into a
  // full replace [(5,0,0), ...] via normalizeOrderLinesForUpdate (mirror Zid, no dups).
  // Status-change events and order updates on an existing order must NEVER
  // rebuild or replace lines, protecting existing line items, taxes, pricelists, and discounts.
  // Order lines and taxes are established strictly at initial order creation.
  const isStatusUpdateEvent = event === 'order.status.update' || event.endsWith('.status.update') || event === 'order.status_update' || event === 'order.updated' || event.endsWith('.updated') || event === 'order.update' || odooOperation === 'update'
  if ((odooOperation === 'create' && !isStatusUpdateEvent) && !('order_line' in effectiveOdooValues) &&
      !(isSallaOrderCreate && existingSaleOrderId)) {
    let orderStdSettings: Record<string, any> | null = null
    if (mapping.workspace_id && platform) {
      try {
        orderStdSettings = await getCachedStandardMappingSettings(mapping.workspace_id, platform, 'orders', storeId || mapping.merchant_id || '')
      } catch (err) {
        console.warn('[SyncEngine] Failed to load standard mapping settings for order lines:', err)
      }
    }
    if (resolvedConversionRate !== 1.0) {
      if (!orderStdSettings) orderStdSettings = {}
      orderStdSettings = { ...orderStdSettings, _currency_conversion_rate: resolvedConversionRate }
    }
    try {
      const orderLines = await buildOrderLineItems(
        client,
        mapping,
        zidData,
        new Map<string, OdooFieldMeta>(),
        effectiveOdooValues,
        platform,
        orderStdSettings,
        storeId,
        event,
        odooOperation
      )
      if (orderLines.length > 0) {
        effectiveOdooValues.order_line = orderLines.map(item => [0, 0, item])
      }
    } catch (lineErr: any) {
      if (lineErr?.isOrderSkipped) {
        const skipMsg = lineErr.message
        console.warn(`[SyncEngine] ${skipMsg}`)
        await logSync({
          id: existingLogId,
          workspace_id: mapping.workspace_id,
          field_mapping_id: mapping.id,
          event,
          store_id: storeId,
          zid_entity_id: zidEntityId,
          odoo_model: odooModel,
          status: 'skipped',
          error_message: skipMsg,
          payload: zidData,
          trigger_type: triggerType,
        })
        return { record: {
          mappingId: mapping.id,
          mappingName: mapping.name,
          model: odooModel,
          status: 'skipped',
          message: skipMsg,
        } }
      }
      throw lineErr
    }
  }
  return { values: effectiveOdooValues, pendingOrderCustomer }
}
