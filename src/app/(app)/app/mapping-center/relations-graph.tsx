'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState, useId, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'

export interface RelationEdge {
  sourceModel: string
  targetModel: string
  relationField: string
  relationType?: string
}

export interface RelationsGraphProps {
  primaryModel: string
  relatedModels: Array<{ model: string; label?: string }>
  relations: RelationEdge[]
  activeModel?: string
  onSelectModel?: (model: string) => void
  lang: 'ar' | 'en'
  dir: 'rtl' | 'ltr'
  compact?: boolean
  className?: string
}

const REL_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  one2many: { ar: '1-لكثير', en: '1-N' },
  many2one: { ar: 'كثير-1', en: 'N-1' },
  many2many: { ar: 'كثير-لكثير', en: 'N-N' },
  unknown: { ar: 'علاقة', en: 'rel' },
}

const REL_TYPE_COLORS: Record<string, string> = {
  one2many: '#3b82f6',
  many2one: '#f59e0b',
  many2many: '#a855f7',
  unknown: '#6b7280',
}

const NODE_W = 160
const NODE_H = 40
const GAP = 16
const PAD = 16

function relColor(t?: string): string {
  return REL_TYPE_COLORS[t || 'unknown'] || REL_TYPE_COLORS.unknown
}

function relLabel(t: string | undefined, lang: 'ar' | 'en'): string {
  const e = REL_TYPE_LABELS[t || 'unknown'] || REL_TYPE_LABELS.unknown
  return lang === 'ar' ? e.ar : e.en
}

function nodeLabel(m: { model: string; label?: string }): string {
  return m.label || m.model
}

export default function RelationsGraph({
  primaryModel,
  relatedModels,
  relations,
  activeModel,
  onSelectModel,
  lang,
  dir,
  className,
  compact = false,
}: RelationsGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const arrowId = `relations-graph-arrow-${useId().replace(/[:.]/g, '-')}`

  const layout = useMemo(() => {
    const n = relatedModels.length
    if (n === 0) return null

    const isRtl = dir === 'rtl'

    if (compact) {
      const total = n + 1
      const height = total * NODE_H + (total - 1) * GAP + PAD * 2
      const width = NODE_W + PAD * 2

      const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {}

      nodes[primaryModel] = { x: PAD, y: PAD, w: NODE_W, h: NODE_H }

      relatedModels.forEach((m, i) => {
        nodes[m.model] = {
          x: PAD,
          y: PAD + (i + 1) * (NODE_H + GAP),
          w: NODE_W,
          h: NODE_H,
        }
      })

      const edges = relatedModels.map((m, i) => {
        const a = nodes[primaryModel]
        const b = nodes[m.model]
        const r = relations.find(
          (e) =>
            (e.sourceModel === primaryModel && e.targetModel === m.model) ||
            (e.sourceModel === m.model && e.targetModel === primaryModel),
        ) || { sourceModel: primaryModel, targetModel: m.model, relationField: '', relationType: 'unknown' }
        return {
          key: `e-${i}`,
          x1: a.x + a.w / 2,
          y1: a.y + a.h,
          x2: b.x + b.w / 2,
          y2: b.y,
          relation: r,
        }
      })

      return { width, height, nodes, edges }
    }

    const useTwoCols = n > 4
    const cols = useTwoCols ? 2 : 1
    const rows = Math.ceil(n / cols)
    const colW = NODE_W + GAP
    const nodesWidth = cols * NODE_W + (cols - 1) * GAP
    const relatedHeight = rows * NODE_H + (rows - 1) * GAP
    const height = Math.max(NODE_H, relatedHeight) + PAD * 2
    const width = NODE_W + nodesWidth + GAP * 3 + PAD * 2

    const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {}

    const primaryX = isRtl ? width - NODE_W - PAD : PAD
    nodes[primaryModel] = { x: primaryX, y: height / 2 - NODE_H / 2, w: NODE_W, h: NODE_H }

    const relatedBaseX = isRtl ? PAD : width - PAD - nodesWidth
    relatedModels.forEach((m, i) => {
      const col = useTwoCols ? i % cols : 0
      const row = useTwoCols ? Math.floor(i / cols) : i
      const x = isRtl
        ? relatedBaseX + (cols - 1 - col) * colW
        : relatedBaseX + col * colW
      const y = PAD + row * (NODE_H + GAP)
      nodes[m.model] = { x, y, w: NODE_W, h: NODE_H }
    })

    const edges = relatedModels.map((m, i) => {
      const a = nodes[primaryModel]
      const b = nodes[m.model]
      const r = relations.find(
        (e) =>
          (e.sourceModel === primaryModel && e.targetModel === m.model) ||
          (e.sourceModel === m.model && e.targetModel === primaryModel),
      ) || { sourceModel: primaryModel, targetModel: m.model, relationField: '', relationType: 'unknown' }
      return {
        key: `e-${i}`,
        x1: a.x + a.w / 2,
        y1: a.y + a.h / 2,
        x2: b.x + b.w / 2,
        y2: b.y + b.h / 2,
        relation: r,
      }
    })

    return { width, height, nodes, edges }
  }, [primaryModel, relatedModels, relations, dir, compact])

  if (relatedModels.length === 0) {
    return (
      <div
        role="img"
        aria-label={lang === 'ar' ? 'لا توجد نماذج مرتبطة بعد' : 'No related models yet'}
        className={cn(
          'flex min-h-[60px] items-center justify-center text-xs text-muted-foreground',
          className,
        )}
      >
        {lang === 'ar' ? 'لا توجد نماذج مرتبطة بعد' : 'No related models yet'}
      </div>
    )
  }

  if (!layout) return null

  const isHighlighted = (model: string) => hovered === model || activeModel === model

  const edgeIsHighlighted = (edge: typeof layout.edges[number]) =>
    hovered === edge.relation.sourceModel ||
    hovered === edge.relation.targetModel ||
    activeModel === edge.relation.sourceModel ||
    activeModel === edge.relation.targetModel

  const nodeButtonProps = (
    pos: { x: number; y: number; w: number; h: number },
    width: number,
  ): CSSProperties => ({
    position: 'absolute',
    left: `${(pos.x / width) * 100}%`,
    top: pos.y,
    width: `${(pos.w / width) * 100}%`,
    height: pos.h,
  })

  return (
    <div
      role="img"
      aria-label={
        lang === 'ar'
          ? `مخطط علاقات بين ${relatedModels.length + 1} نماذج`
          : `Relations graph between ${relatedModels.length + 1} models`
      }
      className={cn('relative w-full', className)}
      style={{ minHeight: layout.height }}
    >
      <svg
        aria-hidden
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const hi = edgeIsHighlighted(edge)
          const color = hi ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'
          const opacity = hi ? 0.8 : 0.5
          const fld = edge.relation.relationField

          if (!fld) {
            return (
              <line
                key={edge.key}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={color}
                strokeWidth={hi ? 2.5 : 1.5}
                opacity={opacity}
                markerEnd={`url(#${arrowId})`}
              />
            )
          }

          const edgeLen = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2)
          const showBadge = edgeLen > 120 && edge.relation.relationType != null && edge.relation.relationType !== 'unknown'
          const midX = (edge.x1 + edge.x2) / 2
          const midY = (edge.y1 + edge.y2) / 2
          const badgeText = showBadge ? relLabel(edge.relation.relationType, lang) : ''
          const fldW = fld.length * 4.5
          const badgeW = badgeText.length * 4.5 + 10
          const dotR = 3
          const padL = 6
          const gap = 4
          const totalW = dotR * 2 + padL + fldW + (showBadge ? gap + badgeW : 0) + 8
          const bgH = 20
          const bgX = midX - totalW / 2
          const bgY = midY - bgH / 2
          const dotCX = bgX + dotR + padL / 2
          const textX = dotCX + dotR + 3
          const badgeX = textX + fldW + gap

          return (
            <g key={edge.key} style={{ color }} opacity={opacity}>
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke="currentColor"
                strokeWidth={hi ? 2.5 : 1.5}
                markerEnd={`url(#${arrowId})`}
              />
              <g style={{ pointerEvents: 'none' }}>
                <rect
                  x={bgX}
                  y={bgY}
                  width={totalW}
                  height={bgH}
                  rx={10}
                  fill="hsl(var(--background))"
                  opacity={0.92}
                />
                <circle cx={dotCX} cy={midY} r={dotR} fill={relColor(edge.relation.relationType)} />
                <text x={textX} y={midY + 4} fontSize={10} fill="currentColor">
                  {fld}
                </text>
                {showBadge && (
                  <text x={badgeX} y={midY + 4} fontSize={8} fill="currentColor" opacity={0.7}>
                    {badgeText}
                  </text>
                )}
              </g>
            </g>
          )
        })}
      </svg>

      <AnimatePresence>
        <motion.button
          key={primaryModel}
          type="button"
          aria-label={primaryModel}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          style={nodeButtonProps(layout.nodes[primaryModel], layout.width)}
          onClick={() => onSelectModel?.(primaryModel)}
          onMouseEnter={() => setHovered(primaryModel)}
          onMouseLeave={() => setHovered(null)}
          className={cn(
            'rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors truncate',
            'bg-foreground text-background border-foreground font-bold',
          )}
        >
          {primaryModel}
        </motion.button>

        {relatedModels.map((m) => {
          const pos = layout.nodes[m.model]
          if (!pos) return null
          const hi = isHighlighted(m.model)
          return (
            <motion.button
              key={m.model}
              type="button"
              aria-label={nodeLabel(m)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              style={nodeButtonProps(pos, layout.width)}
              onClick={() => onSelectModel?.(m.model)}
              onMouseEnter={() => setHovered(m.model)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors truncate',
                hi
                  ? 'border-foreground bg-muted text-foreground'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              )}
            >
              {nodeLabel(m)}
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
