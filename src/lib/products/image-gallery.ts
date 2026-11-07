import { createHash } from 'crypto'

import type { OdooClient } from '@/lib/odoo-client'

type ImageRow = { id: number; name: string }
type Field = { type?: string; relation?: string; readonly?: boolean }
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24)

export function productImageUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const image = value as Record<string, any>
  const url = image.url ?? image.origin ?? image.thumbs?.fullSize ?? image.image_url ?? image.src ?? image.image?.url ?? image.path ?? image.full_path
  return typeof url === 'string' ? url.trim() || undefined : undefined
}

function extraImages(source: Record<string, unknown>, settings: Record<string, any>): string[] | null {
  if (settings.image?.sync_mode !== 'all' || !Array.isArray(source.images)) return null
  const raw = source.images
  const urls = raw.map(productImageUrl)
  if (urls.some(url => !url)) throw new Error('Unrecognized product image URL; existing product gallery preserved')
  const main = raw.find(image => image && typeof image === 'object' && (image.is_main === true || image.is_default === true)) ?? raw[0]
  const mainUrl = productImageUrl(main)
  return [...new Set(urls.filter((url): url is string => !!url && url !== mainUrl))]
}

/** Run before product creation; do not create a partial product for a missing gallery. */
export async function assertProductGalleryCapability(
  client: OdooClient,
  model: 'product.template' | 'product.product',
  source: Record<string, unknown>,
  settings: Record<string, any>,
): Promise<{ urls: string[]; relation: string; inverse: string } | null> {
  const urls = extraImages(source, settings)
  if (urls === null) return null
  if (!source.id) {
    if (urls.length) throw new Error('All Images requires a stable source product identity')
    return null
  }
  const relation = model === 'product.template' ? 'product_template_image_ids' : 'product_variant_image_ids'
  const inverse = model === 'product.template' ? 'product_tmpl_id' : 'product_variant_id'
  let fields: Record<string, Field>
  try {
    fields = await client.execute(model, 'fields_get', [[relation]], { attributes: ['type', 'relation', 'readonly'] })
  } catch (error) {
    if (!urls.length) return null
    throw new Error(`All Images requires the Odoo product.image gallery: ${String(error)}`)
  }
  if (fields?.[relation]?.relation !== 'product.image' || fields[relation].type !== 'one2many' || fields[relation].readonly) {
    if (!urls.length) return null
    throw new Error(`All Images requires ${model}.${relation} (Odoo eCommerce/product.image support)`)
  }
  const imageFields = await client.execute<Record<string, Field>>('product.image', 'fields_get', [['name', 'image_1920', 'sequence', inverse]], { attributes: ['type', 'readonly'] })
  if (!['name', 'image_1920', 'sequence', inverse].every(field => imageFields?.[field] && !imageFields[field].readonly)) {
    throw new Error('All Images requires writable Odoo product.image name, image_1920, sequence and owner fields')
  }
  return { urls, relation, inverse }
}

/** Sync only this source's extra images; preserve manually added media/videos. */
export async function syncProductGallery(
  client: OdooClient,
  model: 'product.template' | 'product.product',
  recordId: number,
  source: Record<string, unknown>,
  settings: Record<string, any>,
  loadImage: (value: unknown) => Promise<string | null>,
  sourceScope = '',
): Promise<void> {
  const capability = await assertProductGalleryCapability(client, model, source, settings)
  if (!capability) return
  const { urls, relation, inverse } = capability
  const prefix = `ERPlink:${digest(`${sourceScope}:${String(source.id)}`)}:`
  // Download every image before changing the gallery. A failed download must not
  // erase the old gallery or leave a silently successful partial update.
  const images: Array<{ name: string; image_1920: string; sequence: number }> = []
  for (const [index, url] of urls.entries()) {
    const binary = await loadImage(url)
    if (!binary) throw new Error(`Failed to download product gallery image ${index + 1}`)
    images.push({ name: `${prefix}${digest(url)}`, image_1920: binary, sequence: index + 1 })
  }
  const existing: ImageRow[] = []
  for (let offset = 0; ; offset += 250) {
    const page = await client.searchRead<ImageRow>('product.image', [[inverse, '=', recordId], ['name', '=like', `${prefix}%`]], ['id', 'name'], 250, offset)
    existing.push(...page.filter(row => row.name.startsWith(prefix)))
    if (page.length < 250) break
  }
  const commands: unknown[][] = []
  const remaining = new Set(existing.map(row => row.id))
  for (const image of images) {
    const previous = existing.find(row => remaining.has(row.id) && row.name === image.name)
    if (previous) {
      remaining.delete(previous.id)
      commands.push([1, previous.id, image])
    } else commands.push([0, 0, image])
  }
  for (const id of remaining) commands.push([2, id, 0])
  if (commands.length && !await client.write(model, [recordId], { [relation]: commands })) {
    throw new Error('Odoo product gallery write returned false')
  }
}
