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
  swcMinify: true,

  // Allow the ngrok tunnel to access the dev server (development only)
  allowedDevOrigins: [
    'pseudolegendary-conchological-ngan.ngrok-free.dev',
    '*.ngrok-free.dev',
    '*.ngrok-free.app',
    '*.ngrok.io',
  ],

  images: {
    domains: [
      'cdn.zid.store',
      'zid.store',
      'odoo.com',
      'localhost',
    ],
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

  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'xmlrpc', 'ioredis', 'bull'],
  },
}

module.exports = nextConfig
