import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { useState, useEffect } from "react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { 
    getRoomData, 
    leaveRoom, 
    kickPlayer, 
    toggleReady, 
    startGame 
} from "~/libs/cant-stop/database.server";
import { createRealtimeClient, formatUserFromAuth } from "~/libs/cant-stop/realtime.client";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { ConnectionStatus } from "~/components/cant-stop/ConnectionStatus";
import type { LobbyState, RoomParticipant, User } from "~/libs/cant-stop/types";
import { getPlayerColor } from "~/utils/cant-stop/constants";

export async function loader({ request, params }: LoaderFunctionArgs) {
    const user = await getUserFromSession(request);
    if (!user) {
        return redirect("/login");
    }

    const roomId = params.roomId;
    if (!roomId) {
        return redirect("/games/cant-stop");
    }

    // ルーム情報を取得
    const result = await getRoomData(request, roomId);
    if (!result.success) {
        return redirect("/games/cant-stop");
    }

    const { room, participants, winStats } = result.data;

    // 現在のユーザーが参加者にいるかチェック
    const isParticipant = participants.some(p => p.user_id === user.id);
    if (!isParticipant) {
        return redirect("/games/cant-stop");
    }

    // ゲーム中の場合はゲーム画面にリダイレクト
    if (room.status === 'playing') {
        return redirect(`/games/cant-stop/game/${roomId}`);
    }

    const isHost = room.host_user_id === user.id;

    return json({
        user,
        room,
        participants,
        winStats,
        isHost
    });
}

export async function action({ request, params }: ActionFunctionArgs) {
    const user = await getUserFromSession(request);
    if (!user) {
        return redirect("/login");
    }

    const roomId = params.roomId;
    if (!roomId) {
        return redirect("/games/cant-stop");
    }

    const formData = await request.formData();
    const action = formData.get("_action");

    switch (action) {
        case "leave":
            const leaveResult = await leaveRoom(request, roomId, user.id);
            if (leaveResult.success) {
                return redirect("/games/cant-stop");
            }
            return json({ error: "退出に失敗しました" });

        case "kick": {
            const targetUserId = formData.get("targetUserId")?.toString();
            if (!targetUserId) return json({ error: "対象ユーザーが不正です" });
            
            const kickResult = await kickPlayer(request, roomId, user.id, targetUserId);
            if (!kickResult.success) {
                return json({ error: "キックに失敗しました" });
            }
            return json({ success: true });
        }

        case "toggle_ready": {
            const readyResult = await toggleReady(request, roomId, user.id);
            if (!readyResult.success) {
                return json({ error: "準備状態の変更に失敗しました" });
            }
            return json({ success: true });
        }

        case "start_game": {
            const startResult = await startGame(request, roomId, user.id);
            if (!startResult.success) {
                return json({ error: startResult.error });
            }
            return redirect(`/games/cant-stop/game/${roomId}`);
        }

        default:
            return json({ error: "不正なアクションです" });
    }
}

export default function CantStopLobby() {
    const { user, room: initialRoom, participants: initialParticipants, winStats: initialWinStats, isHost: initialIsHost } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    // リアルタイム更新用の状態
    const [room, setRoom] = useState(initialRoom);
    const [participants, setParticipants] = useState(initialParticipants);
    const [winStats, setWinStats] = useState(initialWinStats);
    const [isHost, setIsHost] = useState(initialIsHost);
    const [showSettings, setShowSettings] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [kickConfirmPlayer, setKickConfirmPlayer] = useState<string | null>(null);
    const [connectionState, setConnectionState] = useState({
        room: 'disconnected' as const,
        game: 'disconnected' as const
    });
    const [realtimeClient, setRealtimeClient] = useState<any>(null);

    // 現在のユーザーの準備状態
    const currentParticipant = participants.find(p => p.user_id === user.id);
    const isReady = currentParticipant?.is_ready || false;

    // リアルタイム通信の設定
    useEffect(() => {
        const client = createRealtimeClient(room.id);
        setRealtimeClient(client);

        // ルーム情報の変更を監視
        client.subscribeToRoom({
            onParticipantChanged: (updatedParticipants) => {
                const formattedParticipants = updatedParticipants.map(p => ({
                    ...p,
                    user: formatUserFromAuth(p.user)
                }));
                setParticipants(formattedParticipants);
            },
            onRoomStatusChanged: (updatedRoom) => {
                setRoom(updatedRoom);
                setIsHost(updatedRoom.host_user_id === user.id);
                
                // ゲーム開始時はゲーム画面に遷移
                if (updatedRoom.status === 'playing') {
                    window.location.href = `/games/cant-stop/game/${room.id}`;
                }
            },
            onWinStatsChanged: (updatedWinStats) => {
                setWinStats(updatedWinStats);
            },
            onConnectionStateChanged: (state) => {
                setConnectionState(state);
            }
        });

        return () => {
            client.cleanup();
        };
    }, [room.id, user.id]);

    // 手動再接続
    const handleReconnect = () => {
        if (realtimeClient) {
            realtimeClient.forceReconnect();
        }
    };

    // ゲーム開始の条件チェック
    const canStartGame = () => {
        return isHost && 
               participants.length >= 2 && 
               participants.every(p => p.is_ready);
    };

    // プレイヤーカラーを取得
    const getParticipantColor = (participantIndex: number) => {
        return getPlayerColor(participantIndex);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            <main className="flex-1 mx-auto max-w-4xl px-6 py-8 lg:px-8">
                {/* ヘッダー情報 */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Can't Stop
                    </h1>
                    <div className="flex items-center justify-center space-x-4 text-lg">
                        <span className="text-gray-600">ルームID:</span>
                        <span className="font-mono bg-gray-100 px-3 py-1 rounded text-indigo-600 font-semibold">
                            {room.room_id}
                        </span>
                        <button
                            onClick={() => navigator.clipboard.writeText(room.room_id)}
                            className="text-indigo-600 hover:text-indigo-800 transition-colors"
                            title="ルームIDをコピー"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* エラーメッセージ */}
                {actionData?.error && (
                    <div className="mb-4 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700 text-center">
                        {actionData.error}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* 参加者一覧 */}
                    <div className="lg:col-span-2">
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-semibold text-gray-900">
                                    参加者 ({participants.length}/{room.max_players})
                                </h2>
                                <div className="text-sm text-gray-500">
                                    準備完了: {participants.filter(p => p.is_ready).length}/{participants.length}
                                </div>
                            </div>

                            <div className="space-y-4">
                                {participants.map((participant, index) => (
                                    <div
                                        key={participant.id}
                                        className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border"
                                    >
                                        <div className="flex items-center space-x-3">
                                            {/* プレイヤーカラー */}
                                            <div className={`w-4 h-4 rounded-full ${getParticipantColor(index)}`}></div>
                                            
                                            {/* アバター */}
                                            {participant.user?.avatar ? (
                                                <img 
                                                    src={participant.user.avatar} 
                                                    alt={participant.user.username}
                                                    className="w-10 h-10 rounded-full border-2 border-gray-200"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                                                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                </div>
                                            )}

                                            {/* ユーザー名とバッジ */}
                                            <div className="flex items-center space-x-2">
                                                <span className="font-medium text-gray-900">
                                                    {participant.user?.username || 'Unknown User'}
                                                </span>
                                                </span>
                                                
                                                {/* ホストバッジ */}
                                                {participant.user_id === room.host_user_id && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                                                        </svg>
                                                        ホスト
                                                    </span>
                                                )}
                                                
                                                {/* 準備状態バッジ */}
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    participant.is_ready 
                                                        ? 'bg-green-100 text-green-800' 
                                                        : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {participant.is_ready ? '準備完了' : '待機中'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* キックボタン（ホストのみ、自分以外） */}
                                        {isHost && participant.user_id !== user.id && (
                                            <button
                                                onClick={() => setKickConfirmPlayer(participant.user_id)}
                                                className="text-red-600 hover:text-red-800 transition-colors p-1"
                                                title="プレイヤーをキック"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                ))}

                                {/* 空きスロット表示 */}
                                {Array.from({ length: room.max_players - participants.length }).map((_, index) => (
                                    <div
                                        key={`empty-${index}`}
                                        className="flex items-center p-4 bg-gray-100 rounded-lg border border-dashed border-gray-300"
                                    >
                                        <div className="flex items-center space-x-3 text-gray-500">
                                            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                                </svg>
                                            </div>
                                            <span>プレイヤー待ち...</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* コントロールパネル */}
                    <div className="space-y-6 min-w-0 flex-shrink-0">
                        {/* 準備状態切り替え */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <Form method="post">
                                <input type="hidden" name="_action" value="toggle_ready" />
                                <button
                                    type="submit"
                                    disabled={navigation.state === "submitting"}
                                    className={`group w-full h-12 px-4 rounded-lg font-medium transition-all duration-200 relative flex items-center justify-center ${
                                        isReady
                                            ? 'bg-green-600 hover:bg-red-600 text-white'
                                            : 'bg-gray-200 hover:bg-green-600 text-gray-700 hover:text-white'
                                    }`}
                                >
                                    <span className={`transition-opacity duration-200 ${isReady ? 'group-hover:opacity-0' : ''}`}>
                                        {isReady ? '準備完了' : '準備する'}
                                    </span>
                                    {isReady && (
                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                            準備を取り消す
                                        </span>
                                    )}
                                </button>
                            </Form>
                        </div>

                        {/* ゲーム開始（ホストのみ） */}
                        {isHost && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                                <Form method="post">
                                    <input type="hidden" name="_action" value="start_game" />
                                    <button
                                        type="submit"
                                        disabled={!canStartGame() || navigation.state === "submitting"}
                                        className={`w-full h-12 px-4 rounded-lg font-medium transition-colors flex items-center justify-center ${
                                            canStartGame() && navigation.state !== "submitting"
                                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        }`}
                                    >
                                        <svg className="w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m-9-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div className="flex flex-col items-center">
                                            <span>スタート</span>
                                            {!canStartGame() && (
                                                <span className="text-[10px] leading-none mt-0.5">
                                                    全員の準備完了が必要
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                </Form>
                            </div>
                        )}

                        {/* ルーム設定（ホストのみ） */}
                        {isHost && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                                <button
                                    onClick={() => console.log("ルーム設定")}
                                    className="w-full h-10 px-4 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors flex items-center justify-center"
                                >
                                    ルーム設定
                                </button>
                            </div>
                        )}

                        {/* 個人設定 */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className="w-full h-10 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center justify-center"
                            >
                                個人設定
                            </button>
                        </div>

                        {/* 退出ボタン */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <button
                                onClick={() => setShowExitConfirm(true)}
                                className="w-full h-10 px-4 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors flex items-center justify-center"
                            >
                                ルーム退出
                            </button>
                        </div>
                    </div>
                </div>
            </main>

            {/* 個人設定モーダル */}
            {showSettings && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md mx-4 w-full">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-medium text-gray-900">
                                個人設定
                            </h3>
                            <button
                                onClick={() => setShowSettings(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    サウンド設定
                                </label>
                                <div className="flex items-center space-x-2">
                                    <input type="checkbox" id="sound" className="rounded" defaultChecked />
                                    <label htmlFor="sound" className="text-sm text-gray-600">効果音を有効にする</label>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    通知設定
                                </label>
                                <div className="flex items-center space-x-2">
                                    <input type="checkbox" id="notifications" className="rounded" defaultChecked />
                                    <label htmlFor="notifications" className="text-sm text-gray-600">ターン通知を有効にする</label>
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setShowSettings(false)}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* キック確認モーダル */}
            {kickConfirmPlayer && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md mx-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">
                            プレイヤーをキック
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {participants.find(p => p.user_id === kickConfirmPlayer)?.user?.username || 'このユーザー'} をルームからキックしますか？
                        </p>
                        <div className="flex space-x-4">
                            <button
                                onClick={() => setKickConfirmPlayer(null)}
                                className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
                            >
                                キャンセル
                            </button>
                            <Form method="post" className="flex-1">
                                <input type="hidden" name="_action" value="kick" />
                                <input type="hidden" name="targetUserId" value={kickConfirmPlayer} />
                                <button
                                    type="submit"
                                    onClick={() => setKickConfirmPlayer(null)}
                                    className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                                >
                                    キックする
                                </button>
                            </Form>
                        </div>
                    </div>
                </div>
            )}

            {/* 退出確認モーダル */}
            {showExitConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md mx-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">
                            ルーム退出の確認
                        </h3>
                        <p className="text-gray-600 mb-6">
                            本当にルームを退出しますか？
                            {isHost && (
                                <span className="block mt-2 text-orange-600 font-medium">
                                    あなたはホストです。退出すると他の参加者にホスト権限が移譲されます。
                                </span>
                            )}
                        </p>
                        <div className="flex space-x-4">
                            <button
                                onClick={() => setShowExitConfirm(false)}
                                className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
                            >
                                キャンセル
                            </button>
                            <Form method="post" className="flex-1">
                                <input type="hidden" name="_action" value="leave" />
                                <button
                                    type="submit"
                                    className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                                >
                                    退出する
                                </button>
                            </Form>
                        </div>
                    </div>
                </div>
            )}

            <Footer />

            {/* 接続状態表示 */}
            <ConnectionStatus 
                connectionState={connectionState}
                onReconnect={handleReconnect}
            />
        </div>
    );
}