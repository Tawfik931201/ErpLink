import Image from 'next/image'
import React from 'react'

import { cn } from '@/lib/utils'

export interface LogoProps {
  /**
   * - 'horizontal': Cart icon + ErpLink text side-by-side (ideal for headers and navbars)
   * - 'icon': Cart icon only (ideal for small avatars, mobile badges)
   * - 'stacked': Full stacked logo with cart icon on top and text below
   */
  variant?: 'horizontal' | 'icon' | 'stacked'
  /**
   * Preset sizes:
   * - 'xs': ultra-compact (~18px height)
   * - 'sm': compact (~20px height)
   * - 'md': default refined header size (~24px height)
   * - 'lg': medium prominence (~30px height)
   * - 'xl': showcase (~36px height)
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  priority?: boolean
  alt?: string
}

const DIMENSIONS: Record<
  'horizontal' | 'icon' | 'stacked',
  Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', { width: number; height: number; classStr: string }>
> = {
  horizontal: {
    xs: { width: 72, height: 18, classStr: 'h-[18px] w-auto' },
    sm: { width: 85, height: 21, classStr: 'h-[21px] w-auto' },
    md: { width: 102, height: 25, classStr: 'h-[25px] w-auto' },
    lg: { width: 122, height: 30, classStr: 'h-[30px] w-auto' },
    xl: { width: 150, height: 37, classStr: 'h-[37px] w-auto' },
  },
  icon: {
    xs: { width: 18, height: 18, classStr: 'h-[18px] w-[18px]' },
    sm: { width: 22, height: 22, classStr: 'h-[22px] w-[22px]' },
    md: { width: 26, height: 26, classStr: 'h-[26px] w-[26px]' },
    lg: { width: 32, height: 32, classStr: 'h-[32px] w-[32px]' },
    xl: { width: 40, height: 40, classStr: 'h-[40px] w-[40px]' },
  },
  stacked: {
    xs: { width: 48, height: 34, classStr: 'h-[34px] w-auto' },
    sm: { width: 62, height: 44, classStr: 'h-[44px] w-auto' },
    md: { width: 76, height: 54, classStr: 'h-[54px] w-auto' },
    lg: { width: 98, height: 70, classStr: 'h-[70px] w-auto' },
    xl: { width: 126, height: 90, classStr: 'h-[90px] w-auto' },
  },
}

export function Logo({
  variant = 'horizontal',
  size = 'md',
  className,
  priority = false,
  alt = 'ErpLink Logo',
}: LogoProps) {
  const dims = DIMENSIONS[variant][size]

  const lightSrc =
    variant === 'icon'
      ? '/logo-icon.png'
      : variant === 'stacked'
      ? '/logo.png'
      : '/logo-horizontal.png'

  const darkSrc =
    variant === 'icon'
      ? '/logo-icon-dark.png'
      : variant === 'stacked'
      ? '/logo-dark.png'
      : '/logo-horizontal-dark.png'

  return (
    <div className={cn('relative inline-flex items-center justify-center shrink-0 select-none', className)}>
      {/* Light mode logo */}
      <Image
        src={lightSrc}
        alt={alt}
        width={dims.width}
        height={dims.height}
        priority={priority}
        className={cn('object-contain dark:hidden', dims.classStr)}
      />
      {/* Dark mode logo */}
      <Image
        src={darkSrc}
        alt={alt}
        width={dims.width}
        height={dims.height}
        priority={priority}
        className={cn('object-contain hidden dark:block', dims.classStr)}
      />
    </div>
  )
}

export default Logo
