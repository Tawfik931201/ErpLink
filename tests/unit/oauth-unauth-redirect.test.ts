import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8')

describe('OAuth unauthenticated ingress redirection', () => {
  const zidConnect = read('src', 'app', 'api', 'zid', 'connect', 'route.ts')
  const zidCallback = read('src', 'app', 'api', 'zid', 'callback', 'route.ts')
  const sallaConnect = read('src', 'app', 'api', 'salla', 'connect', 'route.ts')
  const sallaCallback = read('src', 'app', 'api', 'salla', 'callback', 'route.ts')

  describe('Zid OAuth routes', () => {
    it('redirects unauthenticated visitors to /sign-in in /api/zid/connect', () => {
      expect(zidConnect).toContain('const { userId } = await auth()')
      expect(zidConnect).toContain("const signInUrl = new URL('/sign-in', getAppBaseUrl(req))")
      expect(zidConnect).toContain("signInUrl.searchParams.set('redirect_url', returnUrl)")
    })

    it('redirects unauthenticated visitors to /sign-in preserving callback params in /api/zid/callback', () => {
      expect(zidCallback).toContain('const { userId } = await auth()')
      expect(zidCallback).toContain("const signInUrl = new URL('/sign-in', getAppBaseUrl(request))")
      expect(zidCallback).toContain("signInUrl.searchParams.set('redirect_url', returnUrl)")
      expect(zidCallback).not.toContain("return redirectToConnectZid(request, { error: 'unauthorized' })")
    })

    it('provisions default workspace for new users if active_workspace_id is absent in /api/zid/callback', () => {
      expect(zidCallback).toContain("import('@/lib/workspace-defaults')")
      expect(zidCallback).toContain('await ensureDefaultWorkspace(userId)')
    })
  })

  describe('Salla OAuth routes', () => {
    it('redirects unauthenticated visitors to /sign-in in /api/salla/connect', () => {
      expect(sallaConnect).toContain('const { userId } = await auth()')
      expect(sallaConnect).toContain("const signInUrl = new URL('/sign-in', getAppBaseUrl(req))")
      expect(sallaConnect).toContain("signInUrl.searchParams.set('redirect_url', returnUrl)")
    })

    it('redirects unauthenticated visitors to /sign-in preserving callback params in /api/salla/callback', () => {
      expect(sallaCallback).toContain('const { userId } = await auth()')
      expect(sallaCallback).toContain("const signInUrl = new URL('/sign-in', getAppBaseUrl(request))")
      expect(sallaCallback).toContain("signInUrl.searchParams.set('redirect_url', returnUrl)")
    })

    it('provisions default workspace for new users if active_workspace_id is absent in /api/salla/callback', () => {
      expect(sallaCallback).toContain("import('@/lib/workspace-defaults')")
      expect(sallaCallback).toContain('await ensureDefaultWorkspace(userId)')
    })
  })
})
