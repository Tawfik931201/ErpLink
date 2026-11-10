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
    it('starts Zid OAuth without a partner login gate', () => {
      expect(zidConnect).not.toContain('await auth()')
      expect(zidConnect).not.toContain('/sign-in')
      expect(zidConnect).toContain('await beginZidAuthorization()')
    })

    it('exchanges the code before post-OAuth account linking without forwarding it', () => {
      expect(zidCallback).not.toContain('await auth()')
      expect(zidCallback).not.toContain('redirect_url')
      expect(zidCallback).not.toContain('request.nextUrl.pathname + request.nextUrl.search')
      expect(zidCallback.indexOf('await exchangeAuthorizationCodeForResponse(code)'))
        .toBeLessThan(zidCallback.indexOf('await savePendingZidConnection(tokenData)'))
      expect(zidCallback).toContain('await consumeZidState(state)')
    })

    it('defers workspace provisioning until account linking', () => {
      expect(zidCallback).not.toContain('ensureDefaultWorkspace')
      expect(read('src', 'app', '(public)', 'connect', 'zid', 'page.tsx'))
        .toContain('await ensureDefaultWorkspace(user.id)')
    })

    it('redirects to buildAuthorizationUrl(state) in /api/zid/connect', () => {
      expect(zidConnect).toContain('buildAuthorizationUrl(state)')
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
