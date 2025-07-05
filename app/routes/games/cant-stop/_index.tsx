import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { joinOrCreateRoom } from "~/libs/cant-stop/database.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { useState } from "react";
import { ROOM_ID_SETTINGS, ERROR_MESSAGES } from "~/utils/cant-stop/constants";

export async function loader({ request }: LoaderFunctionArgs) {
    const user = await getUserFromSession(request);
    
    // ログインが必須
    if (!user) {
        return redirect("/login");
    }
    
    return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
    const user = await getUserFromSession(request);
    if (!user) {
        return redirect("/login");
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

    // 成功した場合はロビー画面にリダイレクト
    return redirect(`/games/cant-stop/lobby/${result.data?.id}`);
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

            <main className="flex-1 flex items-center justify-center px-6 py-12">
                <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-8 w-full max-w-md">
                    {/* ゲームタイトル */}
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">
                            Can't Stop
                        </h1>
                        <p className="text-gray-600">
                            ルームIDを入力してゲームに参加
                        </p>
                    </div>

                    {/* ルームID入力フォーム */}
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
                                placeholder="例: game123"
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                                minLength={ROOM_ID_SETTINGS.MIN_LENGTH}
                                maxLength={ROOM_ID_SETTINGS.MAX_LENGTH}
                                pattern="[a-zA-Z0-9]+"
                                required
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                3-20文字の半角英数字で入力してください
                            </p>
                        </div>

                        {/* エラー表示 */}
                        {actionData?.error && (
                            <div className="bg-red-50 border border-red-200 rounded-md p-3">
                                <p className="text-sm text-red-600">
                                    {typeof actionData.error === 'string' 
                                        ? actionData.error 
                                        : 'エラーが発生しました'}
                                </p>
                            </div>
                        )}

                        {/* 送信ボタン */}
                        <button
                            type="submit"
                            disabled={isSubmitting || !roomId.trim()}
                            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSubmitting ? (
                                <span className="flex items-center justify-center">
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    参加中...
                                </span>
                            ) : (
                                'ルームに参加'
                            )}
                        </button>
                    </Form>

                    {/* ゲーム説明 */}
                    <div className="mt-8 pt-6 border-t border-gray-200">
                        <h3 className="text-sm font-medium text-gray-900 mb-2">
                            ゲームについて
                        </h3>
                        <ul className="text-xs text-gray-600 space-y-1">
                            <li>• 2-4人でプレイ可能</li>
                            <li>• 3つのコラムを完成させると勝利</li>
                            <li>• サイコロを振って進路を選択</li>
                            <li>• リスクを取るか安全策を取るかが鍵</li>
                        </ul>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}