import { ArrowRight, ShoppingBag, Database, Zap } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/85 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="gradient-brand-text text-2xl font-bold tracking-tight">ZidLink</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <Link href="#features" className="transition-colors hover:text-foreground">Features</Link>
              <Link href="#how-it-works" className="transition-colors hover:text-foreground">How it Works</Link>
              <Link href="#integrations" className="transition-colors hover:text-foreground">Integrations</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Sign In
            </Link>
            <Button asChild variant="brand" size="sm">
              <Link href="/sign-up">
                Get Started
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative overflow-hidden py-20 md:py-32">
          {/* Subtle grid background */}
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

          <div className="container px-4 md:px-8 text-center max-w-4xl mx-auto">
            {/* Brand gradient headline */}
            <h1 className="gradient-brand-text mb-6 text-5xl md:text-7xl font-extrabold tracking-tight">
              ZidLink
            </h1>
            <h2 className="mb-4 text-2xl md:text-3xl font-semibold text-foreground">
              Connect Odoo & Zid in Minutes
            </h2>
            <p className="mb-10 text-lg md:text-xl text-muted-foreground leading-relaxed">
              Automate product listings, orders, customers and inventory between your Zid
              e-commerce store and your Odoo ERP — in real time, zero code required.
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button asChild variant="brand" size="lg">
                <Link href="/sign-up" className="flex items-center gap-2">
                  Get Started Free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="#features">Learn More</Link>
              </Button>
            </div>

            {/* Integration badges */}
            <div className="mt-16 flex items-center justify-center gap-8">
              <div className="flex items-center gap-2 rounded-full border border-zid-200 bg-zid-50 px-4 py-2 text-zid-700 dark:border-zid-800 dark:bg-zid-950 dark:text-zid-300">
                <span className="h-2 w-2 rounded-full bg-zid-500" />
                <span className="text-sm font-medium">Zid Store</span>
              </div>
              <span className="text-2xl text-muted-foreground">⟷</span>
              <div className="flex items-center gap-2 rounded-full border border-odoo-200 bg-odoo-50 px-4 py-2 text-odoo-700 dark:border-odoo-800 dark:bg-odoo-950 dark:text-odoo-300">
                <span className="h-2 w-2 rounded-full bg-odoo-500" />
                <span className="text-sm font-medium">Odoo ERP</span>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-20 border-t border-border bg-muted/30">
          <div className="container px-4 md:px-8 max-w-6xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight">Key Features</h2>
              <p className="mt-4 text-muted-foreground">
                Everything you need to keep your retail operations in perfect sync.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="p-2 w-fit rounded-lg bg-primary/10 text-primary mb-4">
                  <ShoppingBag className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Product & Inventory Sync</h3>
                <p className="text-sm text-muted-foreground">
                  Instantly publish products from Odoo to Zid and automatically update stock levels in real time to avoid overselling.
                </p>
              </div>

              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="p-2 w-fit rounded-lg bg-primary/10 text-primary mb-4">
                  <Zap className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Automated Orders</h3>
                <p className="text-sm text-muted-foreground">
                  New Zid store orders flow directly into Odoo as sales orders. Invoices and delivery orders are generated automatically.
                </p>
              </div>

              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="p-2 w-fit rounded-lg bg-primary/10 text-primary mb-4">
                  <Database className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Customer Profiles</h3>
                <p className="text-sm text-muted-foreground">
                  Keep customer details synchronized. Avoid duplication and ensure accurate billing and delivery information.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 bg-background">
        <div className="container px-4 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} ZidLink. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="#" className="hover:underline">Privacy Policy</Link>
            <Link href="#" className="hover:underline">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
