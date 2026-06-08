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
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "bluurock",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
