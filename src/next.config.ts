import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

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
    // Incremental PPR: opt routes in with `export const experimental_ppr = true`
    cacheComponents: true,
    // Optimize barrel imports to reduce bundle size
    optimizePackageImports: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/storage',
      'lucide-react',
      '@tabler/icons-react',
      'date-fns',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'embla-carousel-react',
    ],
  },

  turbopack: {},

  // Ensure module resolution always includes src/node_modules, even when the
  // dev server is invoked from the monorepo root (CSS @import "tailwindcss"
  // otherwise fails to resolve because no root-level node_modules exists).
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];
    return config;
  },
};

export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  // Sentry org/project — set via SENTRY_ORG / SENTRY_PROJECT env vars
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source map upload auth token (.env.sentry-build-plugin or CI secret)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client source files for better stack trace resolution
  widenClientFileUpload: true,

  // Note: tunnelRoute is intentionally omitted — this app's middleware rewrites
  // all non-Electron traffic to /desktop-only, which would break a tunnel route.

  // Suppress non-CI build output
  silent: !process.env.CI,
});
