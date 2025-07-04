// vite.config.ts
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [
        remix({
            ignoredRouteFiles: ["**/.*"],
            future: {
                v3_fetcherPersist: true,
                v3_relativeSplatPath: true,
                v3_throwAbortReason: true,
                v3_singleFetch: true,
                v3_lazyRouteDiscovery: true,
            },
        }),
        tsconfigPaths(),
    ],
    css: {
        postcss: "./postcss.config.js",
    },
    server: {
        port: 5173,
        host: true, // すべてのネットワークインターフェースでリスニング
        hmr: {
            port: 24678, // HMRポートを明示的に指定
        },
    },
});