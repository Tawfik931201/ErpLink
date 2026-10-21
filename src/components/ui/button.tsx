import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85 dark:shadow-none',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/85 dark:shadow-none',
        outline:
          'border border-border bg-card text-foreground hover:bg-muted/70 hover:border-border/70',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'text-muted-foreground hover:bg-muted hover:text-foreground',
        link:
          'text-primary underline-offset-4 hover:underline p-0 h-auto',
        brand:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85 dark:shadow-none',
        success:
          'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 dark:bg-emerald-700 dark:text-emerald-50 dark:hover:bg-emerald-600',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base rounded-xl',
        xl: 'h-14 px-7 text-base rounded-xl',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    if (asChild && React.isValidElement(children)) {
      // React 19 types narrow isValidElement/Children.only to
      // ReactElement<unknown>, so `child.props` is `unknown` instead of `any`.
      // Assert only the field we read; runtime behaviour is unchanged.
      const child = React.Children.only(children) as React.ReactElement<{
        className?: string
      }>

      return React.cloneElement(child, {
        ...props,
        className: cn(
          buttonVariants({ variant, size, className }),
          child.props.className
        ),
        ref,
      } as React.HTMLAttributes<HTMLElement>)
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
