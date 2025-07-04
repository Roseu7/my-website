import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { createSupabaseServerClient } from "~/libs/supabase.server";

export const meta: MetaFunction = () => {
    return [
        { title: "My Website - Remix + Supabase" },
        { name: "description", content: "モダンなWebアプリケーション" },
    ];
};

export async function loader({ request }: LoaderFunctionArgs) {
    const supabase = createSupabaseServerClient(request);

    // Supabase接続テスト
    const { data, error } = await supabase.from('test').select('*').limit(1);

    return {
        supabaseConnected: !error,
        message: error ? error.message : "Supabase connected successfully!" 
    };
}

export default function Index() {
    const { supabaseConnected, message } = useLoaderData<typeof loader>();

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
            <div className="container mx-auto px-4 py-16">
                <div className="text-center">
                    <h1 className="text-5xl font-bold text-gray-900 mb-6">
                        Welcome to
                        <span className="block text-blue-600"> My Website</span>
                    </h1>

                    <p className="text-xl text-gray-600 mb-8">
                        Remix + Supabase + Fly.io で構築
                    </p>

                    {/* Supabase接続状況 */}
                    <div className="bg-white p-6 rounded-lg shadow-md max-w-md mx-auto">
                        <h2 className="text-lg font-semibold mb-4">接続状況</h2>
                        <div className={`p-3 rounded ${supabaseConnected ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            <p className="font-medium">
                                {supabaseConnected ? '✅ Supabase' : '⚠️ Supabase'}: {message}
                            </p>
                        </div>
                    </div>

                    <div className="mt-8 space-x-4">
                        <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
                            🎮 ゲーム
                        </button>
                        <button className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors">
                            🛠️ ツール
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}