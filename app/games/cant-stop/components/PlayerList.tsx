import { Form } from "@remix-run/react";
import type { Player, RoomParticipant, User, RoomWins } from "~/games/cant-stop/utils/types";
import { formatPlayerName } from "~/games/cant-stop/utils/helpers";

interface PlayerListProps {
    players: Player[];
    currentUserId: string;
    isHost?: boolean;
    showActions?: boolean;
    showStats?: boolean;
    winStats?: RoomWins[];
    isSubmitting?: boolean;
    mode?: 'lobby' | 'game' | 'result';
}

export function PlayerList({
    players,
    currentUserId,
    isHost = false,
    showActions = false,
    showStats = false,
    winStats = [],
    isSubmitting = false,
    mode = 'game'
}: PlayerListProps) {

    /**
     * プレイヤーの勝利数を取得
     */
    const getPlayerWins = (playerId: string): number => {
        const stat = winStats.find(s => s.user_id === playerId);
        return stat?.wins_count || 0;
    };

    /**
     * プレイヤーの勝率を計算
     */
    const getPlayerWinRate = (playerId: string): number => {
        const totalGames = winStats.reduce((sum, stat) => sum + stat.wins_count, 0);
        if (totalGames === 0) return 0;
        
        const playerWins = getPlayerWins(playerId);
        return Math.round((playerWins / totalGames) * 100);
    };

    /**
     * プレイヤーのアバターを表示
     */
    const renderPlayerAvatar = (player: Player, size: 'sm' | 'md' | 'lg' = 'md') => {
        const sizeClasses = {
            sm: 'w-8 h-8',
            md: 'w-10 h-10',
            lg: 'w-12 h-12'
        };

        return player.avatar ? (
            <img
                src={player.avatar}
                alt={player.username}
                className={`${sizeClasses[size]} rounded-full border-2 border-gray-200 object-cover`}
            />
        ) : (
            <div className={`${sizeClasses[size]} bg-gray-300 rounded-full flex items-center justify-center border-2 border-gray-200`}>
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
            </div>
        );
    };

    /**
     * プレイヤーのステータスバッジ
     */
    const renderStatusBadge = (player: Player) => {
        const badges = [];

        // ホストバッジ
        if (player.isHost) {
            badges.push(
                <span key="host" className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                    </svg>
                    ホスト
                </span>
            );
        }

        // ターン中バッジ
        if (player.isCurrentTurn && mode === 'game') {
            badges.push(
                <span key="turn" className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 animate-pulse">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-1" />
                    ターン中
                </span>
            );
        }

        // 準備状態バッジ（ロビーモード）
        if (mode === 'lobby' && player.isReady !== undefined) {
            badges.push(
                <span key="ready" className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    player.isReady ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                    {player.isReady ? '準備完了' : '準備中'}
                </span>
            );
        }

        return badges;
    };

    /**
     * アクションボタンをレンダリング
     */
    const renderActionButtons = (player: Player) => {
        if (!showActions || player.id === currentUserId) return null;

        return (
            <div className="flex items-center space-x-2">
                {/* キックボタン（ホストのみ） */}
                {isHost && (
                    <Form method="post">
                        <input type="hidden" name="_action" value="kick" />
                        <input type="hidden" name="targetUserId" value={player.id} />
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-3 py-1 bg-red-100 text-red-800 rounded text-sm font-medium hover:bg-red-200 disabled:opacity-50 transition-colors"
                            onClick={(e) => {
                                if (!confirm(`${player.username}をキックしますか？`)) {
                                    e.preventDefault();
                                }
                            }}
                        >
                            キック
                        </button>
                    </Form>
                )}
            </div>
        );
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                    {mode === 'lobby' ? '参加者' : mode === 'game' ? 'プレイヤー' : '結果'}
                </h3>
                <div className="text-sm text-gray-500">
                    {players.length}人
                    {mode === 'lobby' && '/4人'}
                </div>
            </div>

            <div className="space-y-3">
                {players.map((player, index) => (
                    <div
                        key={player.id}
                        className={`
                            flex items-center justify-between p-3 rounded-lg border transition-all duration-200
                            ${player.isCurrentTurn && mode === 'game' ? 
                                'border-blue-300 bg-blue-50' : 
                                'border-gray-200 bg-gray-50 hover:bg-gray-100'}
                            ${player.id === currentUserId ? 'ring-2 ring-indigo-500 ring-opacity-50' : ''}
                        `}
                    >
                        <div className="flex items-center space-x-3 flex-1">
                            {/* プレイヤーカラーインジケーター */}
                            <div className={`w-4 h-4 rounded-full ${player.color} flex-shrink-0`} />

                            {/* アバター */}
                            {renderPlayerAvatar(player)}

                            {/* プレイヤー情報 */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                    <span className="font-medium text-gray-900 truncate">
                                        {formatPlayerName(player)}
                                    </span>
                                    {player.id === currentUserId && (
                                        <span className="text-xs text-indigo-600 font-medium">(あなた)</span>
                                    )}
                                </div>

                                {/* ステータスバッジ */}
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {renderStatusBadge(player)}
                                </div>

                                {/* 統計情報 */}
                                {showStats && (
                                    <div className="text-xs text-gray-500 mt-1">
                                        {getPlayerWins(player.id)}勝 
                                        {winStats.length > 0 && ` (勝率 ${getPlayerWinRate(player.id)}%)`}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* アクションボタン */}
                        {renderActionButtons(player)}

                        {/* 自分のアクション（準備完了切り替え） */}
                        {mode === 'lobby' && player.id === currentUserId && (
                            <Form method="post">
                                <input type="hidden" name="_action" value="toggle_ready" />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                                        player.isReady
                                            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                                    } disabled:opacity-50`}
                                >
                                    {player.isReady ? '準備解除' : '準備完了'}
                                </button>
                            </Form>
                        )}
                    </div>
                ))}
            </div>

            {/* ゲーム開始ボタン（ロビーモード、ホストのみ） */}
            {mode === 'lobby' && isHost && (
                <div className="mt-6 text-center">
                    <Form method="post">
                        <input type="hidden" name="_action" value="start_game" />
                        <button
                            type="submit"
                            disabled={
                                players.length < 2 || 
                                !players.every(p => p.isReady) || 
                                isSubmitting
                            }
                            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSubmitting ? 'ゲーム開始中...' : 'ゲーム開始'}
                        </button>
                        {(players.length < 2 || !players.every(p => p.isReady)) && (
                            <p className="mt-2 text-sm text-gray-500">
                                全員の準備完了が必要です（最低2人）
                            </p>
                        )}
                    </Form>
                </div>
            )}

            {/* 空きスロット表示（ロビーモード） */}
            {mode === 'lobby' && players.length < 4 && (
                <div className="mt-4 border-t border-gray-200 pt-4">
                    <div className="text-sm text-gray-500 text-center">
                        あと{4 - players.length}人参加可能
                    </div>
                </div>
            )}
        </div>
    );
}