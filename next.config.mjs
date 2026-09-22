const config = {
  htmlLimitedBots: /.*/,
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  experimental: {},
  async headers() {
    return [
      {
        source: "/media/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};
export default config;
