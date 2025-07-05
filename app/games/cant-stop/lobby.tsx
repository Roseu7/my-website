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
import { ConnectionStatus } from "~/games/cant-stop/components";
import type { LobbyState, RoomParticipant, User, GameRoom, RoomWins } from "~/games/cant-stop/utils/types";
import { getPlayerColor } from "~/games/cant-stop/utils/constants";
import { getSupabaseBrowserClient } from "~/libs/supabase.client";

// 接続状態の型定義をConnectionStatusProps互換に修正
interface ConnectionState {
    room: "connected" | "disconnected" | "error" | "connecting";
    game: "connected" | "disconnected" | "error" | "connecting";
    lastError?: string;
}

// ユーザー情報を整形するヘルパー関数
function formatUserFromAuth(authUser: any) {
    if (!authUser) return null;
    
    const metadata = authUser.raw_user_meta_data || authUser.user_metadata || {};
    const customClaims = metadata.custom_claims || {};
    
    return {
        id: authUser.id,
        username: customClaims.global_name || metadata.full_name || metadata.name || metadata.display_name || metadata.username || "User",
        avatar: metadata.avatar_url || metadata.picture
    };
}

// リアルタイムクライアント（簡易版）
function createRealtimeClient(roomId: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;

    return {
        subscribeToRoom: (callbacks: any) => {
            // 初期状態を接続中に設定
            if (callbacks.onConnectionStateChanged) {
                callbacks.onConnectionStateChanged({
                    room: 'connecting',
                    game: 'connected',
                    lastError: undefined
                });
            }

            const channel = supabase
                .channel(`room:${roomId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'room_participants',
                        filter: `room_id=eq.${roomId}`
                    },
                    () => {
                        console.log('Room participants changed');
                        window.location.reload(); // 簡易的な更新
                    }
                )
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'game_rooms',
                        filter: `id=eq.${roomId}`
                    },
                    (payload: any) => {
                        if (payload.new?.status === 'playing') {
                            window.location.href = `/games/cant-stop/game/${roomId}`;
                        }
                    }
                )
                .subscribe((status: string) => {
                    console.log('Realtime subscription status:', status);
                    if (callbacks.onConnectionStateChanged) {
                        callbacks.onConnectionStateChanged({
                            room: status === 'SUBSCRIBED' ? 'connected' : 'connecting',
                            game: 'connected',
                            lastError: undefined
                        });
                    }
                });

            return channel;
        },
        unsubscribe: (channel: any) => {
            if (channel) {
                supabase.removeChannel(channel);
            }
        },
        forceReconnect: () => {
            window.location.reload();
        }
    };
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
    const [room, setRoom] = useState(initialRoom);
    const [participants, setParticipants] = useState(initialParticipants);
    const [winStats, setWinStats] = useState(initialWinStats);
    const [isHost, setIsHost] = useState(initialIsHost);
    const [showSettings, setShowSettings] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [kickConfirmPlayer, setKickConfirmPlayer] = useState<string | null>(null);
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        room: 'disconnected',
        game: 'connected', // ロビー画面ではゲーム接続は常に有効
        lastError: undefined
    });
    const [realtimeClient, setRealtimeClient] = useState<any>(null);

    // 現在のユーザーの準備状態
    const currentParticipant = participants.find((p: any) => p.user_id === user.id);
    const isReady = currentParticipant?.is_ready || false;

    // リアルタイム通信の設定
    useEffect(() => {
        console.log('Setting up realtime subscription for room:', room.id);
        
        try {
            const supabase = getSupabaseBrowserClient();
            
            // 初期状態を接続中に設定
            setConnectionState(prev => ({ ...prev, room: 'connecting' }));
            
            // ルーム情報の変更を監視
            const roomChannel = supabase
                .channel(`room:${room.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'room_participants',
                        filter: `room_id=eq.${room.id}`
                    },
                    async (payload) => {
                        console.log('Participants changed:', payload);
                        
                        // 参加者情報を即座に更新（ページリロードなし）
                        try {
                            const response = await fetch(window.location.pathname, {
                                headers: {
                                    'Accept': 'application/json',
                                    'Cache-Control': 'no-cache'
                                }
                            });
                            
                            if (response.ok) {
                                const data = await response.json();
                                setParticipants(data.participants);
                                setWinStats(data.winStats);
                                console.log('参加者情報を更新しました');
                            }
                        } catch (error) {
                            console.error('参加者情報更新エラー:', error);
                            // フォールバック：エラー時のみページリロード
                            setTimeout(() => window.location.reload(), 1000);
                        }
                    }
                )
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'game_rooms',
                        filter: `id=eq.${room.id}`
                    },
                    (payload: any) => {
                        console.log('Room status changed:', payload);
                        if (payload.new?.status === 'playing') {
                            window.location.href = `/games/cant-stop/game/${room.room_id}`;
                        } else {
                            setRoom(prev => ({ ...prev, ...payload.new }));
                        }
                    }
                )
                .subscribe((status: string) => {
                    console.log('Subscription status:', status);
                    switch (status) {
                        case 'SUBSCRIBED':
                            setConnectionState(prev => ({ ...prev, room: 'connected' }));
                            break;
                        case 'CLOSED':
                            setConnectionState(prev => ({ ...prev, room: 'disconnected' }));
                            break;
                        case 'CHANNEL_ERROR':
                            setConnectionState(prev => ({ ...prev, room: 'error' }));
                            break;
                        default:
                            setConnectionState(prev => ({ ...prev, room: 'connecting' }));
                    }
                });

            return () => {
                supabase.removeChannel(roomChannel);
            };
        } catch (error) {
            console.error('Realtime setup error:', error);
            setConnectionState(prev => ({ ...prev, room: 'error', lastError: 'リアルタイム通信エラー' }));
        }
    }, [room.id, room.room_id]);

    // プレイヤーカラーを取得
    const getParticipantColor = (index: number) => {
        return getPlayerColor(index);
    };

    // 開始条件チェック
    const canStartGame = participants.length >= 2 && participants.every((p: any) => p.is_ready);
    const isSubmitting = navigation.state === 'submitting';

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* メインコンテンツ */}
            <main className="flex-1 mx-auto max-w-7xl px-6 py-8 lg:px-8">
                {/* ページタイトル */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">
                        ルーム: {room.room_id}
                    </h1>
                    <p className="text-lg text-gray-600">
                        Can't Stop ゲームロビー
                    </p>
                </div>

                {/* 接続状態表示 */}
                <div className="mb-6 flex justify-center">
                    <div className="flex items-center space-x-2 text-sm">
                        <div className={`w-3 h-3 rounded-full ${
                            connectionState.room === 'connected' ? 'bg-green-400' :
                            connectionState.room === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                        }`} />
                        <span className="text-gray-500">
                            {connectionState.room === 'connected' ? '接続中' :
                             connectionState.room === 'error' ? '接続エラー' : '再接続中...'}
                        </span>
                    </div>
                </div>

                {/* エラーメッセージ */}
                {actionData && 'error' in actionData && (
                    <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-red-600">
                            {typeof actionData.error === 'string' ? actionData.error : 'エラーが発生しました'}
                        </p>
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
                                    準備完了: {participants.filter((p: any) => p.is_ready).length}/{participants.length}
                                </div>
                            </div>

                            <div className="space-y-4">
                                {participants.map((participant: any, index: number) => (
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
                                            <span>空きスロット</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* サイドバー */}
                    <div className="space-y-6">
                        {/* 準備完了ボタン */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                準備状態
                            </h3>
                            <Form method="post">
                                <input type="hidden" name="_action" value="toggle_ready" />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                                        isReady
                                            ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                                            : 'bg-green-500 hover:bg-green-600 text-white'
                                    }`}
                                >
                                    {isSubmitting 
                                        ? '更新中...' 
                                        : isReady 
                                            ? '準備解除' 
                                            : '準備完了'
                                    }
                                </button>
                            </Form>
                        </div>

                        {/* ゲーム開始（ホストのみ） */}
                        {isHost && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                    ゲーム開始
                                </h3>
                                {canStartGame ? (
                                    <Form method="post">
                                        <input type="hidden" name="_action" value="start_game" />
                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {isSubmitting ? 'ゲーム開始中...' : 'ゲーム開始'}
                                        </button>
                                    </Form>
                                ) : (
                                    <div className="text-center">
                                        <button
                                            disabled
                                            className="w-full bg-gray-300 text-gray-500 font-medium py-3 px-4 rounded-lg cursor-not-allowed"
                                        >
                                            全員準備完了待ち
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2">
                                            最低2人 & 全員準備完了が必要です
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 勝利統計 */}
                        {winStats.length > 0 && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                    勝利統計
                                </h3>
                                <div className="space-y-2">
                                    {winStats
                                        .sort((a, b) => b.wins_count - a.wins_count)
                                        .map((stat, index) => {
                                            const participant = participants.find(p => p.user_id === stat.user_id);
                                            return (
                                                <div key={stat.id} className="flex items-center justify-between">
                                                    <div className="flex items-center space-x-2">
                                                        <span className="text-sm font-medium">
                                                            #{index + 1}
                                                        </span>
                                                        <span className="text-sm text-gray-700">
                                                            {participant?.user?.username || 'Unknown User'}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm font-semibold text-green-600">
                                                        {stat.wins_count}勝
                                                    </span>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                        {/* ルーム操作 */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                ルーム操作
                            </h3>
                            <div className="space-y-3">
                                <button
                                    onClick={() => setShowExitConfirm(true)}
                                    className="w-full bg-red-100 hover:bg-red-200 text-red-800 font-medium py-2 px-4 rounded-lg transition-colors"
                                >
                                    ルームから退出
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 退出確認モーダル */}
                {showExitConfirm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                ルームから退出しますか？
                            </h3>
                            <p className="text-gray-600 mb-6">
                                この操作は取り消せません。
                            </p>
                            <div className="flex space-x-3">
                                <button
                                    onClick={() => setShowExitConfirm(false)}
                                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded-lg transition-colors"
                                >
                                    キャンセル
                                </button>
                                <Form method="post" className="flex-1">
                                    <input type="hidden" name="_action" value="leave" />
                                    <button
                                        type="submit"
                                        className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                                    >
                                        退出
                                    </button>
                                </Form>
                            </div>
                        </div>
                    </div>
                )}

                {/* キック確認モーダル */}
                {kickConfirmPlayer && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                プレイヤーをキックしますか？
                            </h3>
                            <p className="text-gray-600 mb-6">
                                {participants.find(p => p.user_id === kickConfirmPlayer)?.user?.username || 'Unknown User'} をルームから除外します。
                            </p>
                            <div className="flex space-x-3">
                                <button
                                    onClick={() => setKickConfirmPlayer(null)}
                                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded-lg transition-colors"
                                >
                                    キャンセル
                                </button>
                                <Form method="post" className="flex-1">
                                    <input type="hidden" name="_action" value="kick" />
                                    <input type="hidden" name="targetUserId" value={kickConfirmPlayer} />
                                    <button
                                        type="submit"
                                        onClick={() => setKickConfirmPlayer(null)}
                                        className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                                    >
                                        キック
                                    </button>
                                </Form>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <Footer />
        </div>
    );
}