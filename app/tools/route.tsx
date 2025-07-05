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

export default function Tools() {
    const { user } = useLoaderData<typeof loader>();

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* メインコンテンツ */}
            <main className="flex-1 mx-auto max-w-7xl px-6 py-12 lg:px-8">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">
                        ツール
                    </h1>
                    <p className="text-lg text-gray-600">
                        便利なツールを準備中です
                    </p>
                </div>

                {/* まだない表示 */}
                <div className="text-center">
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-12 max-w-2xl mx-auto">
                        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                            <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                            ツールはまだありません
                        </h2>
                        <p className="text-gray-600 mb-6">
                            現在便利なツールを開発中です。<br />
                            近日中に役立つツールを追加予定です！
                        </p>
                        <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                            <span>開発中...</span>
                        </div>
                    </div>
                </div>
            </main>

            {/* フッター */}
            <Footer />
        </div>
    );
}