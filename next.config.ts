import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 헤드리스 크롬 관련 패키지는 Next.js가 번들링하지 않고
  // 런타임에서 직접 require/import 하도록 외부로 처리
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
};

export default nextConfig;
