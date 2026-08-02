'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

import { useLanguage } from '@/components/language-provider'
import type { DailyActivity, EventDistribution } from '@/types'

const PIE_COLORS = [
  '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1',
]

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
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
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
        />
        <Area
          type="monotone"
          dataKey="success"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#colorSuccess)"
          name={isRtl ? 'ناجح' : 'Success'}
        />
        <Area
          type="monotone"
          dataKey="failed"
          stroke="#f43f5e"
          strokeWidth={1.5}
          fill="url(#colorFailed)"
          name={isRtl ? 'فاشل' : 'Failed'}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

interface EventPieChartProps {
  data: EventDistribution[]
}
export function EventPieChart({ data }: EventPieChartProps) {
  const { dir } = useLanguage()
  const isRtl = dir === 'rtl'

  const truncate = (s: string) => (s.length > 22 ? s.slice(0, 20) + '…' : s)

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
        {isRtl ? 'لا توجد بيانات' : 'No data'}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="event"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [value, truncate(name)]}
          contentStyle={{
            borderRadius: 8,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--card))',
            fontSize: 12,
            color: 'hsl(var(--foreground))',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
