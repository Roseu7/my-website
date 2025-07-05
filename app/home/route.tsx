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

export default function Index() {
    const { user } = useLoaderData<typeof loader>();

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* メインコンテンツ */}
            <main className="relative flex-1">
                <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
                    <div className="mx-auto max-w-2xl text-center">
                        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
                                Roseu's Site
                            </span>
                        </h1>
                        <p className="mt-6 text-lg leading-8 text-gray-600 max-w-lg mx-auto">
                            個人的な遊び場
                        </p>
                        
                        <div className="mt-10 flex items-center justify-center gap-x-6">
                            <Link
                                to="/games"
                                className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
                            >
                                ゲームを見る
                            </Link>
                            <Link
                                to="/tools"
                                className="text-sm font-semibold leading-6 text-gray-900 hover:text-indigo-600 transition-colors"
                            >
                                ツールを見る <span aria-hidden="true">→</span>
                            </Link>
                        </div>

                        {user && (
                            <div className="mt-8 p-6 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200">
                                <div className="flex items-center justify-center space-x-3 mb-2">
                                    {user.avatar ? (
                                        <img
                                            src={user.avatar}
                                            alt="アバター"
                                            className="w-10 h-10 rounded-full"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center">
                                            <span className="text-white font-bold">
                                                {user.username.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    )}
                                    <p className="text-gray-600">
                                        こんにちは、<span className="font-semibold text-indigo-600">{user.username}</span>さん！
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}