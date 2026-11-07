import type { OdooClient } from '../../src/lib/odoo-client'
import { syncProductGallery } from '../../src/lib/products/image-gallery'

const settings = { image: { sync_mode: 'all' } }
const source = { id: 'qa-source', images: [{ url: 'https://images.test/extra.png' }, { url: 'https://images.test/main.png', is_main: true }] }
function fixture(model = 'product.template') {
  const relation = model === 'product.template' ? 'product_template_image_ids' : 'product_variant_image_ids'
  const inverse = model === 'product.template' ? 'product_tmpl_id' : 'product_variant_id'
  const execute = jest.fn().mockImplementation(async (target: string) => target === model
    ? { [relation]: { type: 'one2many', relation: 'product.image' } }
    : { name: {}, image_1920: {}, sequence: {}, [inverse]: {} })
  const searchRead = jest.fn().mockResolvedValue([])
  const write = jest.fn().mockResolvedValue(true)
  const load = jest.fn().mockResolvedValue('BASE64')
  return { client: { execute, searchRead, write } as unknown as OdooClient, execute, searchRead, write, load, relation, inverse }
}

describe('All Images gallery synchronization', () => {
  it.each(['skip', 'main_only', undefined])('preserves the gallery and makes no calls for %s', async mode => {
    const f = fixture()
    await syncProductGallery(f.client, 'product.template', 39, source, { image: { sync_mode: mode } }, f.load)
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.load).not.toHaveBeenCalled()
    expect(f.write).not.toHaveBeenCalled()
  })

  it('stores extra images in order, excludes the flagged main image, and does not duplicate on retry', async () => {
    const f = fixture()
    await syncProductGallery(f.client, 'product.template', 39, source, settings, f.load)
    const gallery = f.write.mock.calls[0][2].product_template_image_ids
    expect(gallery).toEqual([[0, 0, { name: expect.stringMatching(/^ERPlink:/), image_1920: 'BASE64', sequence: 1 }]])
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.load).toHaveBeenCalledWith('https://images.test/extra.png')
    const name = gallery[0][2].name
    f.searchRead.mockResolvedValue([{ id: 100, name }])
    await syncProductGallery(f.client, 'product.template', 39, source, settings, f.load)
    expect(f.write).toHaveBeenLastCalledWith('product.template', [39], { product_template_image_ids: [[1, 100, { name, image_1920: 'BASE64', sequence: 1 }]] })
    expect(f.searchRead).toHaveBeenCalledWith('product.image', [['product_tmpl_id', '=', 39], ['name', '=like', expect.stringMatching(/^ERPlink:.*:%$/)]], ['id', 'name'], 250, 0)
  })

  it('keeps native variant images scoped to product.product rather than a coincident template ID', async () => {
    const f = fixture('product.product')
    await syncProductGallery(f.client, 'product.product', 57, source, settings, f.load)
    expect(f.write).toHaveBeenCalledWith('product.product', [57], { product_variant_image_ids: expect.any(Array) })
    expect(f.searchRead.mock.calls[0][1][0]).toEqual(['product_variant_id', '=', 57])
  })

  it('fails clearly when gallery capability is missing instead of reporting partial all-images success', async () => {
    const f = fixture()
    f.execute.mockResolvedValue({})
    await expect(syncProductGallery(f.client, 'product.template', 39, source, settings, f.load)).rejects.toThrow('All Images requires')
    expect(f.load).not.toHaveBeenCalled()
    expect(f.write).not.toHaveBeenCalled()
  })

  it('does not change existing gallery entries if any image download fails', async () => {
    const f = fixture()
    f.load.mockResolvedValueOnce('FIRST').mockResolvedValueOnce(null)
    await expect(syncProductGallery(f.client, 'product.template', 39, { id: 'qa', images: ['main', 'one', 'two'] }, settings, f.load)).rejects.toThrow('Failed to download')
    expect(f.write).not.toHaveBeenCalled()
  })

  it('removes only stale entries owned by the same source and atomically replaces them', async () => {
    const f = fixture()
    await syncProductGallery(f.client, 'product.template', 39, source, settings, f.load)
    const name = f.write.mock.calls[0][2].product_template_image_ids[0][2].name
    f.searchRead.mockResolvedValue([{ id: 100, name }, { id: 999, name: 'Manual product photo' }])
    await syncProductGallery(f.client, 'product.template', 39, { ...source, images: ['https://images.test/main.png'] }, settings, f.load)
    expect(f.write).toHaveBeenLastCalledWith('product.template', [39], { product_template_image_ids: [[2, 100, 0]] })
  })

  it('recognizes Zid origin and thumbs.fullSize while keeping the same flagged primary image as the mapper', async () => {
    const f = fixture()
    await syncProductGallery(f.client, 'product.template', 39, { id: 'qa', images: [{ origin: 'https://images.test/main.png', is_default: true }, { thumbs: { fullSize: 'https://images.test/extra.png' } }] }, settings, f.load)
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.load).toHaveBeenCalledWith('https://images.test/extra.png')
  })

  it('rejects unknown nonempty images before any gallery lookup/download/write rather than clearing owned entries', async () => {
    const f = fixture()
    await expect(syncProductGallery(f.client, 'product.template', 39, { id: 'qa', images: [{ unknown: 'image' }] }, settings, f.load)).rejects.toThrow('Unrecognized product image URL')
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.load).not.toHaveBeenCalled()
    expect(f.write).not.toHaveBeenCalled()
  })

  it('namespaces owned images by store so equal source IDs in two stores cannot overwrite each other', async () => {
    const f = fixture()
    await syncProductGallery(f.client, 'product.template', 39, source, settings, f.load, 'zid:store-a')
    const first = f.write.mock.calls[0][2].product_template_image_ids[0][2].name
    await syncProductGallery(f.client, 'product.template', 39, source, settings, f.load, 'zid:store-b')
    const second = f.write.mock.calls[1][2].product_template_image_ids[0][2].name
    expect(first).not.toBe(second)
  })

  it('does not interpret absent images in a partial webhook as a request to clear the gallery', async () => {
    const f = fixture()
    await syncProductGallery(f.client, 'product.template', 39, { id: 'qa' }, settings, f.load)
    expect(f.execute).not.toHaveBeenCalled()
  })
})
