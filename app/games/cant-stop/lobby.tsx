import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useRevalidator } from "@remix-run/react";
import { useState, useEffect, useCallback, useRef } from "react";
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

// 接続状態の型定義
interface ConnectionState {
    room: "connected" | "disconnected" | "error" | "connecting";
    game: "connected" | "disconnected" | "error" | "connecting";
    lastError?: string;
}

// アクションレスポンスの型定義
interface ActionData {
    success?: boolean;
    error?: string;
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

    const result = await getRoomData(request, roomId);
    if (!result.success || !result.data) {
        return redirect("/games/cant-stop");
    }

    const { room, participants, winStats } = result.data;

    const isParticipant = participants.some((p: RoomParticipant & { user: User | null }) => p.user_id === user.id);
    if (!isParticipant) {
        return redirect("/games/cant-stop");
    }

    if (room.status === 'playing') {
        return redirect(`/games/cant-stop/game/${room.room_id}`);
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
            
            // ゲーム開始後は room_id でリダイレクト（型安全にアクセス）
            const roomDataResult = await getRoomData(request, roomId);
            if (roomDataResult.success && roomDataResult.data) {
                return redirect(`/games/cant-stop/game/${roomDataResult.data.room.room_id}`);
            }
            
            // フォールバック: 元のroomIdを使用
            return redirect(`/games/cant-stop/game/${roomId}`);
        }

        default:
            return json({ error: "不正なアクションです" });
    }
}

export default function CantStopLobby() {
    const initialData = useLoaderData<typeof loader>();
    const actionData = useActionData<ActionData>();
    const navigation = useNavigation();
    const revalidator = useRevalidator();

    // 状態管理
    const [room, setRoom] = useState(initialData.room);
    const [participants, setParticipants] = useState(initialData.participants);
    const [winStats, setWinStats] = useState(initialData.winStats);
    const [isHost, setIsHost] = useState(initialData.isHost);
    
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        room: 'disconnected',
        game: 'connected',
        lastError: undefined
    });

    // 準備状態管理
    const [processingReady, setProcessingReady] = useState(false);
    const [isOwnUpdate, setIsOwnUpdate] = useState(false); // 自分の更新かどうかを判別
    
    // 現在のユーザーの準備状態（サーバーデータのみ使用）
    const currentParticipant = participants.find((p: any) => p.user_id === initialData.user.id);
    const displayReady = currentParticipant?.is_ready || false;

    // タイマー管理 - optimisticTimerは不要
    const revalidateTimerRef = useRef<NodeJS.Timeout | null>(null);

    // データ更新時の同期 - シンプルに
    useEffect(() => {
        setRoom(initialData.room);
        setParticipants(initialData.participants);
        setWinStats(initialData.winStats);
        setIsHost(initialData.isHost);
    }, [initialData]);

    // 準備完了ボタンハンドラ - 正しい順序で処理
    const handleToggleReady = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        
        if (processingReady) return;
        
        // 1. ボタン無効化
        setProcessingReady(true);
        setIsOwnUpdate(true);
        
        try {
            const formData = new FormData();
            formData.append('_action', 'toggle_ready');
            
            // 2. データ更新（サーバーに送信）
            console.log('サーバーにデータ更新リクエスト送信');
            const response = await fetch(window.location.pathname, {
                method: 'POST',
                body: formData,
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                console.log('ネットワークエラー:', response.status);
                setProcessingReady(false);
                setIsOwnUpdate(false);
                return;
            }
            
            console.log('サーバー更新完了');
            
            // 3. クライアントの状態更新
            console.log('クライアント状態更新中...');
            revalidator.revalidate();
            
            // 4. 更新完了まで少し待ってからボタン無効化解除
            setTimeout(() => {
                console.log('クライアント状態更新完了 - ボタン有効化');
                setProcessingReady(false);
                setIsOwnUpdate(false);
            }, 200); // データ更新の反映時間を考慮
            
        } catch (error) {
            console.error('リクエストエラー:', error);
            setProcessingReady(false);
            setIsOwnUpdate(false);
        }
        
    }, [processingReady, revalidator]);

    // リアルタイム通信 - 他のプレイヤーの更新は即座に反映
    useEffect(() => {
        try {
            const supabase = getSupabaseBrowserClient();
            setConnectionState(prev => ({ ...prev, room: 'connecting' }));
            
            const channel = supabase
                .channel(`lobby:${room.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'room_participants',
                        filter: `room_id=eq.${room.id}`
                    },
                    (payload) => {
                        console.log('参加者データ変更検知:', payload);
                        
                        // 自分の更新中でない場合のみ即座に反映
                        if (!isOwnUpdate) {
                            console.log('他プレイヤーの更新 - 即座に反映');
                            revalidator.revalidate();
                        } else {
                            console.log('自分の更新中 - リアルタイム更新をスキップ');
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
                        if (payload.new?.status === 'playing') {
                            // ゲーム開始時のみリダイレクト
                            window.location.href = `/games/cant-stop/game/${room.room_id}`;
                        } else {
                            // その他のルーム状態変更も即座に反映
                            if (!isOwnUpdate) {
                                revalidator.revalidate();
                            }
                        }
                    }
                )
                .subscribe((status: string) => {
                    console.log('リアルタイム接続状態:', status);
                    setConnectionState(prev => ({
                        ...prev,
                        room: status === 'SUBSCRIBED' ? 'connected' : 
                              status === 'CLOSED' ? 'disconnected' : 'connecting'
                    }));
                });

            return () => {
                if (revalidateTimerRef.current) {
                    clearTimeout(revalidateTimerRef.current);
                }
                supabase.removeChannel(channel);
            };
        } catch (error) {
            setConnectionState(prev => ({
                ...prev,
                room: 'error',
                lastError: 'リアルタイム通信の設定に失敗しました'
            }));
        }
    }, [room.id, revalidator, isOwnUpdate]);

    // UI状態
    const isSubmitting = navigation.state === "submitting";
    const allPlayersReady = participants.length >= 2 && participants.every((p: any) => p.is_ready);
    const canStartGame = isHost && allPlayersReady;

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-100 flex flex-col">
            <Header user={initialData.user} />
            <ConnectionStatus connectionState={connectionState} />

            {actionData?.error && (
                <div className="mx-auto max-w-7xl px-6 mt-4">
                    <div className="bg-red-50 border border-red-200 rounded-md p-4">
                        <div className="flex">
                            <div className="ml-3">
                                <h3 className="text-sm font-medium text-red-800">エラーが発生しました</h3>
                                <div className="mt-2 text-sm text-red-700">{actionData.error}</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <main className="flex-1 mx-auto max-w-7xl px-6 py-8 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900">ルーム: {room.room_id}</h1>
                                    <p className="text-sm text-gray-600 mt-1">参加者: {participants.length}/{room.max_players}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">参加者</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {participants.map((participant: any, index: number) => (
                                    <div key={participant.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                        <div className="flex items-center space-x-3">
                                            <div className={`w-4 h-4 rounded-full ${getPlayerColor(index)}`} />
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
                                            <div className="flex items-center space-x-2">
                                                <span className="font-medium text-gray-900">
                                                    {participant.user?.username || 'Unknown User'}
                                                    {participant.user_id === initialData.user.id && (
                                                        <span className="text-indigo-600 text-sm ml-1">(あなた)</span>
                                                    )}
                                                </span>
                                                {participant.user_id === room.host_user_id && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                                                        </svg>
                                                        ホスト
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                (participant.user_id === initialData.user.id ? displayReady : participant.is_ready)
                                                    ? 'bg-green-100 text-green-800' 
                                                    : 'bg-gray-100 text-gray-800'
                                            }`}>
                                                {(participant.user_id === initialData.user.id ? displayReady : participant.is_ready) ? '準備完了' : '準備中'}
                                            </span>
                                            {isHost && participant.user_id !== initialData.user.id && (
                                                <Form method="post" className="inline">
                                                    <input type="hidden" name="_action" value="kick" />
                                                    <input type="hidden" name="targetUserId" value={participant.user_id} />
                                                    <button
                                                        type="submit"
                                                        disabled={isSubmitting}
                                                        className="text-red-500 hover:text-red-700 disabled:opacity-50"
                                                        onClick={(e) => {
                                                            if (!confirm(`${participant.user?.username}をキックしますか？`)) {
                                                                e.preventDefault();
                                                            }
                                                        }}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </Form>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {Array.from({ length: room.max_players - participants.length }).map((_, index) => (
                                    <div key={`empty-${index}`} className="flex items-center p-4 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300">
                                        <div className="flex items-center space-x-3 text-gray-500">
                                            <div className="w-4 h-4 rounded-full bg-gray-300" />
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

                    <div className="space-y-6">
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">準備状態</h3>
                            <form onSubmit={handleToggleReady}>
                                <button
                                    type="submit"
                                    disabled={processingReady}
                                    className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
                                        processingReady 
                                            ? 'bg-gray-400 text-white cursor-not-allowed opacity-70'
                                            : displayReady
                                                ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-md hover:scale-105'
                                                : 'bg-green-500 hover:bg-green-600 text-white shadow-md hover:scale-105'
                                    }`}
                                >
                                    {processingReady ? '更新中...' : displayReady ? '準備解除' : '準備完了'}
                                </button>
                            </form>
                            <div className="mt-2 text-center">
                                <span className={`text-sm ${displayReady ? 'text-yellow-600' : 'text-gray-600'}`}>
                                    {displayReady ? 'ゲーム開始を待機中' : 'ゲーム開始の準備をしてください'}
                                </span>
                            </div>
                        </div>

                        {isHost && (
                            <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">ゲーム開始</h3>
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
                                    <div>
                                        <button
                                            disabled
                                            className="w-full bg-gray-300 text-gray-500 font-medium py-3 px-4 rounded-lg cursor-not-allowed"
                                        >
                                            全員の準備完了を待機中
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2 text-center">
                                            最低2人、全員の準備完了が必要です
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <Form method="post">
                                <input type="hidden" name="_action" value="leave" />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
                                    onClick={(e) => {
                                        if (!confirm('ルームから退出しますか？')) {
                                            e.preventDefault();
                                        }
                                    }}
                                >
                                    {isSubmitting ? '退出中...' : 'ルームから退出'}
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