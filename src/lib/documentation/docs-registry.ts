import { articlesAccounts } from './articles/articles-accounts'
import { articlesConnect } from './articles/articles-connect'
import { articlesGettingStarted } from './articles/articles-getting-started'
import { articlesMapping } from './articles/articles-mapping'
import { articlesOperations } from './articles/articles-operations'
import { articlesOrders } from './articles/articles-orders'
import { articlesTroubleshooting } from './articles/articles-troubleshooting'
import type { DocArticle, DocCategory } from './docs-types'

export const DOCS_REGISTRY: DocArticle[] = [
  ...articlesGettingStarted,
  ...articlesConnect,
  ...articlesMapping,
  ...articlesOrders,
  ...articlesOperations,
  ...articlesAccounts,
  ...articlesTroubleshooting,
]

export function getAllDocArticles(): DocArticle[] {
  return DOCS_REGISTRY
}

export function getDocArticleBySlug(slug: string): DocArticle | undefined {
  // Normalize slug by removing leading/trailing slashes
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '')
  return DOCS_REGISTRY.find((article) => article.slug === cleanSlug)
}

export function getDocArticlesByCategory(category: DocCategory): DocArticle[] {
  return DOCS_REGISTRY.filter((article) => article.category === category)
}
