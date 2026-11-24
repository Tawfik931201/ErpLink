'use client'

import { Check, Copy, Link as LinkIcon } from 'lucide-react'
import Link from 'next/link'
import React, { useState } from 'react'

import type { Language } from '@/lib/translations'

import { DocsCallout, type CalloutType } from './docs-callout'

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative my-4 rounded-lg border border-border bg-muted/40 font-mono text-xs overflow-hidden group">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-border bg-muted/60 text-[10px] text-muted-foreground select-none">
        <span>{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-foreground transition-colors p-1"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[11px] leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function HeadingWithAnchor({
  level,
  id,
  children,
}: {
  level: 2 | 3
  id?: string
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  const handleCopyLink = () => {
    if (!id) return
    const url = `${window.location.origin}${window.location.pathname}#${id}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (level === 2) {
    return (
      <h2
        id={id}
        className="group relative flex items-center gap-2 mt-10 mb-4 text-base sm:text-lg font-bold text-foreground border-b border-border/60 pb-2 scroll-mt-24"
      >
        <span className="flex-1">{children}</span>
        {id && (
          <button
            type="button"
            onClick={handleCopyLink}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-foreground rounded"
            aria-label="Copy section link"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <LinkIcon className="h-3.5 w-3.5" />}
          </button>
        )}
      </h2>
    )
  }

  return (
    <h3
      id={id}
      className="group relative flex items-center gap-2 mt-6 mb-3 text-sm sm:text-base font-bold text-foreground scroll-mt-24"
    >
      <span className="flex-1">{children}</span>
      {id && (
        <button
          type="button"
          onClick={handleCopyLink}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-foreground rounded"
          aria-label="Copy sub-section link"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <LinkIcon className="h-3 w-3" />}
        </button>
      )}
    </h3>
  )
}

export function DocsContent({
  content,
  lang,
}: {
  content: string
  lang: Language
}) {
  // Parse lines and render structured elements
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []

  let i = 0
  let keyIndex = 0

  while (i < lines.length) {
    const line = lines[i]

    // 1. Code Block: ```lang ... ```
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <CodeBlock
          key={`code-${keyIndex++}`}
          code={codeLines.join('\n')}
          language={language}
        />
      )
      continue
    }

    // 2. Callouts: :::note, :::tip, :::warning, :::important, :::caution
    if (line.startsWith(':::')) {
      const type = (line.slice(3).trim() || 'note') as CalloutType
      const calloutLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith(':::')) {
        calloutLines.push(lines[i])
        i++
      }
      i++ // skip closing :::
      elements.push(
        <DocsCallout key={`callout-${keyIndex++}`} type={type} lang={lang}>
          <p>{calloutLines.join(' ')}</p>
        </DocsCallout>
      )
      continue
    }

    // 3. Headings: ## and ###
    if (line.startsWith('## ')) {
      const rawText = line.slice(3).trim()
      // Extract custom id if formatted as `## Title {#custom-id}`
      const match = rawText.match(/^(.*?)\s*\{#([^}]+)\}$/)
      const title = match ? match[1] : rawText
      const id = match
        ? match[2]
        : title
            .toLowerCase()
            .replace(/[^\w\s\u0600-\u06FF-]/g, '')
            .replace(/\s+/g, '-')

      elements.push(
        <HeadingWithAnchor key={`h2-${keyIndex++}`} level={2} id={id}>
          {title}
        </HeadingWithAnchor>
      )
      i++
      continue
    }

    if (line.startsWith('### ')) {
      const rawText = line.slice(4).trim()
      const match = rawText.match(/^(.*?)\s*\{#([^}]+)\}$/)
      const title = match ? match[1] : rawText
      const id = match
        ? match[2]
        : title
            .toLowerCase()
            .replace(/[^\w\s\u0600-\u06FF-]/g, '')
            .replace(/\s+/g, '-')

      elements.push(
        <HeadingWithAnchor key={`h3-${keyIndex++}`} level={3} id={id}>
          {title}
        </HeadingWithAnchor>
      )
      i++
      continue
    }

    // 4. Markdown Tables: lines starting with |
    if (line.startsWith('|')) {
      const tableRows: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableRows.push(lines[i])
        i++
      }

      if (tableRows.length >= 2) {
        const headerCols = tableRows[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())
        // line 1 is separator |---|---|
        const bodyRows = tableRows.slice(2).map((r) =>
          r
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
        )

        elements.push(
          <div key={`table-${keyIndex++}`} className="my-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-start text-xs border-collapse">
              <thead className="bg-muted/40 border-b border-border text-foreground font-bold">
                <tr>
                  {headerCols.map((col, idx) => (
                    <th key={idx} className="p-3 text-start whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 bg-card/20">
                {bodyRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-muted/30 transition-colors">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="p-3 leading-relaxed text-foreground/90">
                        {renderInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    // 5. Unordered List: * or -
    if (line.startsWith('* ') || line.startsWith('- ')) {
      const listItems: string[] = []
      while (i < lines.length && (lines[i].startsWith('* ') || lines[i].startsWith('- '))) {
        listItems.push(lines[i].slice(2).trim())
        i++
      }
      elements.push(
        <ul key={`ul-${keyIndex++}`} className="my-4 ps-5 list-disc space-y-1.5 text-xs text-foreground/90 leading-relaxed">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineFormatting(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    // 6. Ordered List: 1. or 2.
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\.\s*/, '').trim())
        i++
      }
      elements.push(
        <ol key={`ol-${keyIndex++}`} className="my-4 ps-5 list-decimal space-y-2 text-xs text-foreground/90 leading-relaxed">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineFormatting(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    // 7. Regular paragraph
    if (line.trim().length > 0) {
      elements.push(
        <p key={`p-${keyIndex++}`} className="my-3 text-xs sm:text-sm text-foreground/90 leading-relaxed">
          {renderInlineFormatting(line)}
        </p>
      )
    }

    i++
  }

  return <div className="docs-prose max-w-none">{elements}</div>
}

function renderInlineFormatting(text: string): React.ReactNode {
  // Simple inline parser for **bold**, `code`, [link](url)
  const parts: React.ReactNode[] = []
  let remaining = text

  let key = 0
  const linkRegex = /\[(.*?)\]\((.*?)\)/
  const boldRegex = /\*\*(.*?)\*\*/
  const codeRegex = /`([^`]+)`/

  while (remaining.length > 0) {
    // Find earliest match
    const linkMatch = remaining.match(linkRegex)
    const boldMatch = remaining.match(boldRegex)
    const codeMatch = remaining.match(codeRegex)

    const matches = [
      linkMatch ? { type: 'link', match: linkMatch, index: linkMatch.index! } : null,
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch.index! } : null,
      codeMatch ? { type: 'code', match: codeMatch, index: codeMatch.index! } : null,
    ]
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.index - b.index)

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    const first = matches[0]
    if (first.index > 0) {
      parts.push(remaining.slice(0, first.index))
    }

    if (first.type === 'link') {
      const [full, linkText, url] = first.match
      const isInternal = url.startsWith('/') || url.startsWith('#')
      if (isInternal) {
        parts.push(
          <Link
            key={key++}
            href={url}
            className="text-primary font-medium underline underline-offset-4 hover:opacity-80 transition-opacity"
          >
            {linkText}
          </Link>
        )
      } else {
        parts.push(
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium underline underline-offset-4 hover:opacity-80 transition-opacity"
          >
            {linkText}
          </a>
        )
      }
      remaining = remaining.slice(first.index + full.length)
    } else if (first.type === 'bold') {
      const [full, boldText] = first.match
      parts.push(
        <strong key={key++} className="font-bold text-foreground">
          {boldText}
        </strong>
      )
      remaining = remaining.slice(first.index + full.length)
    } else if (first.type === 'code') {
      const [full, codeText] = first.match
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono text-primary border border-border/50"
        >
          {codeText}
        </code>
      )
      remaining = remaining.slice(first.index + full.length)
    }
  }

  return parts
}
