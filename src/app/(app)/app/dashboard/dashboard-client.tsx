'use client'

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useLanguage } from '@/components/language-provider'
import type { DailyActivity } from '@/types'

interface SyncAreaChartProps {
  data: DailyActivity[]
}

export function SyncAreaChart({ data }: SyncAreaChartProps) {
  const { dir } = useLanguage()
  const isRtl = dir === 'rtl'

  const formatLabel = (val: string) => {
    const d = new Date(val + 'T00:00:00')
    return d.toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
      weekday: 'short',
      day: 'numeric',
    })
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={formatLabel}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--card))',
            fontSize: 12,
            color: 'hsl(var(--foreground))',
          }}
          labelFormatter={(val: string) =>
            new Date(val + 'T00:00:00').toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
              dateStyle: 'medium',
            })
          }
          formatter={(value: number, name: string) => {
            const label = name === 'success'
              ? isRtl ? 'ناجح' : 'Success'
              : name === 'failed'
                ? isRtl ? 'فشل' : 'Failed'
                : isRtl ? 'تم التخطي' : 'Skipped'
            return [value, label]
          }}
        />
        <Area
          type="monotone"
          dataKey="success"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#colorSuccess)"
        />
        <Area
          type="monotone"
          dataKey="failed"
          stroke="#f43f5e"
          strokeWidth={1.5}
          fill="url(#colorFailed)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
