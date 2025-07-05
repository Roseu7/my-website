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
    return redirect(`/games/cant-stop/lobby/${result.data.id}`);
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
                                placeholder="ルームIDを入力..."
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg text-center"
                                disabled={isSubmitting}
                                autoFocus
                                required
                            />
                        </div>

                        {/* エラーメッセージ */}
                        {actionData?.error && (
                            <div className="text-red-600 text-sm text-center">
                                {actionData.error}
                            </div>
                        )}

                        {/* 参加ボタン */}
                        <button
                            type="submit"
                            disabled={isSubmitting || !roomId.trim()}
                            className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center"
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    参加中...
                                </>
                            ) : (
                                "ルームに参加"
                            )}
                        </button>
                    </Form>

                    {/* 使用方法の説明 */}
                    <div className="mt-8 p-4 bg-blue-50 rounded-lg">
                        <h3 className="text-sm font-medium text-blue-900 mb-2">使用方法</h3>
                        <ul className="text-xs text-blue-800 space-y-1">
                            <li>• 友達と同じルームIDを入力してゲームに参加</li>
                            <li>• ルームIDは半角英数字のみ（大文字小文字区別なし）</li>
                            <li>• {ROOM_ID_SETTINGS.MIN_LENGTH}文字以上{ROOM_ID_SETTINGS.MAX_LENGTH}文字以下で入力</li>
                            <li>• 最初に入った人がホストになります</li>
                            <li>• 2-4人でプレイできます</li>
                        </ul>
                    </div>

                    {/* ユーザー情報表示 */}
                    <div className="mt-6 pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-center space-x-3">
                            {user.avatar ? (
                                <img 
                                    src={user.avatar} 
                                    alt={user.username}
                                    className="w-8 h-8 rounded-full border-2 border-gray-200"
                                />
                            ) : (
                                <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                </div>
                            )}
                            <p className="text-sm text-gray-600">
                                {user.username} としてログイン中
                            </p>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}