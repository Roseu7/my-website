import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";

export async function loader({ request }: LoaderFunctionArgs) {
    // このページではログインは必須ではないが、ログイン状態を確認
    const user = await getUserFromSession(request);
    return json({ user });
}

export default function Games() {
    const { user } = useLoaderData<typeof loader>();

    const games = [
        {
            id: 'cant-stop',
            title: "Can't Stop",
            description: "4つのサイコロを使ったリスクマネジメントゲーム。3つのコラムを完成させて勝利を目指そう！",
            difficulty: "中級",
            players: "2-4人",
            time: "10-20分",
            color: "from-blue-500 to-indigo-600"
        }
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* メインコンテンツ */}
            <main className="flex-1 mx-auto max-w-7xl px-6 py-12 lg:px-8">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">
                        ゲーム
                    </h1>
                    <p className="text-lg text-gray-600">
                        楽しいゲームで遊んでみましょう！
                    </p>
                </div>

                {/* ゲーム一覧 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {games.map((game) => (
                        <div
                            key={game.id}
                            className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105"
                        >
                            {/* ゲームヘッダー */}
                            <div className={`bg-gradient-to-r ${game.color} p-6 text-white`}>
                                <h3 className="text-2xl font-bold mb-2">{game.title}</h3>
                                <div className="flex items-center space-x-4 text-sm opacity-90">
                                    <span className="flex items-center space-x-1">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                        <span>{game.players}</span>
                                    </span>
                                    <span className="flex items-center space-x-1">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>{game.time}</span>
                                    </span>
                                </div>
                            </div>

                            {/* ゲーム詳細 */}
                            <div className="p-6">
                                <p className="text-gray-600 mb-4 leading-relaxed">
                                    {game.description}
                                </p>
                                
                                <div className="flex items-center justify-between mb-6">
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                                        難易度: {game.difficulty}
                                    </span>
                                </div>

                                <Link
                                    to={`/games/${game.id}`}
                                    className={`w-full inline-flex items-center justify-center px-6 py-3 bg-gradient-to-r ${game.color} text-white font-semibold rounded-lg hover:shadow-md transition-all duration-200 hover:scale-105`}
                                >
                                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m-9-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    プレイする
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>

                {/* 今後追加予定 */}
                <div className="mt-16 text-center">
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-12 max-w-2xl mx-auto">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">
                            さらなるゲームを追加予定
                        </h2>
                        <p className="text-gray-600">
                            今後も楽しいゲームを追加していく予定です。<br />
                            ぜひまたお立ち寄りください！
                        </p>
                    </div>
                </div>
            </main>

            {/* フッター */}
            <Footer />
        </div>
    );
}