import type { NextConfig } from "next";
import path from "path";

// Bundle analyzer configuration (enabled via ANALYZE=true environment variable)
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  // Optimize images for better load times
  images: {
    formats: ['image/avif', 'image/webp'],
  },

  // Enable React strict mode for better performance warnings in development
  reactStrictMode: true,

  // Production optimizations
  compiler: {
    // Remove console logs in production (except errors and warnings)
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },

  // Experimental optimizations for package imports
  experimental: {
    // Optimize Firebase imports to reduce bundle size
    optimizePackageImports: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'lucide-react', '@tabler/icons-react'],
  },

  // Ensure module resolution always includes src/node_modules, even when the
  // dev server is invoked from the monorepo root (CSS @import "tailwindcss"
  // otherwise fails to resolve because no root-level node_modules exists).
  turbopack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];
    return config;
  },
};

export default withBundleAnalyzer(nextConfig);
