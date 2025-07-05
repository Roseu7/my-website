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
            routes(defineRoutes) {
                return defineRoutes((route) => {
                    // Home page
                    route("/", "home/route.tsx", { index: true });
                    
                    // Authentication routes
                    route("login", "auth/login.tsx");
                    route("logout", "auth/logout.tsx");
                    route("auth/callback", "auth/callback.tsx");
                    route("auth/discord", "auth/discord.tsx");
                    
                    // Games routes
                    route("games", "games/route.tsx");
                    
                    // Can't Stop game routes（独立したルート）
                    route("games/cant-stop", "games/cant-stop/route.tsx");
                    route("games/cant-stop/lobby/:roomId", "games/cant-stop/lobby.tsx");
                    route("games/cant-stop/game/:roomId", "games/cant-stop/game.tsx");
                    route("games/cant-stop/result/:roomId", "games/cant-stop/result.tsx");
                    
                    // Tools routes
                    route("tools", "tools/route.tsx", () => {
                        // Add tool routes here as they are created
                        // route("tool-name", "tools/tool-name/route.tsx");
                    });
                    
                    // User profile routes
                    route("profile", "profile/route.tsx", () => {
                    });
                    
                    // 404 catch-all route
                    route("*", "404/route.tsx");
                });
            },
        }),
        tsconfigPaths(),
    ],
    css: {
        postcss: "./postcss.config.js",
    },
    server: {
        port: 5173,
        host: true,
        hmr: {
            port: 24678,
        },
    },
    build: {
        target: "node18",
        rollupOptions: {
            external: ["fsevents"],
            output: {
                manualChunks: undefined,
            },
        },
        // Rollupのネイティブバイナリ問題を回避
        commonjsOptions: {
            include: [/node_modules/],
        },
    },
    optimizeDeps: {
        include: ["react", "react-dom"],
    },
});