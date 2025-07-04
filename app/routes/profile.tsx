import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, Form } from "@remix-run/react";
import { requireUser } from "~/utils/supabase-auth.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";

export async function loader({ request }: LoaderFunctionArgs) {
    // ログインが必要なページ
    const user = await requireUser(request);
    return json({ user });
}

export default function Profile() {
    const { user } = useLoaderData<typeof loader>();

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* メインコンテンツ */}
            <main className="flex-1 mx-auto max-w-7xl px-6 py-12 lg:px-8">
                <div className="mx-auto max-w-3xl">
                    <div className="bg-white shadow rounded-lg">
                        <div className="px-6 py-8">
                            <div className="flex items-center space-x-6">
                                {user.avatar ? (
                                    <img
                                        src={user.avatar}
                                        alt="プロフィール画像"
                                        className="w-24 h-24 rounded-full"
                                    />
                                ) : (
                                    <div className="w-24 h-24 rounded-full bg-indigo-600 flex items-center justify-center">
                                        <span className="text-4xl font-bold text-white">
                                            {user.username.charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                )}
                                
                                <div>
                                    <h1 className="text-3xl font-bold text-gray-900">
                                        {user.username}
                                    </h1>
                                    {user.discriminator && user.discriminator !== "0" && (
                                        <p className="text-gray-600">
                                            #{user.discriminator}
                                        </p>
                                    )}
                                    {user.email && (
                                        <p className="text-gray-600 mt-1">
                                            {user.email}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-gray-200">
                            <div className="px-6 py-6">
                                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                                    アカウント情報
                                </h2>
                                
                                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500">
                                            ユーザーID
                                        </dt>
                                        <dd className="mt-1 text-sm text-gray-900 font-mono">
                                            {user.id}
                                        </dd>
                                    </div>
                                    
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500">
                                            ユーザー名
                                        </dt>
                                        <dd className="mt-1 text-sm text-gray-900">
                                            {user.username}
                                        </dd>
                                    </div>
                                    
                                    {user.email && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">
                                                メールアドレス
                                            </dt>
                                            <dd className="mt-1 text-sm text-gray-900">
                                                {user.email}
                                            </dd>
                                        </div>
                                    )}
                                    
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500">
                                            認証プロバイダー
                                        </dt>
                                        <dd className="mt-1 text-sm text-gray-900">
                                            Supabase Auth (Discord)
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 px-6 py-6">
                            <div className="flex flex-col sm:flex-row gap-4">
                                <Link
                                    to="/"
                                    className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                                >
                                    ホームに戻る
                                </Link>
                                
                                <Form method="post" action="/logout">
                                    <button
                                        type="submit"
                                        className="inline-flex justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                                    >
                                        ログアウト
                                    </button>
                                </Form>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}