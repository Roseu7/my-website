import { useState, useEffect, useRef } from "react";
import type { GameLog as GameLogType, Player } from "~//games/cant-stop/utils/types";
import { UI_SETTINGS } from "~/games/cant-stop/utils/constants";
import { formatGameDuration } from "~/games/cant-stop/utils/helpers";

interface GameLogProps {
    logs: GameLogType[];
    players: Player[];
    maxDisplayCount?: number;
    showTimestamps?: boolean;
    autoScroll?: boolean;
    className?: string;
}

export function GameLog({
    logs,
    players,
    maxDisplayCount = UI_SETTINGS.LOG_MAX_DISPLAY,
    showTimestamps = false,
    autoScroll = true,
    className = ""
}: GameLogProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [filter, setFilter] = useState<'all' | 'system' | 'player'>('all');
    const logContainerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // 自動スクロール
    useEffect(() => {
        if (autoScroll && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoScroll]);

    /**
     * プレイヤー情報を取得
     */
    const getPlayer = (playerId?: string): Player | null => {
        if (!playerId) return null;
        return players.find(p => p.id === playerId) || null;
    };

    /**
     * ログのフィルタリング
     */
    const getFilteredLogs = (): GameLogType[] => {
        let filteredLogs = [...logs];

        switch (filter) {
            case 'system':
                filteredLogs = logs.filter(log => !log.playerId);
                break;
            case 'player':
                filteredLogs = logs.filter(log => !!log.playerId);
                break;
            default:
                // 'all' - フィルタリングしない
                break;
        }

        // 表示数制限（展開時は制限なし）
        if (!isExpanded && maxDisplayCount > 0) {
            filteredLogs = filteredLogs.slice(-maxDisplayCount);
        }

        return filteredLogs;
    };

    /**
     * ログのアイコンを取得
     */
    const getLogIcon = (log: GameLogType): JSX.Element => {
        const message = log.message.toLowerCase();

        if (message.includes('サイコロ')) {
            return (
                <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth={2} />
                        <circle cx="9" cy="9" r="1" fill="currentColor" />
                        <circle cx="15" cy="15" r="1" fill="currentColor" />
                    </svg>
                </div>
            );
        }

        if (message.includes('完成') || message.includes('勝利')) {
            return (
                <div className="w-6 h-6 bg-yellow-100 rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                    </svg>
                </div>
            );
        }

        if (message.includes('バスト')) {
            return (
                <div className="w-6 h-6 bg-red-100 rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
            );
        }

        if (message.includes('組み合わせ') || message.includes('選択')) {
            return (
                <div className="w-6 h-6 bg-green-100 rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                    </svg>
                </div>
            );
        }

        if (message.includes('進行')) {
            return (
                <div className="w-6 h-6 bg-indigo-100 rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </div>
            );
        }

        // デフォルト（システムメッセージ）
        return (
            <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
        );
    };

    /**
     * タイムスタンプをフォーマット
     */
    const formatTimestamp = (timestamp?: string): string => {
        if (!timestamp) return '';
        
        try {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch {
            return '';
        }
    };

    /**
     * ログエントリをレンダリング
     */
    const renderLogEntry = (log: GameLogType, index: number) => {
        const player = getPlayer(log.playerId);
        const isPlayerAction = !!player;

        return (
            <div
                key={`${index}-${log.timestamp || index}`}
                className={`flex items-start space-x-3 p-2 rounded transition-colors hover:bg-gray-50 ${
                    isPlayerAction ? 'bg-blue-25' : ''
                }`}
            >
                {/* アイコン */}
                {getLogIcon(log)}

                {/* ログ内容 */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                        {/* プレイヤー名 */}
                        {player && (
                            <span className={`inline-flex items-center space-x-1 text-sm font-medium`}>
                                <div className={`w-3 h-3 rounded-full ${player.color}`} />
                                <span className="text-gray-900">{player.username}</span>
                            </span>
                        )}

                        {/* タイムスタンプ */}
                        {showTimestamps && log.timestamp && (
                            <span className="text-xs text-gray-500">
                                {formatTimestamp(log.timestamp)}
                            </span>
                        )}
                    </div>

                    {/* メッセージ */}
                    <p className={`text-sm ${isPlayerAction ? 'text-gray-700' : 'text-gray-600'} mt-1`}>
                        {log.message}
                    </p>
                </div>
            </div>
        );
    };

    const filteredLogs = getFilteredLogs();
    const hasMoreLogs = logs.length > maxDisplayCount;

    return (
        <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
            {/* ヘッダー */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">ゲームログ</h3>
                
                <div className="flex items-center space-x-2">
                    {/* フィルター */}
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as typeof filter)}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                    >
                        <option value="all">すべて</option>
                        <option value="system">システム</option>
                        <option value="player">プレイヤー</option>
                    </select>

                    {/* 展開/折りたたみボタン */}
                    {hasMoreLogs && (
                        <button
                            type="button"
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                            {isExpanded ? '折りたたむ' : 'すべて表示'}
                        </button>
                    )}
                </div>
            </div>

            {/* ログ一覧 */}
            <div
                ref={logContainerRef}
                className={`overflow-y-auto ${isExpanded ? 'max-h-96' : 'max-h-64'}`}
            >
                <div className="p-4 space-y-2">
                    {filteredLogs.length > 0 ? (
                        <>
                            {filteredLogs.map(renderLogEntry)}
                            <div ref={bottomRef} />
                        </>
                    ) : (
                        <div className="text-center text-gray-500 py-8">
                            <svg className="w-12 h-12 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-sm">まだログがありません</p>
                        </div>
                    )}
                </div>
            </div>

            {/* フッター（統計情報） */}
            <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
                <div className="flex justify-between items-center">
                    <span>総ログ数: {logs.length}</span>
                    <span>表示中: {filteredLogs.length}</span>
                </div>
            </div>
        </div>
    );
}