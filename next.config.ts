import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'vwvgpynnjevidaqgglqd.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/bengaluru',
        destination: '/bangalore',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/sitemap-events.xml',
        destination: '/sitemap-events',
      },
    ];
  },
};

export default nextConfig;
