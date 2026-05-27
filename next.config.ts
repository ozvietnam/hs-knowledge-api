import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  // Legacy api/*.js endpoints vẫn work song song app/api/*
};

export default config;
