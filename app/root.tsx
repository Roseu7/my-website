import type { LinksFunction, MetaFunction } from "@remix-run/node";
import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useNavigation,
} from "@remix-run/react";
import { useEffect, useState } from "react";

// Tailwind CSSを直接インポート
import "./tailwind.css";

export const meta: MetaFunction = () => [
    { charset: "utf-8" },
    { title: "Roseu's Site" },
    { name: "viewport", content: "width=device-width,initial-scale=1" },
];

export default function App() {
    const navigation = useNavigation();
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (navigation.state === "loading") {
            setIsLoading(true);
        } else {
            // 少し遅延を入れて自然な遷移にする
            const timer = setTimeout(() => setIsLoading(false), 150);
            return () => clearTimeout(timer);
        }
    }, [navigation.state]);

    return (
        <html lang="ja">
            <head>
                <Meta />
                <Links />
            </head>
            <body>
                {/* ページ遷移インジケーター */}
                {isLoading && (
                    <div className="fixed top-0 left-0 right-0 z-50">
                        <div className="h-1 bg-gradient-to-r from-indigo-500 to-purple-600 animate-pulse">
                            <div className="h-full bg-gradient-to-r from-indigo-600 to-purple-700 animate-[loading_1s_ease-in-out_infinite]"></div>
                        </div>
                    </div>
                )}
                
                {/* メインコンテンツ */}
                <div className={`transition-opacity duration-200 ${isLoading ? 'opacity-75' : 'opacity-100'}`}>
                    <Outlet />
                </div>
                
                <ScrollRestoration />
                <Scripts />
                
                <style>{`
                    @keyframes loading {
                        0% { transform: translateX(-100%); }
                        50% { transform: translateX(0%); }
                        100% { transform: translateX(100%); }
                    }
                `}</style>
            </body>
        </html>
    );
}