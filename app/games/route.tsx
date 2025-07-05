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
                        <div key={game.id} className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg overflow-hidden border border-white/20 hover:shadow-xl transition-all duration-300">
                            <div className={`h-32 bg-gradient-to-r ${game.color} flex items-center justify-center`}>
                                <h3 className="text-2xl font-bold text-white">{game.title}</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-gray-600 mb-4">{game.description}</p>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                                        {game.difficulty}
                                    </span>
                                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                                        {game.players}
                                    </span>
                                    <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded">
                                        {game.time}
                                    </span>
                                </div>
                                <Link
                                    to={`/games/${game.id}`}
                                    className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors space-x-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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