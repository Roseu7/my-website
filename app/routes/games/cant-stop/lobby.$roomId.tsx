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
import { PlayerList, ConnectionStatus } from "~/components/cant-stop";
import type { LobbyState, RoomParticipant, User, GameRoom, RoomWins } from "~/libs/cant-stop/types";
import { getPlayerColor } from "~/utils/cant-stop/constants";

// 接続状態の型定義
interface ConnectionState {
    room: "connected" | "disconnected" | "error" | "connecting";
    game: "connected" | "disconnected" | "error" | "connecting";
}

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
    if (!result.success || !result.data) {
        return redirect("/games/cant-stop");
    }

    const { room, participants, winStats } = result.data;

    // 現在のユーザーが参加者にいるかチェック
    const isParticipant = participants.some((p: RoomParticipant & { user: User | null }) => p.user_id === user.id);
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
    const [room, setRoom] = useState<GameRoom>(initialRoom);
    const [participants, setParticipants] = useState<(RoomParticipant & { user: User | null })[]>(initialParticipants);
    const [winStats, setWinStats] = useState<RoomWins[]>(initialWinStats);
    const [isHost, setIsHost] = useState<boolean>(initialIsHost);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionState>({
        room: "connected",
        game: "connected"
    });

    const isSubmitting = navigation.state === "submitting";

    // リアルタイム通信の設定
    useEffect(() => {
        const realtimeClient = createRealtimeClient(room.id);

        // ルーム情報の変更を監視
        realtimeClient.subscribeToRoom({
            onParticipantChanged: (updatedParticipants: any[]) => {
                setParticipants(updatedParticipants);
            },
            onRoomStatusChanged: (updatedRoom: any) => {
                setRoom(updatedRoom);
                setIsHost(updatedRoom.host_user_id === user.id);
                
                // ゲーム開始時はゲーム画面に遷移
                if (updatedRoom.status === 'playing') {
                    window.location.href = `/games/cant-stop/game/${room.id}`;
                }
            },
            onWinStatsChanged: (updatedWinStats: any[]) => {
                setWinStats(updatedWinStats);
            },
            onConnectionStateChanged: (state: any) => {
                setConnectionStatus(state);
            }
        });

        return () => {
            realtimeClient.cleanup();
        };
    }, [room.id, user.id]);

    // 手動再接続
    const handleReconnect = () => {
        if (typeof window !== 'undefined') {
            window.location.reload();
        }
    };

    // プレイヤー情報を構築（PlayerListコンポーネント用）
    const players = participants.map((participant, index) => {
        const userData = formatUserFromAuth(participant.user);
        return {
            id: participant.user_id,
            username: userData?.username || 'Unknown User',
            avatar: userData?.avatar,
            color: getPlayerColor(index),
            isCurrentTurn: false,
            isReady: participant.is_ready,
            isHost: participant.user_id === room.host_user_id
        };
    });

    // エラーメッセージの取得
    const getErrorMessage = (): string | null => {
        if (actionData && 'error' in actionData && typeof actionData.error === 'string') {
            return actionData.error;
        }
        return null;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            <main className="flex-1 mx-auto max-w-4xl px-6 py-8 lg:px-8">
                {/* ヘッダー情報 */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Can't Stop - ロビー
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
                {getErrorMessage() && (
                    <div className="mb-4 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700 text-center">
                        {getErrorMessage()}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* プレイヤーリスト（メインエリア） */}
                    <div className="lg:col-span-2">
                        <PlayerList
                            players={players}
                            currentUserId={user.id}
                            isHost={isHost}
                            showActions={true}
                            winStats={winStats}
                            isSubmitting={isSubmitting}
                            mode="lobby"
                        />
                    </div>

                    {/* サイドバー */}
                    <div className="space-y-6">
                        {/* 勝利統計 */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">勝利統計</h3>
                            {winStats.length > 0 ? (
                                <div className="space-y-2">
                                    {winStats
                                        .sort((a, b) => b.wins_count - a.wins_count)
                                        .map((stat) => {
                                            const participant = participants.find((p: RoomParticipant & { user: User | null }) => p.user_id === stat.user_id);
                                            const userData = formatUserFromAuth(participant?.user);
                                            return (
                                                <div key={stat.user_id} className="flex items-center justify-between">
                                                    <span className="text-sm text-gray-600">
                                                        {userData?.username || 'Unknown User'}
                                                    </span>
                                                    <span className="font-medium text-gray-900">
                                                        {stat.wins_count}勝
                                                    </span>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">まだゲームが行われていません</p>
                            )}
                        </div>

                        {/* ゲームルール */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">ゲームルール</h3>
                            <ul className="space-y-2 text-sm text-gray-600">
                                <li className="flex items-start space-x-2">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    <span>2-4人でプレイ</span>
                                </li>
                                <li className="flex items-start space-x-2">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    <span>3つのコラムを完成させると勝利</span>
                                </li>
                                <li className="flex items-start space-x-2">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    <span>サイコロを振って進路を選択</span>
                                </li>
                                <li className="flex items-start space-x-2">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    <span>リスクを取るか安全策を取るかが鍵</span>
                                </li>
                                <li className="flex items-start space-x-2">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    <span>バストすると一時的な進行がリセット</span>
                                </li>
                            </ul>
                        </div>

                        {/* 退出ボタン */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <Form method="post">
                                <input type="hidden" name="_action" value="leave" />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
                                    onClick={(e) => {
                                        if (!confirm('ルームから退出しますか？')) {
                                            e.preventDefault();
                                        }
                                    }}
                                >
                                    ルームから退出
                                </button>
                            </Form>
                        </div>

                        {/* 接続状態 */}
                        <ConnectionStatus 
                            connectionState={connectionStatus}
                            onReconnect={handleReconnect}
                        />
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}