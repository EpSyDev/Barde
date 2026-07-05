/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Miniatures YouTube servies directement (pas d'optimisation Vercel).
    unoptimized: true,
  },
};

export default nextConfig;
