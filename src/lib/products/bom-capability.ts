/** Probe the selected ERP before creating a bundle or accepting BoM settings. */
interface BomCapabilityClient {
  execute(model: string, method: string, args: unknown[], kwargs?: Record<string, unknown>): Promise<any>
}

type Field = { type?: string; selection?: Array<[string, string]> }

export function needsProductBom(settings: Record<string, any>, data: Record<string, unknown>): boolean {
  if (!settings.bom?.enabled) return false
  return ['grouped_product', 'dynamic_bundle', 'grouped', 'bundle'].includes(String(data.product_class)) ||
    ['group_products', 'grouped_products', 'components', 'bundle_products'].some(key => Array.isArray(data[key]))
}

export async function assertBomCapability(client: BomCapabilityClient, bomType?: string): Promise<void> {
  let fields: Record<string, Field>
  let lineFields: Record<string, Field>
  try {
    fields = await client.execute('mrp.bom', 'fields_get', [['product_tmpl_id', 'bom_line_ids', 'type']], { attributes: ['type', 'selection'] })
    lineFields = await client.execute('mrp.bom.line', 'fields_get', [['product_id', 'product_qty']], { attributes: ['type'] })
  } catch {
    throw new Error('BoM requires the Manufacturing module and access to Bills of Materials in this Odoo connection / مزامنة مكونات المنتج تتطلب تفعيل التصنيع وصلاحية قوائم المكونات في أودوو')
  }
  if (fields?.product_tmpl_id?.type !== 'many2one' || fields?.bom_line_ids?.type !== 'one2many' ||
      fields?.type?.type !== 'selection' || lineFields?.product_id?.type !== 'many2one' || lineFields?.product_qty?.type !== 'float') {
    throw new Error('This Odoo connection does not expose the fields required for BoM synchronization / اتصال أودوو لا يتيح حقول مكونات المنتج المطلوبة')
  }
  if (bomType && !['normal', 'phantom'].includes(bomType)) throw new Error('Unsupported BoM type / نوع قائمة المكونات غير مدعوم')
  if (bomType && fields.type.selection && !fields.type.selection.some(([value]) => value === bomType)) {
    throw new Error('The selected BoM type is unavailable in this Odoo connection / نوع قائمة المكونات المختار غير متاح في أودوو')
  }
}
