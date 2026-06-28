export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome to ZidLink. Use the sidebar to manage your connections and settings.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Placeholder cards */}
        <div className="rounded-xl border bg-card p-6 text-card-foreground shadow">
          <h3 className="font-semibold leading-none tracking-tight">Connection Status</h3>
          <p className="text-2xl font-bold mt-2 text-yellow-600">Pending</p>
        </div>
      </div>
    </div>
  )
}
