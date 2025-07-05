import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { useState, useEffect } from "react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { getRoomData, getGameState } from "~/libs/cant-stop/database.server";
import { 
    rollDice, 
    chooseCombination, 
    continueGame, 
    stopTurn 
} from "~/libs/cant-stop/game-logic.server";
import { createRealtimeClient, formatUserFromAuth } from "~/libs/cant-stop/realtime.client";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import type { 
    ClientGameState, 
    Player, 
    GameState as GameStateType,
    GameData 
} from "~/libs/cant-stop/types";
import { 
    getPlayerColor, 
    COLUMN_HEIGHTS, 
    GAME_SETTINGS 
} from "~/utils/cant-stop/constants";

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
    if (!roomResult.success) {
        return redirect("/games/cant-stop");
    }

    const { room, participants } = roomResult.data;

    // 現在のユーザーが参加者にいるかチェック
    const isParticipant = participants.some(p => p.user_id === user.id);
    if (!isParticipant) {
        return redirect("/games/cant-stop");
    }

    // ゲーム中でない場合はロビーにリダイレクト
    if (room.status !== 'playing') {
        return redirect(`/games/cant-stop/lobby/${roomId}`);
    }

    // ゲーム状態を取得
    const gameStateResult = await getGameState(request, roomId);
    if (!gameStateResult.success) {
        return redirect(`/games/cant-stop/lobby/${roomId}`);
    }

    const gameState = gameStateResult.data;

    // プレイヤー情報を構築
    const players: Player[] = participants.map((participant, index) => {
        const userData = formatUserFromAuth(participant.user);
        return {
            id: participant.user_id,
            username: userData?.username || 'Unknown User',
            avatar: userData?.avatar,
            color: getPlayerColor(index),
            isCurrentTurn: participant.user_id === gameState.current_turn_user_id,
            isHost: participant.user_id === room.host_user_id
        };
    });

    return json({
        user,
        room,
        players,
        gameState,
        isCurrentTurn: user.id === gameState.current_turn_user_id
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
        case "roll_dice": {
            const result = await rollDice(request, roomId, user.id);
            if (!result.success) {
                return json({ error: result.error });
            }
            
            // バストの場合は特別な処理
            if (!result.data.canContinue) {
                return json({ 
                    success: true, 
                    bust: true,
                    message: "バスト！進行可能な組み合わせがありません" 
                });
            }
            
            return json({ 
                success: true, 
                combinations: result.data.combinations 
            });
        }

        case "choose_combination": {
            const combinationStr = formData.get("combination")?.toString();
            if (!combinationStr) {
                return json({ error: "組み合わせが選択されていません" });
            }
            
            try {
                const combination = JSON.parse(combinationStr);
                const result = await chooseCombination(request, roomId, user.id, combination);
                
                if (!result.success) {
                    return json({ error: result.error });
                }
                
                return json({ success: true });
            } catch (error) {
                return json({ error: "不正な組み合わせです" });
            }
        }

        case "continue_game": {
            const result = await continueGame(request, roomId, user.id);
            if (!result.success) {
                return json({ error: result.error });
            }
            
            // ゲーム終了の場合は結果画面にリダイレクト
            if (result.data.gameEnded) {
                return redirect(`/games/cant-stop/result/${roomId}`);
            }
            
            return json({ success: true });
        }

        case "stop_turn": {
            const result = await stopTurn(request, roomId, user.id);
            if (!result.success) {
                return json({ error: result.error });
            }
            
            return json({ success: true });
        }

        case "exit_game":
            // ゲームから退出してロビーに戻る
            return redirect(`/games/cant-stop/lobby/${roomId}`);

        default:
            return json({ error: "不正なアクションです" });
    }
}

export default function CantStopGame() {
    const { 
        user, 
        room: initialRoom, 
        players: initialPlayers, 
        gameState: initialGameState, 
        isCurrentTurn: initialIsCurrentTurn 
    } = useLoaderData<typeof loader>();
    
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    // リアルタイム更新用の状態
    const [room, setRoom] = useState(initialRoom);
    const [players, setPlayers] = useState(initialPlayers);
    const [gameState, setGameState] = useState(initialGameState);
    const [isCurrentTurn, setIsCurrentTurn] = useState(initialIsCurrentTurn);
    const [availableCombinations, setAvailableCombinations] = useState<number[][]>([]);

    // リアルタイム通信の設定
    useEffect(() => {
        const realtimeClient = createRealtimeClient(room.id);

        // ゲーム状態の変更を監視
        realtimeClient.subscribeToGame({
            onGameStateChanged: (updatedGameState) => {
                setGameState(updatedGameState);
                setIsCurrentTurn(user.id === updatedGameState.current_turn_user_id);
                
                // 組み合わせ選択フェーズの場合、利用可能な組み合わせを計算
                if (updatedGameState.phase === 'choosing' && updatedGameState.game_data.diceValues) {
                    // TODO: ここで組み合わせを計算してsetAvailableCombinations
                }
            },
            onGameEnded: (result) => {
                // ゲーム終了時は結果画面に遷移
                window.location.href = `/games/cant-stop/result/${room.id}`;
            }
        });

        return () => {
            realtimeClient.unsubscribeAll();
        };
    }, [room.id, user.id]);

    // ゲームデータの取得
    const gameData: GameData = gameState.game_data || {
        columns: {},
        tempMarkers: {},
        completedColumns: {},
        diceValues: [],
        logs: []
    };

    // コラムを描画
    const renderColumn = (columnNumber: number) => {
        const height = COLUMN_HEIGHTS[columnNumber];
        const maxHeight = Math.max(...Object.values(COLUMN_HEIGHTS));
        
        // 中央揃えのための計算
        const centerLine = Math.ceil(maxHeight / 2);
        const columnCenter = Math.ceil(height / 2);
        const offset = centerLine - columnCenter;

        return (
            <div key={columnNumber} className="flex flex-col items-center">
                {/* コラム番号 */}
                <div className="text-lg font-bold text-gray-700 mb-2">{columnNumber}</div>
                
                {/* 上部スペース */}
                {offset > 0 && (
                    <div style={{ height: `${offset * 28}px` }}></div>
                )}
                
                {/* マス目 */}
                <div className="flex flex-col-reverse space-y-reverse space-y-1">
                    {Array.from({ length: height }, (_, i) => {
                        const step = i + 1;
                        const columnData = gameData.columns[columnNumber] || {};
                        
                        // このステップに到達したプレイヤーを取得
                        const playersAtStep = players.filter(player => {
                            const progress = columnData[player.id] || 0;
                            return progress >= step;
                        });

                        // 一時マーカーをチェック
                        let hasTemp = false;
                        let tempPlayer = null;
                        if (gameData.tempMarkers[columnNumber]) {
                            const tempPlayerId = gameData.tempMarkers[columnNumber];
                            const currentProgress = columnData[tempPlayerId] || 0;
                            if (step === currentProgress + 1) {
                                hasTemp = true;
                                tempPlayer = players.find(p => p.id === tempPlayerId);
                            }
                        }

                        return (
                            <div
                                key={step}
                                className={`w-8 h-6 border-2 border-gray-300 rounded relative overflow-hidden ${
                                    hasTemp ? 'ring-2 ring-yellow-400 ring-opacity-60' : ''
                                }`}
                            >
                                {playersAtStep.length > 0 ? (
                                    // 複数プレイヤーがいる場合は色を分割
                                    <div className="flex h-full w-full">
                                        {playersAtStep.map((player, index) => (
                                            <div
                                                key={player.id}
                                                className={`${player.color} flex-1`}
                                                style={{ 
                                                    width: `${100 / playersAtStep.length}%` 
                                                }}
                                            />
                                        ))}
                                    </div>
                                ) : hasTemp && tempPlayer ? (
                                    // 一時マーカーのみ
                                    <div className={`${tempPlayer.color} w-full h-full opacity-70`} />
                                ) : (
                                    // 空のマス
                                    <div className="bg-gray-100 w-full h-full" />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 下部スペース */}
                {(maxHeight - height - offset) > 0 && (
                    <div style={{ height: `${(maxHeight - height - offset) * 28}px` }}></div>
                )}
                
                {/* 進行状況 */}
                <div className="text-xs text-gray-500 mt-2">
                    {Object.entries(gameData.columns[columnNumber] || {}).map(([playerId, progress]) => {
                        const player = players.find(p => p.id === playerId);
                        return player ? (
                            <div key={playerId} className="flex items-center space-x-1">
                                <div className={`w-3 h-3 rounded-full ${player.color}`}></div>
                                <span>{progress}</span>
                            </div>
                        ) : null;
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            <main className="flex-1 mx-auto max-w-7xl px-6 py-8 lg:px-8">
                {/* ゲームタイトル */}
                <div className="text-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Can't Stop</h1>
                    <div className="text-lg text-gray-600">
                        現在のターン: 
                        <span className="ml-2 font-semibold text-indigo-600">
                            {players.find(p => p.id === gameState.current_turn_user_id)?.username}
                        </span>
                    </div>
                </div>

                {/* エラーメッセージ */}
                {actionData?.error && (
                    <div className="mb-4 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700 text-center">
                        {actionData.error}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* メインゲームボード */}
                    <div className="lg:col-span-3">
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <h2 className="text-xl font-semibold text-center mb-6">ゲームボード</h2>
                            
                            {/* ボード */}
                            <div className="flex justify-center space-x-4 overflow-x-auto pb-4">
                                {Object.keys(COLUMN_HEIGHTS).map(col => renderColumn(parseInt(col)))}
                            </div>
                        </div>

                        {/* ゲームコントロール */}
                        <div className="mt-6 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* サイコロエリア */}
                                <div>
                                    <h3 className="text-lg font-medium mb-4">サイコロ</h3>
                                    <div className="flex flex-wrap justify-center gap-3 mb-4">
                                        {gameData.diceValues.map((value, index) => (
                                            <div
                                                key={index}
                                                className="w-12 h-12 bg-white border-2 border-gray-300 rounded-lg flex items-center justify-center text-xl font-bold shadow-sm"
                                            >
                                                {value}
                                            </div>
                                        ))}
                                    </div>
                                    
                                    {gameState.phase === 'rolling' && isCurrentTurn && (
                                        <Form method="post">
                                            <input type="hidden" name="_action" value="roll_dice" />
                                            <button
                                                type="submit"
                                                disabled={navigation.state === "submitting"}
                                                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                                            >
                                                サイコロを振る
                                            </button>
                                        </Form>
                                    )}
                                </div>

                                {/* 組み合わせ選択 */}
                                <div>
                                    <h3 className="text-lg font-medium mb-4">組み合わせ選択</h3>
                                    {gameState.phase === 'choosing' && isCurrentTurn ? (
                                        <div className="space-y-3">
                                            {/* TODO: 利用可能な組み合わせを表示 */}
                                            <div className="text-gray-500 text-center py-4">
                                                組み合わせを選択してください
                                            </div>
                                        </div>
                                    ) : gameState.phase === 'deciding' && isCurrentTurn ? (
                                        <div className="space-y-3">
                                            <div className="p-3 bg-yellow-100 border border-yellow-300 rounded-lg text-center">
                                                選択中の組み合わせ
                                            </div>
                                            <Form method="post" className="space-y-2">
                                                <input type="hidden" name="_action" value="continue_game" />
                                                <button
                                                    type="submit"
                                                    className="w-full p-3 bg-green-100 hover:bg-green-200 border border-green-300 rounded-lg transition-colors font-medium"
                                                >
                                                    進む
                                                </button>
                                            </Form>
                                            <Form method="post">
                                                <input type="hidden" name="_action" value="stop_turn" />
                                                <button
                                                    type="submit"
                                                    className="w-full p-3 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg transition-colors font-medium"
                                                >
                                                    ストップ
                                                </button>
                                            </Form>
                                        </div>
                                    ) : gameState.phase === 'busting' ? (
                                        <div className="text-center py-8">
                                            <div className="text-red-600 font-medium mb-2">バスト！</div>
                                            <div className="text-gray-500 text-sm">進行可能な組み合わせがありません</div>
                                            <div className="text-gray-500 text-sm">一時進行をリセット中...</div>
                                        </div>
                                    ) : (
                                        <div className="text-gray-500 text-center py-8">
                                            {isCurrentTurn ? 'サイコロを振ってください' : '他のプレイヤーのターンです'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 参加者一覧・情報パネル */}
                    <div className="space-y-6">
                        {/* 参加者一覧 */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <h3 className="text-lg font-medium mb-4">参加者</h3>
                            <div className="space-y-3">
                                {players.map((player) => (
                                    <div
                                        key={player.id}
                                        className={`flex items-center space-x-3 p-3 rounded-lg border-2 ${
                                            player.isCurrentTurn 
                                                ? 'border-indigo-500 bg-indigo-50' 
                                                : 'border-gray-200 bg-gray-50'
                                        }`}
                                    >
                                        {/* プレイヤーカラー */}
                                        <div className={`w-4 h-4 rounded-full ${player.color}`}></div>
                                        
                                        {/* アバター */}
                                        {player.avatar ? (
                                            <img 
                                                src={player.avatar} 
                                                alt={player.username}
                                                className="w-8 h-8 rounded-full"
                                            />
                                        ) : (
                                            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                                                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                </svg>
                                            </div>
                                        )}
                                        
                                        {/* ユーザー名 */}
                                        <span className={`font-medium ${
                                            player.isCurrentTurn ? 'text-indigo-700' : 'text-gray-900'
                                        }`}>
                                            {player.username}
                                        </span>
                                        
                                        {/* ターン表示 */}
                                        {player.isCurrentTurn && (
                                            <span className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-full">
                                                ターン中
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ゲーム情報 */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <h3 className="text-lg font-medium mb-4">ゲーム情報</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">完成コラム:</span>
                                    <span className="font-medium">{Object.keys(gameData.completedColumns).length}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">アクティブマーカー:</span>
                                    <span className="font-medium">{Object.keys(gameData.tempMarkers).length}/3</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">ターン数:</span>
                                    <span className="font-medium">{gameState.turn_number}</span>
                                </div>
                            </div>
                        </div>

                        {/* アクション */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <div className="space-y-3">
                                <button className="w-full h-10 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center justify-center">
                                    設定
                                </button>
                                <Form method="post">
                                    <input type="hidden" name="_action" value="exit_game" />
                                    <button 
                                        type="submit"
                                        className="w-full h-10 px-4 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors flex items-center justify-center"
                                    >
                                        退出
                                    </button>
                                </Form>
                            </div>
                        </div>

                        {/* ゲームログ */}
                        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-6 min-w-60">
                            <h3 className="text-lg font-medium mb-4">ゲームログ</h3>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                                {gameData.logs.slice(-8).map((log, index) => {
                                    const player = log.playerId ? players.find(p => p.id === log.playerId) : null;
                                    
                                    return (
                                        <div 
                                            key={index} 
                                            className="text-sm text-gray-700 py-2 px-3 border border-gray-100 rounded bg-white flex items-start space-x-3"
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
                                                {log.message}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}