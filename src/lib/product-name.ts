export function getProductName(p: any): string {
  const name = p.name?.ar || p.name?.en || p.name || p.title || p.name_string || p.product_name
  if (name) return String(name)
  return `#${p.id}`
}