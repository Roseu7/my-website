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
                        let connectionState;
                        switch (status) {
                            case 'SUBSCRIBED':
                                connectionState = {
                                    room: 'connected' as const,
                                    game: 'connected' as const,
                                    lastError: undefined
                                };
                                break;
                            case 'CHANNEL_ERROR':
                                connectionState = {
                                    room: 'error' as const,
                                    game: 'connected' as const,
                                    lastError: 'リアルタイム接続でエラーが発生しました'
                                };
                                break;
                            case 'TIMED_OUT':
                                connectionState = {
                                    room: 'disconnected' as const,
                                    game: 'connected' as const,
                                    lastError: 'リアルタイム接続がタイムアウトしました'
                                };
                                break;
                            case 'CLOSED':
                                connectionState = {
                                    room: 'disconnected' as const,
                                    game: 'connected' as const,
                                    lastError: 'リアルタイム接続が閉じられました'
                                };
                                break;
                            default:
                                connectionState = {
                                    room: 'connecting' as const,
                                    game: 'connected' as const,
                                    lastError: undefined
                                };
                                break;
                        }
                        callbacks.onConnectionStateChanged(connectionState);
                    }
                });

            return channel;
        },
        cleanup: () => {
            // クリーンアップ処理
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
                        table: 'game_rooms',
                        filter: `id=eq.${room.id}`
                    },
                    (payload) => {
                        console.log('Room update received:', payload);
                        if (payload.eventType === 'UPDATE' && payload.new) {
                            setRoom(payload.new as any);
                            
                            // ゲーム開始時の処理
                            if (payload.new.status === 'playing') {
                                window.location.href = `/games/cant-stop/game/${room.id}`;
                            }
                        }
                    }
                )
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'room_participants',
                        filter: `room_id=eq.${room.id}`
                    },
                    async (payload) => {
                        console.log('Participants update received:', payload);
                        
                        // 参加者の変更があった場合、ページをリロード（簡易版）
                        // TODO: より効率的なデータ更新方法を実装
                        window.location.reload();
                    }
                )
                .subscribe((status) => {
                    console.log('Realtime subscription status:', status);
                    if (status === 'SUBSCRIBED') {
                        setConnectionState(prev => ({ ...prev, room: 'connected' }));
                    } else if (status === 'CHANNEL_ERROR') {
                        setConnectionState(prev => ({ 
                            ...prev, 
                            room: 'error',
                            lastError: 'リアルタイム接続でエラーが発生しました'
                        }));
                    } else if (status === 'TIMED_OUT') {
                        setConnectionState(prev => ({ 
                            ...prev, 
                            room: 'disconnected',
                            lastError: 'リアルタイム接続がタイムアウトしました'
                        }));
                        
                        // タイムアウト時に自動で再接続を試行
                        console.log('タイムアウトを検知。30秒後に自動再接続します...');
                        setTimeout(() => {
                            console.log('自動再接続を実行中...');
                            window.location.reload();
                        }, 30000); // 30秒後に自動リロード
                        
                    } else if (status === 'CLOSED') {
                        setConnectionState(prev => ({ 
                            ...prev, 
                            room: 'disconnected',
                            lastError: '接続が閉じられました'
                        }));
                    }
                });

            // クリーンアップ
            return () => {
                console.log('Cleaning up realtime subscription');
                supabase.removeChannel(roomChannel);
            };
        } catch (error) {
            console.error('Failed to setup realtime subscription:', error);
            setConnectionState(prev => ({ 
                ...prev, 
                room: 'error',
                lastError: 'リアルタイム機能の初期化に失敗しました'
            }));
        }
    }, [room.id]);

    // 手動再接続
    const handleReconnect = async () => {
        console.log('手動再接続を開始...');
        
        // 接続状態を接続中に設定
        setConnectionState(prev => ({ 
            ...prev, 
            room: 'connecting',
            lastError: undefined 
        }));
        
        try {
            // 最新データを再取得
            const response = await fetch(window.location.pathname, {
                headers: {
                    'Accept': 'application/json',
                }
            });
            
            if (response.ok) {
                // ページをリロードして確実に最新状態を取得
                window.location.reload();
            } else {
                throw new Error('データの再取得に失敗しました');
            }
        } catch (error) {
            console.error('再接続エラー:', error);
            setConnectionState(prev => ({ 
                ...prev, 
                room: 'error',
                lastError: '再接続に失敗しました。ページを更新してください。'
            }));
        }
    };

    // ゲーム開始の条件チェック
    const canStartGame = () => {
        return isHost && 
               participants.length >= 2 && 
               participants.every((p: any) => p.is_ready);
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
                {actionData && 'error' in actionData && (
                    <div className="mb-4 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700 text-center">
                        {typeof actionData.error === 'string' ? actionData.error : String(actionData.error)}
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
                                                    {/* デバッグ情報 */}
                                                    <span className="ml-1 text-xs opacity-50">
                                                        ({participant.user_id.slice(-4)}: {participant.is_ready ? 'T' : 'F'})
                                                    </span>
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
                            <Form method="post" replace>
                                <input type="hidden" name="_action" value="toggle_ready" />
                                <button
                                    type="submit"
                                    disabled={navigation.state === "submitting"}
                                    className={`group w-full h-12 px-4 rounded-lg font-medium transition-all duration-200 relative flex items-center justify-center disabled:opacity-50 ${
                                        isReady
                                            ? 'bg-green-600 hover:bg-red-600 text-white'
                                            : 'bg-gray-200 hover:bg-green-600 text-gray-700 hover:text-white'
                                    }`}
                                >
                                    <span className={`transition-opacity duration-200 ${isReady ? 'group-hover:opacity-0' : ''}`}>
                                        {navigation.state === "submitting" 
                                            ? '更新中...' 
                                            : isReady ? '準備完了' : '準備する'
                                        }
                                    </span>
                                    {isReady && navigation.state !== "submitting" && (
                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                            準備を取り消す
                                        </span>
                                    )}
                                </button>
                            </Form>
                            
                            {/* デバッグ情報 */}
                            <div className="mt-2 text-xs text-gray-500">
                                あなたの状態: {isReady ? '準備完了' : '待機中'} 
                                {navigation.state === "submitting" && ' (送信中)'}
                            </div>
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
                            {participants.find((p: any) => p.user_id === kickConfirmPlayer)?.user?.username || 'このユーザー'} をルームからキックしますか？
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