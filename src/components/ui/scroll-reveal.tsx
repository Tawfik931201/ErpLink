'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/** Applied to <html> so the CSS hidden state only exists while this runs. */
const ROOT_CLASS = 'reveal-enabled'
const TARGET_CLASS = 'reveal'
const VISIBLE_CLASS = 'reveal-visible'

/**
 * Reveals every `.reveal` element in the public pages the first time it enters
 * the viewport. Renders nothing — the animation lives in globals.css, so the
 * markup stays a plain server component (`className="reveal"` + an optional
 * `--reveal-delay`).
 *
 * Deliberate choices:
 * - The hidden state is opt-in (ROOT_CLASS added on mount), so with JS disabled
 *   or hydration broken every section is simply visible. A landing page that
 *   stays blank without JS is worse than one without motion.
 * - Elements already on screen are marked visible in the same task as
 *   ROOT_CLASS is added, so there is no hide-then-show flicker.
 * - Respects `prefers-reduced-motion` by revealing everything immediately.
 */
export function ScrollReveal() {
  const pathname = usePathname()

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`.${TARGET_CLASS}`))
    if (!nodes.length) return

    const root = document.documentElement
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || typeof window.IntersectionObserver === 'undefined') {
      nodes.forEach((node) => node.classList.add(VISIBLE_CLASS))
      root.classList.remove(ROOT_CLASS)
      return
    }

    root.classList.add(ROOT_CLASS)

    const pending: HTMLElement[] = []

    nodes.forEach((node) => {
      if (node.classList.contains(VISIBLE_CLASS)) return

      const rect = node.getBoundingClientRect()
      const onScreen = rect.top < window.innerHeight && rect.bottom > 0

      if (onScreen) node.classList.add(VISIBLE_CLASS)
      else pending.push(node)
    })

    if (!pending.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add(VISIBLE_CLASS)
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )

    pending.forEach((node) => observer.observe(node))

    return () => observer.disconnect()
  }, [pathname])

  return null
}
