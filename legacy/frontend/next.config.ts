import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 开启 standalone 模式，Docker 部署时只需复制最小运行时文件
  output: "standalone",
};

export default nextConfig;
