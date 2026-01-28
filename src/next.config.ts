import type { NextConfig } from "next";

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
    optimizePackageImports: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
  },
};

export default withBundleAnalyzer(nextConfig);
