import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 gap-2',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm dark:shadow-none',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm dark:shadow-none',
        outline:
          'border border-border bg-card text-foreground/80 hover:bg-secondary hover:text-foreground shadow-sm dark:shadow-none',
        secondary:
          'bg-secondary text-foreground/90 hover:bg-secondary/80',
        ghost:
          'text-muted-foreground hover:bg-secondary hover:text-foreground',
        link:
          'text-primary underline-offset-4 hover:underline p-0 h-auto',
        brand:
          'gradient-brand text-white shadow-sm dark:shadow-none hover:opacity-90 active:opacity-80',
        success:
          'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm dark:shadow-none dark:bg-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-700',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 px-3.5 text-xs rounded-lg',
        lg: 'h-12 px-7 text-base',
        xl: 'h-14 px-8 text-base',
        icon: 'h-10 w-10 rounded-xl',
        'icon-sm': 'h-8 w-8 rounded-lg',
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
      const child = React.Children.only(children)

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
