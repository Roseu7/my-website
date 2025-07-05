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
import { getSupabaseBrowserClient } from "~/libs/supabase.client";

// 接続状態の型定義
interface ConnectionState {
    room: "connected" | "disconnected" | "error" | "connecting";
    game: "connected" | "disconnected" | "error" | "connecting";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
    const user = await getUserFromSession(request);
    if (!user) {
        // 現在のURLを認証後のリダイレクト先として設定
        const currentUrl = new URL(request.url);
        const redirectTo = `${currentUrl.pathname}${currentUrl.search}`;
        return redirect(`/auth/discord?redirectTo=${encodeURIComponent(redirectTo)}`);
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

    // ユーザー情報整形関数を改善
    const formatUserFromAuth = (authUser: User | any): { id: string; username: string; avatar?: string } | null => {
        if (!authUser) {
            console.log('authUser is null or undefined');
            return null;
        }
        
        console.log('Formatting user:', authUser);
        
        // 既に整形済みのUser型の場合
        if (authUser.username && typeof authUser.username === 'string') {
            return {
                id: authUser.id,
                username: authUser.username,
                avatar: authUser.avatar
            };
        }
        
        // Supabaseから取得した生のユーザーオブジェクトの場合
        const metadata = authUser.user_metadata || authUser.raw_user_meta_data || {};
        const customClaims = metadata.custom_claims || {};
        
        // より包括的なユーザー名取得
        const username = customClaims.global_name || 
                        metadata.full_name || 
                        metadata.name || 
                        metadata.display_name ||
                        metadata.username ||
                        authUser.email?.split('@')[0] ||
                        `User${authUser.id.slice(-4)}`;
        
        const formattedUser = {
            id: authUser.id,
            username: username,
            avatar: metadata.avatar_url || metadata.picture
        };
        
        console.log('Formatted user result:', formattedUser);
        return formattedUser;
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
        const currentUrl = new URL(request.url);
        const redirectTo = `${currentUrl.pathname}${currentUrl.search}`;
        return redirect(`/auth/discord?redirectTo=${encodeURIComponent(redirectTo)}`);
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
    const { 
        user, 
        room: initialRoom, 
        participants: initialParticipants, 
        winStats: initialWinStats, 
        isHost: initialIsHost 
    } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    // リアルタイム更新のための状態
    const [room, setRoom] = useState<GameRoom>(initialRoom);
    const [participants, setParticipants] = useState(initialParticipants);
    const [winStats, setWinStats] = useState(initialWinStats);
    const [isHost, setIsHost] = useState<boolean>(initialIsHost);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionState>({
        room: "connected",
        game: "connected"
    });
    const [realtimeError, setRealtimeError] = useState<string | null>(null);

    const isSubmitting = navigation.state === "submitting";

    // リアルタイム購読を設定
    useEffect(() => {
        console.log('Setting up realtime subscription for room:', room.id);
        
        try {
            const supabase = getSupabaseBrowserClient();
            
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
                            setRoom(payload.new as GameRoom);
                            
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
                        setConnectionStatus(prev => ({ ...prev, room: 'connected' }));
                        setRealtimeError(null);
                    } else if (status === 'CHANNEL_ERROR') {
                        setConnectionStatus(prev => ({ ...prev, room: 'error' }));
                        setRealtimeError('リアルタイム接続でエラーが発生しました');
                    } else if (status === 'TIMED_OUT') {
                        setConnectionStatus(prev => ({ ...prev, room: 'disconnected' }));
                        setRealtimeError('リアルタイム接続がタイムアウトしました');
                    }
                });

            // クリーンアップ
            return () => {
                console.log('Cleaning up realtime subscription');
                supabase.removeChannel(roomChannel);
            };
        } catch (error) {
            console.error('Failed to setup realtime subscription:', error);
            setConnectionStatus(prev => ({ ...prev, room: 'error' }));
            setRealtimeError('リアルタイム機能の初期化に失敗しました');
        }
    }, [room.id]);

    // 参加者の準備状態を確認
    const allReady = participants.length >= 2 && participants.every((p: any) => p.is_ready);
    const canStartGame = isHost && allReady && !isSubmitting;

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            <main className="flex-1 mx-auto max-w-7xl px-6 py-12 lg:px-8">
                {/* ルーム情報ヘッダー */}
                <div className="mb-8">
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">
                                    ルーム: {room.room_id}
                                </h1>
                                <p className="text-gray-600 mt-1">
                                    参加者 {participants.length}/{room.max_players}人
                                </p>
                            </div>
                            <div className="flex items-center space-x-4">
                                <ConnectionStatus 
                                    roomStatus={connectionStatus.room}
                                    gameStatus={connectionStatus.game}
                                    error={realtimeError}
                                />
                                {!isHost && (
                                    <Form method="post">
                                        <input type="hidden" name="_action" value="leave_room" />
                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            退出
                                        </button>
                                    </Form>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* エラーメッセージ */}
                {actionData?.error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-sm">
                            {typeof actionData.error === 'string' ? actionData.error : 'エラーが発生しました'}
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* プレイヤーリスト */}
                    <div className="lg:col-span-2">
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">
                                プレイヤー
                            </h2>
                            <PlayerList
                                players={participants.map((p: any, index: number) => ({
                                    id: p.user_id,
                                    username: p.formattedUser?.username || 'Unknown User',
                                    avatar: p.formattedUser?.avatar,
                                    color: getPlayerColor(index),
                                    isCurrentTurn: false,
                                    isReady: p.is_ready,
                                    isHost: p.user_id === room.host_user_id
                                }))}
                                currentUserId={user.id}
                                isHost={isHost}
                                showActions={true}
                                showStats={true}
                                winStats={winStats}
                                isSubmitting={isSubmitting}
                                mode="lobby"
                            />
                        </div>
                    </div>

                    {/* サイドバー */}
                    <div className="space-y-6">
                        {/* 準備状態 */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                ゲーム開始準備
                            </h3>
                            
                            <div className="space-y-4">
                                {/* 自分の準備状態切り替え */}
                                <Form method="post">
                                    <input type="hidden" name="_action" value="toggle_ready" />
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className={`w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                                            participants.find((p: any) => p.user_id === user.id)?.is_ready
                                                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                                        }`}
                                    >
                                        {participants.find((p: any) => p.user_id === user.id)?.is_ready ? '準備完了' : '準備する'}
                                    </button>
                                </Form>

                                {/* ゲーム開始ボタン（ホストのみ） */}
                                {isHost && (
                                    <Form method="post">
                                        <input type="hidden" name="_action" value="start_game" />
                                        <button
                                            type="submit"
                                            disabled={!canStartGame}
                                            className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold py-3 px-4 rounded-lg hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSubmitting ? (
                                                <span className="flex items-center justify-center">
                                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                    開始中...
                                                </span>
                                            ) : (
                                                'ゲーム開始'
                                            )}
                                        </button>
                                        {!allReady && (
                                            <p className="text-sm text-gray-500 mt-2 text-center">
                                                全員の準備完了が必要です
                                            </p>
                                        )}
                                    </Form>
                                )}
                            </div>
                        </div>

                        {/* ゲームルール */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                ゲームルール
                            </h3>
                            <ul className="text-sm text-gray-600 space-y-2">
                                <li>• 4つのサイコロを振って進む</li>
                                <li>• 2つのペアの合計でコラムを選択</li>
                                <li>• 3つのコラムを完成させて勝利</li>
                                <li>• バストするとそのターンの進行がリセット</li>
                                <li>• リスクとリターンを考えて戦略を立てよう</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}