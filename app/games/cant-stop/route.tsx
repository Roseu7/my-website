import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation, Link } from "@remix-run/react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { joinOrCreateRoom } from "~/games/cant-stop/utils/database.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { useState } from "react";
import { ROOM_ID_SETTINGS, ERROR_MESSAGES } from "~/games/cant-stop/utils/constants";

export async function loader({ request }: LoaderFunctionArgs) {
    const user = await getUserFromSession(request);
    
    // ログインが必須の場合、現在のURLを認証後のリダイレクト先として設定
    if (!user) {
        const currentUrl = new URL(request.url);
        const redirectTo = `${currentUrl.pathname}${currentUrl.search}`;
        return redirect(`/auth/discord?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    
    return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
    const user = await getUserFromSession(request);
    if (!user) {
        const currentUrl = new URL(request.url);
        const redirectTo = `${currentUrl.pathname}${currentUrl.search}`;
        return redirect(`/auth/discord?redirectTo=${encodeURIComponent(redirectTo)}`);
    }

    const formData = await request.formData();
    const roomId = formData.get("roomId")?.toString();

    if (!roomId) {
        return json({ error: ERROR_MESSAGES.ROOM_ID_REQUIRED }, { status: 400 });
    }

    // バリデーション
    if (!ROOM_ID_SETTINGS.ALLOWED_PATTERN.test(roomId)) {
        return json({ error: ERROR_MESSAGES.ROOM_ID_INVALID_CHARS }, { status: 400 });
    }

    if (roomId.length < ROOM_ID_SETTINGS.MIN_LENGTH || roomId.length > ROOM_ID_SETTINGS.MAX_LENGTH) {
        return json({ error: ERROR_MESSAGES.ROOM_ID_INVALID_LENGTH }, { status: 400 });
    }

    // ルーム参加処理
    const result = await joinOrCreateRoom(request, roomId, user.id);
    
    if (!result.success) {
        return json({ error: result.error || ERROR_MESSAGES.JOIN_FAILED }, { status: 400 });
    }

    // 成功した場合はロビー画面にリダイレクト（room_idを使用）
    return redirect(`/games/cant-stop/lobby/${result.data?.room_id || roomId}`);
}

export default function CantStop() {
    const { user } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const [roomId, setRoomId] = useState("");

    const isSubmitting = navigation.state === "submitting";

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* メインコンテンツ */}
            <main className="flex-1 mx-auto max-w-4xl px-6 py-12 lg:px-8">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">
                        Can't Stop
                    </h1>
                    <p className="text-lg text-gray-600 mb-8">
                        4つのサイコロを使ったリスクマネジメントゲーム
                    </p>
                </div>

                {/* ゲーム説明カード */}
                <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                        ゲームの概要
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                        <div className="text-center">
                            <div className="bg-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3">
                                <span className="text-2xl">🎲</span>
                            </div>
                            <h3 className="font-semibold text-gray-900 mb-2">サイコロを振る</h3>
                            <p className="text-sm text-gray-600">4つのサイコロを振って組み合わせを選択</p>
                        </div>
                        <div className="text-center">
                            <div className="bg-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3">
                                <span className="text-2xl">📊</span>
                            </div>
                            <h3 className="font-semibold text-gray-900 mb-2">コラムを登る</h3>
                            <p className="text-sm text-gray-600">コマを進めてコラムの頂上を目指す</p>
                        </div>
                        <div className="text-center">
                            <div className="bg-yellow-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3">
                                <span className="text-2xl">🏆</span>
                            </div>
                            <h3 className="font-semibold text-gray-900 mb-2">3つ完成で勝利</h3>
                            <p className="text-sm text-gray-600">3つのコラムを完成させると勝利</p>
                        </div>
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4">
                        <h4 className="font-semibold text-gray-900 mb-2">ルール</h4>
                        <ul className="text-sm text-gray-600 space-y-1">
                            <li>• 2-4人で遊べます</li>
                            <li>• ターンごとにサイコロを振り、進む or 止めるを選択</li>
                            <li>• 止めるまでサイコロを振り続けられますが、進めなくなるとバスト</li>
                            <li>• バストすると、そのターンの進行がすべてリセット</li>
                        </ul>
                    </div>
                </div>

                {/* ルーム参加フォーム */}
                <div className="bg-white rounded-lg shadow-lg p-8">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
                        ルームに参加
                    </h2>
                    
                    {actionData?.error && (
                        <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-3">
                            <p className="text-sm text-red-600">
                                {typeof actionData.error === 'string' ? actionData.error : 'エラーが発生しました'}
                            </p>
                        </div>
                    )}

                    <Form method="post" className="space-y-6">
                        <div>
                            <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 mb-2">
                                ルームID
                            </label>
                            <input
                                type="text"
                                id="roomId"
                                name="roomId"
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                                placeholder="例: game123"
                                disabled={isSubmitting}
                                required
                            />
                            <p className="mt-2 text-sm text-gray-500">
                                3-20文字の英数字で入力してください。存在しない場合は新しいルームが作成されます。
                            </p>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !roomId.trim()}
                            className="w-full bg-blue-600 text-white py-3 px-6 rounded-md font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSubmitting ? '参加中...' : 'ルームに参加'}
                        </button>
                    </Form>

                    <div className="mt-8 text-center">
                        <Link 
                            to="/games" 
                            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                        >
                            ← ゲーム一覧に戻る
                        </Link>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}