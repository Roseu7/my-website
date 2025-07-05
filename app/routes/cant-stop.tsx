import { useState } from "react";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";

// プレイヤー情報
interface Player {
    id: string;
    username: string;
    avatar?: string;
    color: string;
}

// 勝利統計
interface WinStats {
    playerId: string;
    wins: number;
}

// 結果画面の状態
interface ResultState {
    winner: Player;
    players: Player[];
    winStats: WinStats[];
    roomId: string;
    gameHistory: { message: string; playerId?: string }[];
}

export default function CantStopResult() {
    // 仮の結果データ
    const [resultState] = useState<ResultState>({
        winner: {
            id: 'player2',
            username: 'プレイヤー2',
            color: 'bg-blue-500'
        },
        players: [
            { id: 'player1', username: 'あなた', color: 'bg-red-500' },
            { id: 'player2', username: 'プレイヤー2', color: 'bg-blue-500' },
            { id: 'player3', username: 'プレイヤー3', color: 'bg-green-500' }
        ],
        winStats: [
            { playerId: 'player1', wins: 2 },
            { playerId: 'player2', wins: 3 },
            { playerId: 'player3', wins: 1 }
        ],
        roomId: 'test123',
        gameHistory: [
            { message: 'ゲーム開始' },
            { message: 'コラム2を完成', playerId: 'player1' },
            { message: 'コラム7を完成', playerId: 'player2' },
            { message: 'コラム10を完成', playerId: 'player3' },
            { message: 'コラム3を完成', playerId: 'player2' },
            { message: 'コラム11を完成', playerId: 'player2' },
            { message: '3つのコラムを完成させて勝利！', playerId: 'player2' }
        ]
    });

    // ロビーに戻る
    const returnToLobby = () => {
        console.log("ロビーに戻る");
        // TODO: ロビー画面に遷移
        alert("ロビーに戻ります（実装予定）");
    };

    // 再ゲーム（ホストのみ）
    const startNewGame = () => {
        console.log("新しいゲーム開始");
        // TODO: 新しいゲーム開始処理
        alert("新しいゲームを開始します（実装予定）");
    };

    // 勝利統計をソート（勝利数順）
    const sortedStats = [...resultState.winStats]
        .sort((a, b) => b.wins - a.wins)
        .map(stat => ({
            ...stat,
            player: resultState.players.find(p => p.id === stat.playerId)!
        }));

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={{ id: "1", username: "あなた" }} />

            <main className="flex-1 mx-auto max-w-6xl px-6 py-8 lg:px-8">
                {/* 勝者発表 */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-6">ゲーム終了！</h1>
                    
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-8 max-w-2xl mx-auto">
                        {/* 勝者アバター */}
                        <div className="flex justify-center mb-6">
                            <div className="relative">
                                {resultState.winner.avatar ? (
                                    <img 
                                        src={resultState.winner.avatar} 
                                        alt={resultState.winner.username}
                                        className="w-24 h-24 rounded-full border-4 border-yellow-400"
                                    />
                                ) : (
                                    <div className="w-24 h-24 bg-gray-300 rounded-full border-4 border-yellow-400 flex items-center justify-center">
                                        <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    </div>
                                )}
                                {/* 王冠アイコン */}
                                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                                    <svg className="w-8 h-8 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 6L9 9L6 6L3 9v11h18V9l-3-3-3 3-3-3z"/>
                                    </svg>
                                </div>
                            </div>
                        </div>

                        {/* 勝者名とカラー */}
                        <div className="flex items-center justify-center space-x-3 mb-4">
                            <div className={`w-6 h-6 rounded-full ${resultState.winner.color}`}></div>
                            <h2 className="text-3xl font-bold text-gray-900">
                                {resultState.winner.username}
                            </h2>
                        </div>
                        
                        <p className="text-xl text-gray-600 mb-6">勝利おめでとうございます！</p>
                        
                        {/* 勝利条件達成メッセージ */}
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <p className="text-yellow-800 font-medium">
                                3つのコラムを完成させて勝利！
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* 勝利統計 */}
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                        <h3 className="text-xl font-semibold mb-6 text-center">
                            ルーム「{resultState.roomId}」勝利統計
                        </h3>
                        
                        <div className="space-y-4">
                            {sortedStats.map((stat, index) => (
                                <div
                                    key={stat.playerId}
                                    className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                                        index === 0 
                                            ? 'border-yellow-400 bg-yellow-50' 
                                            : 'border-gray-200 bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center space-x-3">
                                        {/* 順位 */}
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                            index === 0 ? 'bg-yellow-500 text-white' :
                                            index === 1 ? 'bg-gray-400 text-white' :
                                            index === 2 ? 'bg-orange-600 text-white' :
                                            'bg-gray-300 text-gray-700'
                                        }`}>
                                            {index + 1}
                                        </div>
                                        
                                        {/* プレイヤー情報 */}
                                        <div className={`w-4 h-4 rounded-full ${stat.player.color}`}></div>
                                        
                                        {stat.player.avatar ? (
                                            <img 
                                                src={stat.player.avatar} 
                                                alt={stat.player.username}
                                                className="w-10 h-10 rounded-full"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                                                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                </svg>
                                            </div>
                                        )}
                                        
                                        <span className="font-medium text-gray-900">
                                            {stat.player.username}
                                        </span>
                                    </div>
                                    
                                    {/* 勝利数 */}
                                    <div className="flex items-center space-x-2">
                                        <span className="text-2xl font-bold text-gray-900">
                                            {stat.wins}
                                        </span>
                                        <span className="text-sm text-gray-500">勝</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        {/* 総ゲーム数 */}
                        <div className="mt-6 pt-4 border-t border-gray-200 text-center">
                            <p className="text-gray-600">
                                総ゲーム数: <span className="font-semibold">
                                    {resultState.winStats.reduce((sum, stat) => sum + stat.wins, 0)}
                                </span>
                            </p>
                        </div>
                    </div>

                    {/* ゲーム履歴 */}
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                        <h3 className="text-xl font-semibold mb-6 text-center">
                            今回のゲーム履歴
                        </h3>
                        
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {resultState.gameHistory.map((event, index) => {
                                const player = event.playerId ? resultState.players.find(p => p.id === event.playerId) : null;
                                
                                return (
                                    <div 
                                        key={index}
                                        className="flex items-start space-x-3 text-sm text-gray-700 py-2 px-3 bg-white rounded border"
                                    >
                                        <div 
                                            className={`w-1 h-full min-h-[1.25rem] rounded-full flex-shrink-0 ${
                                                player ? player.color : 'bg-gray-300'
                                            }`} 
                                        />
                                        <span className="flex-1">
                                            {player && (
                                                <span className="font-medium">{player.username}が</span>
                                            )}
                                            {event.message}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* アクションボタン */}
                <div className="mt-8 flex justify-center">
                    <button
                        onClick={returnToLobby}
                        className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center"
                    >
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        ロビーに戻る
                    </button>
                </div>
            </main>

            <Footer />
        </div>
    );
}