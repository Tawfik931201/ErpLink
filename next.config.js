/** @type {import('next').NextConfig} */

// ─── Security headers applied to all routes ───────────────────────
const securityHeaders = [
  // Enforce HTTPS for 2 years, including subdomains
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Limit referrer leakage
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable powerful browser features not used by the app
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  // Baseline XSS/clickjacking containment. `unsafe-inline`/`unsafe-eval` stay
  // because Next.js + Tailwind need them; the tickets XSS fix (sanitizer) is
  // the real control — this header is defence in depth so an injected
  // <script src="https://evil…"> or <iframe> never runs.
  //
  // Clerk allowlist (2026-10-08, per
  // https://clerk.com/docs/guides/secure/best-practices/csp-headers):
  // without it the browser refuses to load clerk-js from the FAPI host and
  // every page fails with `failed_to_load_clerk_js_timeout`. `connect-src`
  // and `img-src` already use the `https:` scheme-source, which covers any
  // host and any port, so they need no change.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://*.clerk.com https://*.protect.clerk.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-src 'self' https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

// ─── CORS ──────────────────────────────────────────────────────────
// SECURITY: never use a wildcard ('*') origin together with
// Access-Control-Allow-Credentials. Cross-origin API access is only
// enabled when CORS_ALLOWED_ORIGIN is explicitly set to a single,
// trusted origin (e.g. https://app.yourdomain.com) in the environment
// (Settings > CI/CD > Variables or the hosting platform's env config).
const corsAllowedOrigin = process.env.CORS_ALLOWED_ORIGIN

const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Was `experimental.serverComponentsExternalPackages` on Next 14.
  // Renamed and stabilised as top-level `serverExternalPackages` in Next
  // 15.0.0 (docs: /docs/app/api-reference/config/next-config-js/
  // serverExternalPackages). Without it `xmlrpc` gets bundled into the
  // server build, which breaks its use of Node built-ins.
  serverExternalPackages: ['xmlrpc'],

  // Allow the ngrok tunnel to access the dev server (development only)
  allowedDevOrigins: [
    'pseudolegendary-conchological-ngan.ngrok-free.dev',
    '*.ngrok-free.dev',
    '*.ngrok-free.app',
    '*.ngrok.io',
  ],

  images: {
    // `images.domains` is deprecated in favour of `remotePatterns` (removed
    // in Next 16). Migrated while on 15 so the next major is not the thing
    // that discovers it.
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.zid.store' },
      { protocol: 'https', hostname: 'zid.store' },
      { protocol: 'https', hostname: 'odoo.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
    // AVIF is back on (2026-10-04, Next 14 -> 15.5.27).
    //
    // It was disabled as the advisory's own interim mitigation for
    // GHSA-2xp9-vwfh-vxw4 (CVSS 9.5, Critical): "Unauthenticated Remote Code
    // Execution in Image Optimization API when AVIF files are used" — a flaw
    // in libheif inside sharp, triggered whenever an AVIF file is optimised.
    // Affected: >=10.0.0 <15.5.24. Patched: 15.5.24 / 16.3.3.
    //
    // We are on 15.5.27, so the fix is in and the mitigation can go.
    // DO NOT downgrade below 15.5.24 while this line is present: the
    // `/_next/image` endpoint is deliberately excluded from the Clerk matcher
    // in src/middleware.ts, so it is public attack surface by design.
    formats: ['image/avif', 'image/webp'],
  },

  async headers() {
    const headers = [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]

    if (corsAllowedOrigin) {
      headers.push({
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: corsAllowedOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
          },
        ],
      })
    }

    return headers
  },

  // Webpack customization for Node.js built-ins used by xmlrpc / ioredis
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        child_process: false,
      }
    }
    return config
  },

  // `experimental.instrumentationHook` and
  // `experimental.serverComponentsExternalPackages` used to live here.
  // Both were stabilised in Next 15.0.0 and the flags were removed:
  // instrumentation.js is now stable, and serverExternalPackages moved to the
  // top level (see above).
  //
  // Removing `instrumentationHook` does NOT stop src/instrumentation.ts from
  // running — that is the whole point of the 15.0 stabilisation. It is still
  // the file that starts the background sync-queue runner and the Telegram
  // poller at boot, so if the queue ever stops draining on its own in
  // production, this is the first thing to check.
}

module.exports = nextConfig
