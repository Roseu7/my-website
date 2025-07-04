import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";

export async function loader({ request }: LoaderFunctionArgs) {
    const user = await getUserFromSession(request);
    return json({ user });
}

export default function NotFound() {
    const { user } = useLoaderData<typeof loader>();

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* 404コンテンツ */}
            <main className="relative flex-1">
                <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
                    <div className="mx-auto max-w-2xl text-center">
                        <div className="mb-8">
                            <div className="mx-auto w-32 h-32 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                                <svg 
                                    className="w-16 h-16 text-gray-400" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    viewBox="0 0 24 24"
                                >
                                    <path 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                        strokeWidth={1.5} 
                                        d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                                    />
                                </svg>
                            </div>
                            
                            <h1 className="text-6xl font-bold text-gray-900 mb-4">
                                404
                            </h1>
                            <h2 className="text-2xl font-semibold text-gray-700 mb-4">
                                ページが見つかりません
                            </h2>
                            <p className="text-lg text-gray-600 mb-8">
                                お探しのページは存在しないか、移動された可能性があります。
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Link
                                to="/"
                                className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
                            >
                                ホームに戻る
                            </Link>
                            <Link
                                to="/games"
                                className="rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600 transition-colors"
                            >
                                ゲームを見る
                            </Link>
                            <Link
                                to="/tools"
                                className="rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600 transition-colors"
                            >
                                ツールを見る
                            </Link>
                        </div>

                        {user && (
                            <div className="mt-8 p-4 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200">
                                <p className="text-sm text-gray-600">
                                    こんにちは、<span className="font-semibold text-indigo-600">{user.username}</span>さん！<br />
                                    何かお困りでしたら、ホームページからお探しのコンテンツを見つけてくださいね。
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* フッター */}
            <Footer />
        </div>
    );
}