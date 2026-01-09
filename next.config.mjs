/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev, isServer }) => {
    // Windows + OneDrive can break Webpack's filesystem cache inside `.next/cache`,
    // causing missing server chunks like `Cannot find module './948.js'`.
    // Disabling persistent cache in dev is slower but much more reliable here.
    if (dev) {
      config.cache = false;
    }

    // Extra hardening for Windows/OneDrive in dev:
    // avoid server-side code splitting that creates `./<id>.js` require() chunks.
    if (dev && isServer) {
      if (config.optimization) {
        config.optimization.splitChunks = false;
        config.optimization.runtimeChunk = false;
      }
    }
    return config;
  },
};

export default nextConfig;


