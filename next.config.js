/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // Allow the ngrok tunnel to access the dev server
  allowedDevOrigins: [
    '2ad5-102-184-228-54.ngrok-free.app',
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
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
          },
        ],
      },
    ]
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
