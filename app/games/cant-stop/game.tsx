import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { useState, useEffect } from "react";
import { getUserFromSession } from "~/utils/supabase-auth.server";
import { getRoomData, getGameState } from "~/games/cant-stop/utils/database.server";
import { 
    rollDice, 
    chooseCombination, 
    continueGame, 
    stopTurn 
} from "~/games/cant-stop/utils/game-logic.server";
import { createRealtimeClient } from "~/games/cant-stop/utils/realtime.client";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { 
    GameBoard, 
    DiceRoller, 
    PlayerList, 
    GameLog 
} from "~/games/cant-stop/components";
import type { 
    ClientGameState, 
    Player, 
    GameState as GameStateType,
    GameData,
    RoomParticipant,
    User 
} from "~/games/cant-stop/utils/types";
import { 
    getPlayerColor, 
    COLUMN_HEIGHTS, 
    GAME_SETTINGS 
} from "~/games/cant-stop/utils/constants";
// アクションレスポンスの型定義
interface ActionData {
    success?: boolean;
    error?: string;
    bust?: boolean;
    message?: string;
    gameEnded?: boolean;
    winner?: string;
    combinations?: number[][];
    diceValues?: number[];
}

// サイコロの組み合わせを計算するローカル関数
function calculateDiceCombinations(diceValues: number[]): number[][] {
    if (diceValues.length !== 4) return [];
    
    const [d1, d2, d3, d4] = diceValues;
    
    // 3つの可能な組み合わせ
    return [
        [d1 + d2, d3 + d4].sort((a, b) => a - b),
        [d1 + d3, d2 + d4].sort((a, b) => a - b),
        [d1 + d4, d2 + d3].sort((a, b) => a - b)
    ];
}

// 進行可能な組み合わせをフィルタリングするローカル関数
function getValidCombinations(
    allCombinations: number[][],
    gameData: GameData,
    playerId: string
): number[][] {
    return allCombinations.filter(combination => {
        // 一時マーカーが3つ使用されている場合、既に一時マーカーがあるコラムのみ
        const currentTempColumns = Object.keys(gameData.tempMarkers || {});
        
        if (currentTempColumns.length >= GAME_SETTINGS.MAX_TEMP_MARKERS) {
            // 全てのコラムが既に一時マーカーを持っている場合のみ許可
            return combination.every(column => 
                gameData.tempMarkers?.[column] === playerId
            );
        }
        
        // 新しいコラム数を計算（重複排除）
        const uniqueNewColumns = [...new Set(combination)].filter(col => 
            !currentTempColumns.includes(col.toString())
        );
        
        // 制限を超える場合は無効
        if (currentTempColumns.length + uniqueNewColumns.length > GAME_SETTINGS.MAX_TEMP_MARKERS) {
            return false;
        }
        
        // 完成したコラムは使用不可
        return combination.every(column => 
            !gameData.completedColumns?.[column]
        );
    });
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
    const roomResult = await getRoomData(request, roomId);
    if (!roomResult.success || !roomResult.data) {
        return redirect("/games/cant-stop");
    }

    const { room, participants } = roomResult.data;

    // 現在のユーザーが参加者にいるかチェック
    const isParticipant = participants.some((p: RoomParticipant & { user: User | null }) => p.user_id === user.id);
    if (!isParticipant) {
        return redirect("/games/cant-stop");
    }

    // ゲーム中でない場合はロビーにリダイレクト
    if (room.status !== 'playing') {
        return redirect(`/games/cant-stop/lobby/${room.room_id}`);
    }

    // ゲーム状態を取得
    const gameStateResult = await getGameState(request, roomId);
    if (!gameStateResult.success || !gameStateResult.data) {
        return redirect(`/games/cant-stop/lobby/${room.room_id}`);
    }

    const gameState = gameStateResult.data;

    // ユーザー情報整形関数（インライン）
    const formatUserFromAuth = (authUser: User | any): { id: string; username: string; avatar?: string } => ({
        id: authUser.id,
        username: authUser.username || authUser.user_metadata?.username || authUser.email?.split('@')[0] || 'Unknown',
        avatar: authUser.avatar || authUser.user_metadata?.avatar_url
    });

    // プレイヤー情報を作成
    const players: Player[] = participants
        .filter((p: RoomParticipant & { user: User | null }) => p.user)
        .map((p: RoomParticipant & { user: User | null }, index: number) => {
            const userInfo = formatUserFromAuth(p.user!);
            return {
                ...userInfo,
                color: getPlayerColor(index),
                isCurrentTurn: gameState.current_turn_user_id === p.user_id,
                isReady: p.is_ready,
                isHost: room.host_user_id === p.user_id
            };
        });

    const currentUser = formatUserFromAuth(user);
    const isCurrentTurn = gameState.current_turn_user_id === user.id;

    return json({
        user: currentUser,
        room,
        players,
        gameState,
        isCurrentTurn
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

    console.log('Game Action:', { action, roomId, userId: user.id });

    switch (action) {
        case "roll_dice": {
            console.log('Rolling dice for user:', user.id);
            
            const result = await rollDice(request, roomId, user.id);
            
            console.log('Roll dice result:', result);
            
            if (!result.success) {
                return json({ error: result.error }, { status: 400 });
            }
            
            // バストの場合は特別な処理
            if (!result.data?.canContinue) {
                return json({ 
                    success: true, 
                    bust: true,
                    message: "バスト！進行可能な組み合わせがありません" 
                });
            }
            
            return json({ 
                success: true, 
                combinations: result.data?.combinations || [],
                diceValues: result.data?.diceValues || []
            });
        }

        case "choose_combination": {
            const combinationStr = formData.get("combination")?.toString();
            if (!combinationStr) {
                console.error('組み合わせが選択されていません');
                return json({ error: "組み合わせが選択されていません" }, { status: 400 });
            }
            
            try {
                const combination = JSON.parse(combinationStr);
                console.log('Choosing combination:', combination);
                
                // 組み合わせが配列で正しい形式かチェック
                if (!Array.isArray(combination) || combination.length !== 2) {
                    console.error('無効な組み合わせ形式:', combination);
                    return json({ error: "無効な組み合わせです" }, { status: 400 });
                }
                
                const result = await chooseCombination(request, roomId, user.id, combination);
                
                console.log('Choose combination result:', result);
                
                if (!result.success) {
                    console.error('組み合わせ選択エラー:', result.error);
                    return json({ error: result.error }, { status: 400 });
                }
                
                return json({ success: true });
            } catch (error) {
                console.error('組み合わせ選択処理エラー:', error);
                return json({ error: "組み合わせの処理中にエラーが発生しました" }, { status: 400 });
            }
        }

        case "continue": {
            console.log('Continue game for user:', user.id);
            
            const result = await continueGame(request, roomId, user.id);
            
            if (!result.success) {
                return json({ error: result.error }, { status: 400 });
            }
            
            return json({ 
                success: true,
                gameEnded: result.data?.gameEnded || false,
                winner: result.data?.winner
            });
        }

        case "stop": {
            console.log('Stop turn for user:', user.id);
            
            const result = await stopTurn(request, roomId, user.id);
            
            if (!result.success) {
                return json({ error: result.error }, { status: 400 });
            }
            
            return json({ 
                success: true,
                gameEnded: result.data?.gameEnded || false,
                winner: result.data?.winner
            });
        }

        default:
            return json({ error: "無効なアクションです" }, { status: 400 });
    }
}

export default function Game() {
    const { user, room, players, gameState, isCurrentTurn } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>() as ActionData | undefined;
    const navigation = useNavigation();
    
    // 状態管理
    const [connectionState, setConnectionState] = useState<"connected" | "disconnected" | "error">("disconnected");
    const [availableCombinations, setAvailableCombinations] = useState<number[][]>([]);
    const [selectedCombination, setSelectedCombination] = useState<number[] | null>(null);
    const [diceRolling, setDiceRolling] = useState(false);
    const [isRollingDisabled, setIsRollingDisabled] = useState(false);

    const isSubmitting = navigation.state === "submitting";
    
    // サイコロボタンの無効化制御
    const isDiceButtonDisabled = isSubmitting || diceRolling || isRollingDisabled || !isCurrentTurn || gameState?.phase !== 'rolling';

    // リアルタイム通信の設定
    useEffect(() => {
        let realtimeClient: ReturnType<typeof createRealtimeClient> | null = null;
        let isActive = true;

        // 初期化を少し遅延させる
        const initTimeout = setTimeout(() => {
            if (isActive) {
                console.log('リアルタイムクライアントを初期化します');
                realtimeClient = createRealtimeClient(room.room_id);

                realtimeClient.subscribeToGame({
                    onGameStateChanged: (newGameState: GameStateType) => {
                        if (isActive) {
                            console.log('ゲーム状態が更新されました:', newGameState);
                            // 即座にページをリロード
                            window.location.reload();
                        }
                    },
                    onGameEnded: (data: any) => {
                        if (isActive) {
                            console.log('ゲーム終了:', data);
                            window.location.href = `/games/cant-stop/result/${room.room_id}`;
                        }
                    },
                    onConnectionStateChanged: (state: any) => {
                        if (isActive) {
                            console.log('接続状態変更:', state);
                            setConnectionState(
                                state.game === 'connected' ? 'connected' : 
                                state.game === 'error' ? 'error' : 'disconnected'
                            );
                        }
                    }
                });
            }
        }, 500);

        // クリーンアップ関数
        return () => {
            isActive = false;
            clearTimeout(initTimeout);
            
            if (realtimeClient) {
                // クリーンアップを遅延実行
                setTimeout(() => {
                    console.log('リアルタイムクライアントをクリーンアップします');
                    realtimeClient?.cleanup();
                }, 100);
            }
        };
    }, [room.room_id]); // user.idを除去してdependencyを減らす

    // ゲームデータの取得（安全なアクセス）
    const gameData: GameData = gameState?.game_data || {
        columns: {},
        tempMarkers: {},
        completedColumns: {},
        diceValues: [],
        logs: []
    };

    // サイコロの値を表示するかどうか（より厳密に制御）
    const shouldShowDiceValues = gameData.diceValues.length === 4 && 
                                (gameState?.phase === 'choosing' || 
                                 gameState?.phase === 'deciding' || 
                                 gameState?.phase === 'stopped' ||
                                 gameState?.phase === 'busting');
                                 
    // 表示用のサイコロ値（一度決まったら変更されない）
    const [displayDiceValues, setDisplayDiceValues] = useState<number[]>([]);
    const [lastGameStateId, setLastGameStateId] = useState<string>('');
    
    // サイコロの値が確定した時のみ表示値を更新（gameStateのIDで重複防止）
    useEffect(() => {
        if (gameState?.id && gameState.id !== lastGameStateId) {
            if (gameState.phase === 'choosing' && gameData.diceValues.length === 4) {
                console.log('サイコロ値を固定:', gameData.diceValues);
                setDisplayDiceValues([...gameData.diceValues]);
                setLastGameStateId(gameState.id);
            } else if (gameState.phase === 'rolling') {
                console.log('サイコロ値をクリア');
                setDisplayDiceValues([]);
            }
        }
    }, [gameState?.id, gameState?.phase, gameData.diceValues, lastGameStateId]);

    // 組み合わせ選択処理
    const handleCombinationSelect = (combination: number[]) => {
        console.log('組み合わせが選択されました:', combination);
        console.log('現在のゲーム状態:', gameState);
        console.log('現在のターン:', isCurrentTurn);
        setSelectedCombination(combination);
    };

    // フェーズに応じた表示テキスト
    const getPhaseText = (): string => {
        if (!gameState) return '';
        
        const currentPlayer = players.find(p => p.id === gameState.current_turn_user_id);
        
        switch (gameState.phase) {
            case 'rolling':
                return isCurrentTurn ? 'サイコロを振ってください' : `${currentPlayer?.username}のターン - サイコロを振っています`;
            case 'choosing':
                return isCurrentTurn ? '組み合わせを選択してください' : `${currentPlayer?.username}のターン - 組み合わせを選択中`;
            case 'deciding':
                return isCurrentTurn ? '進むかストップするかを選択してください' : `${currentPlayer?.username}のターン - 進行を決定中`;
            case 'finished':
                const winner = players.find(p => p.id === gameState.current_turn_user_id);
                return `ゲーム終了！${winner?.username}の勝利！`;
            default:
                return '';
        }
    };

    // フェーズに応じた利用可能な組み合わせを計算
    const getAvailableCombinations = (): number[][] => {
        if (gameState?.phase === 'choosing' && gameData.diceValues.length === 4) {
            try {
                const allCombinations = calculateDiceCombinations(gameData.diceValues);
                return getValidCombinations(allCombinations, gameData, user.id);
            } catch (error) {
                console.error('組み合わせ計算エラー:', error);
                return [];
            }
        }
        return [];
    };

    const currentAvailableCombinations = getAvailableCombinations();

    // アクション後の処理
    useEffect(() => {
        if (actionData) {
            console.log('アクション結果:', actionData);
            
            if (actionData.bust) {
                // バストの場合は状態をリセット
                setAvailableCombinations([]);
                setSelectedCombination(null);
                setDiceRolling(false);
                setIsRollingDisabled(false);
            } else if (actionData.gameEnded) {
                // ゲーム終了の場合は結果画面にリダイレクト
                window.location.href = `/games/cant-stop/result/${room.room_id}`;
            } else if (actionData.success) {
                // 成功時は状態をリセット
                if (gameState?.phase === 'deciding') {
                    setSelectedCombination(null);
                }
                // サイコロ振り成功時
                if (actionData.combinations && Array.isArray(actionData.combinations)) {
                    console.log('サイコロ振り成功 - 組み合わせを設定');
                    setAvailableCombinations(actionData.combinations);
                    setDiceRolling(false);
                    setIsRollingDisabled(false);
                }
                // 組み合わせ選択成功時
                if (navigation.formData?.get('_action') === 'choose_combination') {
                    console.log('組み合わせ選択成功');
                    setDiceRolling(false);
                    setIsRollingDisabled(false);
                }
            } else if (actionData.error) {
                // エラー時も状態をリセット
                console.error('アクションエラー:', actionData.error);
                setDiceRolling(false);
                setIsRollingDisabled(false);
            }
        }
    }, [actionData, room.room_id, gameState?.phase, navigation.formData]);

    // フォーム送信前の処理
    const handleDiceRoll = (event: React.FormEvent<HTMLFormElement>) => {
        if (isDiceButtonDisabled) {
            event.preventDefault();
            return false;
        }
        
        console.log('サイコロを振ります');
        setDiceRolling(true);
        setIsRollingDisabled(true);
        setAvailableCombinations([]);
        setSelectedCombination(null);
        setDisplayDiceValues([]); // サイコロ表示をクリア
        
        // 一定時間後に再有効化（フェイルセーフ）
        setTimeout(() => {
            if (gameState?.phase === 'rolling') {
                console.log('サイコロ振りのタイムアウト - 状態をリセット');
                setDiceRolling(false);
                setIsRollingDisabled(false);
            }
        }, 8000); // 8秒に延長
    };

    // ゲーム状態変更時の処理
    useEffect(() => {
        if (gameState?.phase === 'choosing') {
            // choosingフェーズになったらサイコロ振り状態を解除
            console.log('choosing フェーズに移行 - サイコロ振り状態を解除');
            setDiceRolling(false);
            setIsRollingDisabled(false);
        } else if (gameState?.phase === 'rolling' && !isCurrentTurn) {
            // 他の人のターンになったら状態をリセット
            console.log('他の人のターンに移行 - 状態をリセット');
            setDiceRolling(false);
            setIsRollingDisabled(false);
            setAvailableCombinations([]);
            setSelectedCombination(null);
        }
    }, [gameState?.phase, isCurrentTurn]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            {/* ゲームメインコンテンツ */}
            <main className="flex-1 mx-auto max-w-7xl px-6 py-8 lg:px-8">
                {/* ゲーム状態表示 */}
                <div className="mb-6 text-center">
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Can't Stop</h1>
                    <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 p-4">
                        <p className="text-lg font-medium text-gray-800">
                            {getPhaseText()}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                            ターン {gameState?.turn_number || 1} - ルーム: {room.room_id}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 左カラム: ゲームボードとサイコロ */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* ゲームボード */}
                        <GameBoard
                            gameData={gameData}
                            players={players}
                            key={`${gameState?.updated_at}-${JSON.stringify(gameData.tempMarkers)}`}
                        />

                        {/* サイコロエリア */}
                        <DiceRoller
                            diceValues={displayDiceValues}
                            isRolling={diceRolling}
                            canRoll={!isDiceButtonDisabled}
                            showCombinations={gameState?.phase === 'choosing'}
                            availableCombinations={currentAvailableCombinations}
                            selectedCombination={selectedCombination}
                            onCombinationSelect={handleCombinationSelect}
                            isSubmitting={isSubmitting}
                            onDiceRoll={handleDiceRoll}
                            gamePhase={gameState?.phase}
                            isCurrentTurn={isCurrentTurn}
                        />

                    </div>

                    {/* 右カラム: プレイヤーリストとログ */}
                    <div className="space-y-6">
                        {/* プレイヤーリスト */}
                        <PlayerList
                            players={players}
                            currentUserId={user.id}
                            mode="game"
                        />

                        {/* ゲームログ */}
                        <GameLog
                            logs={gameData.logs || []}
                            players={players}
                            maxDisplayCount={8}
                            showTimestamps={false}
                            autoScroll={true}
                        />
                    </div>
                </div>

                {/* 接続状態表示（デバッグ用） */}
                {connectionState !== 'connected' && (
                    <div className="fixed bottom-4 right-4">
                        <div className={`px-4 py-2 rounded-lg text-sm font-medium ${
                            connectionState === 'error' 
                                ? 'bg-red-100 text-red-800' 
                                : 'bg-yellow-100 text-yellow-800'
                        }`}>
                            {connectionState === 'error' ? '接続エラー' : '接続中...'}
                        </div>
                    </div>
                )}

                {/* ゲーム状態デバッグ（開発用） */}
                {process.env.NODE_ENV === 'development' && (
                    <div className="fixed bottom-4 left-4 bg-white p-4 rounded-lg shadow border text-xs max-w-sm">
                        <div className="font-bold mb-2">デバッグ情報</div>
                        <div>フェーズ: {gameState?.phase}</div>
                        <div>現在のターン: {isCurrentTurn.toString()}</div>
                        <div>サイコロ振り中: {diceRolling.toString()}</div>
                        <div>ボタン無効: {isDiceButtonDisabled.toString()}</div>
                        <div>送信中: {isSubmitting.toString()}</div>
                        <div>利用可能な組み合わせ: {currentAvailableCombinations.length}</div>
                        <div>選択中の組み合わせ: {selectedCombination ? JSON.stringify(selectedCombination) : 'なし'}</div>
                        <div>サイコロ表示: {shouldShowDiceValues.toString()}</div>
                        <div>サイコロ値: [{gameData.diceValues.join(', ')}] (length: {gameData.diceValues.length})</div>
                        <div>一時マーカー: {JSON.stringify(gameData.tempMarkers)}</div>
                    </div>
                )}
            </main>

            <Footer />
        </div>
    );
}