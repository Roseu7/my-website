import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { createSupabaseServerClient } from "~/libs/supabase.server";

export const meta: MetaFunction = () => {
    return [
        { title: "Roseu's Site - 個人的な遊び場" },
        { name: "description", content: "ゲームとツールの個人サイト" },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "icon", type: "image/png", sizes: "192x192", href: "/android-chrome-192x192.png" },
        { rel: "shortcut icon", href: "/favicon.ico" },
    ];
};

export async function loader({ request }: LoaderFunctionArgs) {
    const supabase = createSupabaseServerClient(request);
    
    // Supabase接続テスト（本番では削除予定）
    const { error } = await supabase.from('test').select('*').limit(1);
    
    return { 
        supabaseConnected: !error,
    };
}

export default function Index() {
    const { supabaseConnected } = useLoaderData<typeof loader>();
    
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
            {/* Header */}
            <header className="relative">
                <nav className="mx-auto max-w-7xl px-6 lg:px-8" aria-label="Top">
                    <div className="flex w-full items-center justify-between border-b border-indigo-500 py-6 lg:border-none">
                        <div className="flex items-center">
                            <Link to="/" className="flex items-center space-x-3">
                                <div className="h-12 w-12 rounded-xl overflow-hidden bg-white border-2 border-gray-200 flex items-center justify-center relative group">
                                    <img 
                                        src="/cat-icon.png" 
                                        alt="Roseu's Site" 
                                        className="w-10 h-10 object-contain group-hover:opacity-0 transition-opacity duration-300"
                                    />
                                    <img 
                                        src="/cat-icon-wink.png" 
                                        alt="Roseu's Site" 
                                        className="w-10 h-10 object-contain absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                                    />
                                </div>
                                <span className="text-xl font-bold text-gray-900">Roseu's Site</span>
                            </Link>
                        </div>
                        <div className="ml-10 space-x-4 hidden md:block">
                            <Link 
                                to="/games" 
                                className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                            >
                                ゲーム
                            </Link>
                            <Link 
                                to="/tools" 
                                className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                            >
                                ツール
                            </Link>
                            <Link 
                                to="/login" 
                                className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                            >
                                ログイン
                            </Link>
                        </div>
                    </div>
                </nav>
            </header>

            {/* Hero Section */}
            <main className="relative">
                <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
                    <div className="mx-auto max-w-2xl text-center">
                        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">Roseu's Site</span>
                        </h1>
                        <p className="mt-6 text-lg leading-8 text-gray-600 max-w-lg mx-auto">
                            個人的な遊び場
                        </p>
                        <div className="mt-10 flex items-center justify-center gap-x-6">
                            <Link
                                to="/games"
                                className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-all hover:scale-105"
                            >
                                🎮 ゲーム
                            </Link>
                            <Link 
                                to="/tools" 
                                className="rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 transition-all hover:scale-105"
                            >
                                🛠️ ツール
                            </Link>
                        </div>
                    </div>

                    {/* Status Indicator (開発中のみ表示) */}
                    {process.env.NODE_ENV === 'development' && (
                        <div className="mx-auto mt-16 max-w-md">
                            <div className="rounded-xl bg-white p-6 shadow-lg border border-gray-200">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">開発状況</h3>
                                <div className="flex items-center space-x-3">
                                    <div className={`h-3 w-3 rounded-full ${supabaseConnected ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                                    <span className="text-sm text-gray-600">
                                        Supabase: {supabaseConnected ? '接続中' : '設定中'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="mx-auto max-w-7xl px-6 py-12 md:flex md:items-center md:justify-between lg:px-8">
                <div className="mt-8 md:order-1 md:mt-0">
                    <p className="text-center text-xs leading-5 text-gray-500">
                        &copy; 2025 Roseu
                    </p>
                </div>
            </footer>
        </div>
    );
}