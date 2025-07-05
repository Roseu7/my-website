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
} from "~/games/cant-stop/utils/database.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { PlayerList, ConnectionStatus } from "~/games/cant-stop/components";
import type { LobbyState, RoomParticipant, User, GameRoom, RoomWins } from "~/games/cant-stop/utils/types";
import { getPlayerColor } from "~/games/cant-stop/utils/constants";

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

    // サーバーサイドでプレイヤー情報を整形（インライン関数）
    const formatUserFromAuth = (authUser: User | any): { id: string; username: string; avatar?: string } | null => {
        if (!authUser) return null;
        
        // 既にUser型の場合はそのまま使用
        if (authUser.username) {
            return {
                id: authUser.id,
                username: authUser.username,
                avatar: authUser.avatar
            };
        }
        
        // Supabaseのユーザーオブジェクトの場合
        const metadata = authUser.user_metadata || authUser.raw_user_meta_data || {};
        const customClaims = metadata.custom_claims || {};
        
        return {
            id: authUser.id,
            username: customClaims.global_name || metadata.full_name || metadata.name || metadata.display_name || "User",
            avatar: metadata.avatar_url || metadata.picture
        };
    };

    const formattedParticipants = participants.map((participant: RoomParticipant & { user: User | null }) => {
        const userData = formatUserFromAuth(participant.user);
        return {
            ...participant,
            formattedUser: userData
        };
    });

    // 勝利統計も整形
    const formattedWinStats = winStats.map((stat: RoomWins) => {
        const participant = participants.find((p: RoomParticipant & { user: User | null }) => p.user_id === stat.user_id);
        const userData = formatUserFromAuth(participant?.user);
        return {
            ...stat,
            formattedUser: userData
        };
    });

    const isHost = room.host_user_id === user.id;

    return json({
        user,
        room,
        participants: formattedParticipants,
        winStats: formattedWinStats,
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
        case "leave_room": {
            const result = await leaveRoom(request, roomId, user.id);
            if (!result.success) {
                return json({ error: result.error });
            }
            return redirect("/games/cant-stop");
        }

        case "kick_player": {
            const targetUserId = formData.get("targetUserId")?.toString();
            if (!targetUserId) {
                return json({ error: "キック対象のユーザーが指定されていません" });
            }

            const result = await kickPlayer(request, roomId, user.id, targetUserId);
            if (!result.success) {
                return json({ error: result.error });
            }
            return json({ success: true });
        }

        case "toggle_ready": {
            const result = await toggleReady(request, roomId, user.id);
            if (!result.success) {
                return json({ error: result.error });
            }
            return json({ success: true });
        }

        case "start_game": {
            const result = await startGame(request, roomId, user.id);
            if (!result.success) {
                return json({ error: result.error });
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

    // 簡略化した状態管理（リアルタイム機能を一時的に無効化）
    const [room, setRoom] = useState<GameRoom>(initialRoom);
    const [participants, setParticipants] = useState(initialParticipants);
    const [winStats, setWinStats] = useState(initialWinStats);
    const [isHost, setIsHost] = useState<boolean>(initialIsHost);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionState>({
        room: "connected",
        game: "connected"
    });

    const isSubmitting = navigation.state === "submitting";

    // リアルタイム機能を一時的に無効化（テスト用）
    // TODO: 後でリアルタイム機能を再実装
    useEffect(() => {
        console.log('ロビーページ初期化完了 - リアルタイム機能は一時的に無効');
        
        // 10秒ごとにページをリロードして最新状態を取得（テスト用）
        const interval = setInterval(() => {
            window.location.reload();
        }, 10000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    // 手動再接続（実際にはページリロード）
    const handleReconnect = () => {
        window.location.reload();
    };

    // プレイヤー情報を構築（PlayerListコンポーネント用）
    const players = participants.map((participant, index) => {
        return {
            id: participant.user_id,
            username: participant.formattedUser?.username || 'Unknown User',
            avatar: participant.formattedUser?.avatar,
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
                    
                    {/* テスト中の表示 */}
                    <div className="mt-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
                        <p className="text-sm text-yellow-800">
                            💡 テスト中: リアルタイム機能は一時的に無効です。10秒ごとに自動更新されます。
                        </p>
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
                                        .map((stat) => (
                                            <div key={stat.user_id} className="flex items-center justify-between">
                                                <span className="text-sm text-gray-600">
                                                    {stat.formattedUser?.username || 'Unknown User'}
                                                </span>
                                                <span className="font-medium text-gray-900">
                                                    {stat.wins_count}勝
                                                </span>
                                            </div>
                                        ))
                                    }
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">まだゲームが行われていません</p>
                            )}
                        </div>

                        {/* 接続状態 */}
                        <ConnectionStatus
                            connectionState={connectionStatus}
                            onReconnect={handleReconnect}
                        />

                        {/* ゲームコントロール */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
                            {/* 準備完了ボタン */}
                            <Form method="post">
                                <input type="hidden" name="_action" value="toggle_ready" />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                                        participants.find(p => p.user_id === user.id)?.is_ready
                                            ? 'bg-green-600 hover:bg-green-700 text-white'
                                            : 'bg-gray-600 hover:bg-gray-700 text-white'
                                    } disabled:opacity-50`}
                                >
                                    {isSubmitting ? (
                                        <div className="flex items-center justify-center space-x-2">
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            <span>処理中...</span>
                                        </div>
                                    ) : participants.find(p => p.user_id === user.id)?.is_ready ? (
                                        "準備完了！"
                                    ) : (
                                        "準備する"
                                    )}
                                </button>
                            </Form>

                            {/* ゲーム開始ボタン（ホストのみ） */}
                            {isHost && (
                                <Form method="post">
                                    <input type="hidden" name="_action" value="start_game" />
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || participants.some(p => !p.is_ready)}
                                        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                                    >
                                        {isSubmitting ? (
                                            <div className="flex items-center justify-center space-x-2">
                                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                <span>開始中...</span>
                                            </div>
                                        ) : (
                                            "ゲーム開始"
                                        )}
                                    </button>
                                </Form>
                            )}

                            {/* 退室ボタン */}
                            <Form method="post">
                                <input type="hidden" name="_action" value="leave_room" />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                                >
                                    退室
                                </button>
                            </Form>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}