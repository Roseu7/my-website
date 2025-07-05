import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { useState } from "react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { getRoomData } from "~/games/cant-stop/utils/database.server";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import type { 
    Player, 
    GameResult, 
    GameRoom,
    RoomParticipant,
    RoomWins,
    User,
    GameLog
} from "~/games/cant-stop/utils/types";
import { getPlayerColor } from "~/games/cant-stop/utils/constants";

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
    const roomResult = await getRoomData(request, roomId);
    if (!roomResult.success || !roomResult.data) {
        return redirect("/games/cant-stop");
    }

    const { room, participants, winStats } = roomResult.data;

    // 現在のユーザーが参加者にいるかチェック
    const isParticipant = participants.some((p: RoomParticipant & { user: User | null }) => p.user_id === user.id);
    if (!isParticipant) {
        return redirect("/games/cant-stop");
    }

    // TODO: 実際のゲーム履歴を取得する
    // 今は仮のデータを使用
    const gameHistory: GameLog[] = [
        { message: 'ゲーム開始' },
        { message: 'コラム2を完成', playerId: participants[0]?.user_id },
        { message: 'コラム7を完成', playerId: participants[1]?.user_id },
        { message: 'コラム10を完成', playerId: participants[2]?.user_id || participants[0]?.user_id },
        { message: 'コラム3を完成', playerId: participants[1]?.user_id },
        { message: 'コラム11を完成', playerId: participants[1]?.user_id },
        { message: '3つのコラムを完成させて勝利！', playerId: participants[1]?.user_id }
    ];

    // ユーザー情報整形関数（インライン）
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

    // プレイヤー情報を構築
    const players: Player[] = participants.map((participant: RoomParticipant & { user: User | null }, index: number) => {
        const userData = formatUserFromAuth(participant.user);
        return {
            id: participant.user_id,
            username: userData?.username || 'Unknown User',
            avatar: userData?.avatar,
            color: getPlayerColor(index),
            isCurrentTurn: false,
            isHost: participant.user_id === room.host_user_id
        };
    });

    // 勝者を決定（仮で2番目のプレイヤー）
    const winner = players[1] || players[0];

    // 勝利統計を整形
    const sortedWinStats = winStats
        .map((stat: RoomWins) => ({
            ...stat,
            player: players.find((p: Player) => p.id === stat.user_id)!
        }))
        .sort((a: RoomWins & { player: Player }, b: RoomWins & { player: Player }) => b.wins_count - a.wins_count);

    const gameResult: GameResult = {
        winner,
        players,
        winStats: sortedWinStats,
        gameHistory,
        roomId: room.id
    };

    return json({
        user,
        gameResult
    });
}

export default function CantStopResult() {
    const { user, gameResult } = useLoaderData<typeof loader>();
    const [showHistory, setShowHistory] = useState(false);

    const totalGames = gameResult.winStats.reduce((sum: number, stat: RoomWins & { player: Player }) => sum + stat.wins_count, 0);

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            <main className="flex-1 mx-auto max-w-4xl px-6 py-8 lg:px-8">
                {/* 勝利祝賀 */}
                <div className="text-center mb-8">
                    <div className="mb-6">
                        <div className="inline-flex items-center justify-center w-24 h-24 bg-yellow-100 rounded-full mb-4">
                            <svg className="w-12 h-12 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                            </svg>
                        </div>
                        <h1 className="text-4xl font-bold text-gray-900 mb-2">
                            ゲーム終了！
                        </h1>
                        <div className="flex items-center justify-center space-x-3">
                            <div className={`w-6 h-6 rounded-full ${gameResult.winner.color}`}></div>
                            <span className="text-2xl font-semibold text-gray-800">
                                {gameResult.winner.username} の勝利！
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* 最終順位 */}
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-6">今回の順位</h2>
                        <div className="space-y-4">
                            {gameResult.players.map((player: Player, index: number) => (
                                <div 
                                    key={player.id}
                                    className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                                        index === 0 
                                            ? 'bg-yellow-50 border-yellow-200' 
                                            : 'bg-gray-50 border-gray-200'
                                    }`}
                                >
                                    <div className="flex items-center space-x-3">
                                        <div className="flex items-center justify-center w-8 h-8 bg-gray-200 rounded-full font-bold text-gray-700">
                                            {index + 1}
                                        </div>
                                        <div className={`w-4 h-4 rounded-full ${player.color}`}></div>
                                        <div>
                                            <span className="font-medium text-gray-900">
                                                {player.username}
                                            </span>
                                            {index === 0 && (
                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                                                    </svg>
                                                    勝者
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 通算統計 */}
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-6">通算成績</h2>
                        {gameResult.winStats.length > 0 ? (
                            <div className="space-y-4">
                                {gameResult.winStats.map((stat: RoomWins & { player: Player }, index: number) => (
                                    <div key={stat.user_id} className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                            <div className={`w-4 h-4 rounded-full ${stat.player.color}`}></div>
                                            <span className="font-medium text-gray-900">
                                                {stat.player.username}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-semibold text-gray-900">
                                                {stat.wins_count}勝
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                勝率 {totalGames > 0 ? Math.round((stat.wins_count / totalGames) * 100) : 0}%
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-500">統計データがありません</p>
                        )}
                    </div>

                    {/* ゲーム履歴 */}
                    <div className="lg:col-span-2">
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-semibold text-gray-900">ゲーム履歴</h2>
                                <button
                                    onClick={() => setShowHistory(!showHistory)}
                                    className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                                >
                                    {showHistory ? '履歴を隠す' : '履歴を表示'}
                                </button>
                            </div>
                            
                            {showHistory && (
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {gameResult.gameHistory.map((log: GameLog, index: number) => (
                                        <div key={index} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                                            {log.playerId ? (
                                                <span>
                                                    <span className="font-medium">
                                                        {gameResult.players.find((p: Player) => p.id === log.playerId)?.username}
                                                    </span>
                                                    : {log.message}
                                                </span>
                                            ) : (
                                                log.message
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* アクションボタン */}
                <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                    <Form method="get" action={`/games/cant-stop/lobby/${gameResult.roomId}`}>
                        <button
                            type="submit"
                            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors w-full sm:w-auto"
                        >
                            もう一度プレイ
                        </button>
                    </Form>
                    
                    <Form method="get" action="/games/cant-stop">
                        <button
                            type="submit"
                            className="px-6 py-3 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors w-full sm:w-auto"
                        >
                            別のルームに参加
                        </button>
                    </Form>
                    
                    <Form method="get" action="/">
                        <button
                            type="submit"
                            className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition-colors w-full sm:w-auto"
                        >
                            ホームに戻る
                        </button>
                    </Form>
                </div>

                {/* ゲーム説明（次回のため） */}
                <div className="mt-12 bg-white/60 backdrop-blur-sm rounded-lg shadow border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Can't Stop とは</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-600">
                        <div>
                            <h4 className="font-medium text-gray-900 mb-2">ゲームの目標</h4>
                            <p>3つのコラムを最初に完成させたプレイヤーが勝利します。</p>
                        </div>
                        <div>
                            <h4 className="font-medium text-gray-900 mb-2">基本ルール</h4>
                            <ul className="space-y-1">
                                <li>• 4つのサイコロを振って進路を選択</li>
                                <li>• 進むかストップするかを決断</li>
                                <li>• バストすると一時的な進行がリセット</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}