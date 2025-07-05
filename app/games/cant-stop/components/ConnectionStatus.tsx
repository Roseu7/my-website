import { useState, useEffect } from "react";

interface ConnectionState {
    room: 'disconnected' | 'connecting' | 'connected' | 'error';
    game: 'disconnected' | 'connecting' | 'connected' | 'error';
    lastError?: string;
}

interface ConnectionStatusProps {
    connectionState: ConnectionState;
    onReconnect?: () => void;
}

export function ConnectionStatus({ connectionState, onReconnect }: ConnectionStatusProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    // 接続に問題がある場合のみ表示
    useEffect(() => {
        const hasIssues = 
            connectionState.room === 'error' || 
            connectionState.game === 'error' ||
            connectionState.room === 'disconnected' ||
            connectionState.game === 'disconnected';
        
        setIsVisible(hasIssues);
    }, [connectionState]);

    if (!isVisible) return null;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'connected':
                return 'text-green-600 bg-green-100';
            case 'connecting':
                return 'text-yellow-600 bg-yellow-100';
            case 'error':
                return 'text-red-600 bg-red-100';
            case 'disconnected':
            default:
                return 'text-gray-600 bg-gray-100';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'connected':
                return (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                );
            case 'connecting':
                return (
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                );
            case 'error':
                return (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case 'disconnected':
            default:
                return (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-12.728 12.728m0 0L5.636 18.364m12.728 0L5.636 5.636" />
                    </svg>
                );
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'connected': return '接続済み';
            case 'connecting': return '接続中';
            case 'error': return 'エラー';
            case 'disconnected': return '切断';
            default: return '不明';
        }
    };

    const hasError = connectionState.room === 'error' || connectionState.game === 'error';
    const isDisconnected = connectionState.room === 'disconnected' || connectionState.game === 'disconnected';

    return (
        <div className="fixed top-4 right-4 z-50">
            <div className={`bg-white rounded-lg shadow-lg border-2 p-4 max-w-sm ${
                hasError ? 'border-red-300' : isDisconnected ? 'border-yellow-300' : 'border-gray-300'
            }`}>
                {/* ヘッダー */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${
                            hasError ? 'bg-red-500' : isDisconnected ? 'bg-yellow-500' : 'bg-green-500'
                        }`}></div>
                        <span className="font-medium text-gray-900">
                            {hasError ? '接続エラー' : isDisconnected ? '接続不良' : '接続中'}
                        </span>
                    </div>
                    <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <svg className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>

                {/* 状態表示 */}
                {showDetails && (
                    <div className="space-y-2 mb-3">
                        {/* ルーム接続状態 */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">ルーム:</span>
                            <div className={`flex items-center space-x-1 px-2 py-1 rounded text-xs ${getStatusColor(connectionState.room)}`}>
                                {getStatusIcon(connectionState.room)}
                                <span>{getStatusText(connectionState.room)}</span>
                            </div>
                        </div>

                        {/* ゲーム接続状態 */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">ゲーム:</span>
                            <div className={`flex items-center space-x-1 px-2 py-1 rounded text-xs ${getStatusColor(connectionState.game)}`}>
                                {getStatusIcon(connectionState.game)}
                                <span>{getStatusText(connectionState.game)}</span>
                            </div>
                        </div>

                        {/* エラー詳細 */}
                        {connectionState.lastError && (
                            <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                                エラー: {connectionState.lastError}
                            </div>
                        )}
                    </div>
                )}

                {/* アクションボタン */}
                {(hasError || isDisconnected) && onReconnect && (
                    <button
                        onClick={onReconnect}
                        className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors"
                    >
                        再接続
                    </button>
                )}

                {/* 簡単な説明 */}
                {!showDetails && (
                    <p className="text-xs text-gray-500 mt-2">
                        {hasError 
                            ? '接続に問題があります' 
                            : isDisconnected 
                            ? 'サーバーとの接続が不安定です'
                            : '接続を確認中です'
                        }
                    </p>
                )}
            </div>
        </div>
    );
}