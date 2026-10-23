/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://backend:5000/api/:path*" }];
  }
};

module.exports = nextConfig;
