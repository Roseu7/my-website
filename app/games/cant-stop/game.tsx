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
import { getValidCombinations, calculateDiceCombinations } from "~/games/cant-stop/utils/helpers";

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

    console.log('Game Action:', { action, roomId, userId: user.id }); // デバッグ用

    switch (action) {
        case "roll_dice": {
            console.log('Rolling dice for user:', user.id); // デバッグ用
            
            const result = await rollDice(request, roomId, user.id);
            
            console.log('Roll dice result:', result); // デバッグ用
            
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
                return json({ error: "組み合わせが選択されていません" }, { status: 400 });
            }
            
            try {
                const combination = JSON.parse(combinationStr);
                console.log('Choosing combination:', combination); // デバッグ用
                
                const result = await chooseCombination(request, roomId, user.id, combination);
                
                if (!result.success) {
                    return json({ error: result.error }, { status: 400 });
                }
                
                return json({ success: true });
            } catch (error) {
                console.error('Combination parsing error:', error);
                return json({ error: "不正な組み合わせです" }, { status: 400 });
            }
        }

        case "continue": {
            const result = await continueGame(request, roomId, user.id);
            
            if (!result.success) {
                return json({ error: result.error }, { status: 400 });
            }
            
            return json({ success: true });
        }

        case "stop": {
            const result = await stopTurn(request, roomId, user.id);
            
            if (!result.success) {
                return json({ error: result.error }, { status: 400 });
            }
            
            return json({ success: true });
        }

        default:
            return json({ error: "不正なアクションです" }, { status: 400 });
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
    const [gameState, setGameState] = useState<GameStateType | null>(initialGameState);
    const [isCurrentTurn, setIsCurrentTurn] = useState(initialIsCurrentTurn);
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('connected');

    // ゲーム専用の状態
    const [availableCombinations, setAvailableCombinations] = useState<number[][]>([]);
    const [selectedCombination, setSelectedCombination] = useState<number[] | null>(null);
    const [diceRolling, setDiceRolling] = useState(false);

    const isSubmitting = navigation.state === "submitting";

    // リアルタイム通信の設定
    useEffect(() => {
        const realtimeClient = createRealtimeClient(room.room_id);

        // ゲーム状態の変更を監視
        realtimeClient.subscribeToGame({
            onGameStateChanged: (updatedGameState: GameStateType) => {
                setGameState(updatedGameState);
                setIsCurrentTurn(updatedGameState.current_turn_user_id === user.id);
                
                // 組み合わせ選択フェーズの場合、利用可能な組み合わせを計算
                if (updatedGameState.phase === 'choosing' && updatedGameState.game_data.diceValues?.length === 4) {
                    const allCombinations = calculateDiceCombinations(updatedGameState.game_data.diceValues);
                    const validCombinations = getValidCombinations(allCombinations, updatedGameState.game_data, user.id);
                    setAvailableCombinations(validCombinations);
                }
            },
            onGameEnded: (result: any) => {
                // ゲーム終了時は結果画面に遷移
                window.location.href = `/games/cant-stop/result/${room.room_id}`;
            },
            onConnectionStateChanged: (state: any) => {
                setConnectionStatus(state.game === 'connected' ? 'connected' : 
                                state.game === 'error' ? 'error' : 'disconnected');
            }
        });

        return () => {
            realtimeClient.cleanup();
        };
    }, [room.room_id, user.id]);

    // ゲームデータの取得（安全なアクセス）
    const gameData: GameData = gameState?.game_data || {
        columns: {},
        tempMarkers: {},
        completedColumns: {},
        diceValues: [],
        logs: []
    };

    // サイコロを振る処理
    const handleRollDice = async () => {
        setDiceRolling(true);
        setAvailableCombinations([]);
        setSelectedCombination(null);
        
        const form = new FormData();
        form.append("_action", "roll_dice");
        
        try {
            const response = await fetch(`/games/cant-stop/game/${room.room_id}`, {
                method: "POST",
                body: form
            });
            
            const result = await response.json();
            
            if (result.success) {
                if (result.bust) {
                    // バストの処理
                    setAvailableCombinations([]);
                } else {
                    setAvailableCombinations(result.combinations || []);
                }
            } else {
                console.error('サイコロ振りエラー:', result.error);
            }
        } catch (error) {
            console.error('サイコロ振りエラー:', error);
        } finally {
            setDiceRolling(false);
        }
    };

    // 組み合わせ選択処理
    const handleCombinationSelect = (combination: number[]) => {
        setSelectedCombination(combination);
    };

    // 組み合わせ確定処理
    const handleCombinationConfirm = async () => {
        if (!selectedCombination) return;
        
        const form = new FormData();
        form.append("_action", "choose_combination");
        form.append("combination", JSON.stringify(selectedCombination));
        
        try {
            // 修正: room.idではなくroom.room_idを使用
            const response = await fetch(`/games/cant-stop/game/${room.room_id}`, {
                method: "POST",
                body: form
            });
            
            const result = await response.json();
            
            if (result.success) {
                setAvailableCombinations([]);
                setSelectedCombination(null);
            } else {
                console.error('組み合わせ選択エラー:', result.error);
            }
        } catch (error) {
            console.error('組み合わせ選択エラー:', error);
        }
    };

    // フェーズに応じた表示テキスト
    const getPhaseText = (): string => {
        if (!gameState) return '';
        
        const currentPlayer = players.find(p => p.id === gameState.current_turn_user_id);
        
        switch (gameState.phase) {
            case 'rolling':
                return isCurrentTurn ? 'サイコロを振ってください' : `${currentPlayer?.username}のターン`;
            case 'choosing':
                return isCurrentTurn ? '組み合わせを選択してください' : '組み合わせを選択中...';
            case 'deciding':
                return isCurrentTurn ? '進むかストップするか選択してください' : '進むかストップするか選択中...';
            case 'busting':
                return 'バスト！';
            default:
                return '';
        }
    };

    // エラーメッセージの表示
    const getErrorMessage = (): string | null => {
        if (actionData && 'error' in actionData && typeof actionData.error === 'string') {
            return actionData.error;
        }
        return null;
    };

    if (!gameState) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-lg text-gray-600">ゲーム状態を読み込み中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
            <Header user={user} />

            <main className="flex-1 mx-auto max-w-7xl px-6 py-8 lg:px-8">
                {/* ゲームヘッダー */}
                <div className="text-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Can't Stop</h1>
                    <p className="text-lg text-gray-600">{getPhaseText()}</p>
                    
                    {/* 接続状態インジケーター */}
                    <div className="flex items-center justify-center space-x-2 mt-2">
                        <div className={`w-3 h-3 rounded-full ${
                            connectionStatus === 'connected' ? 'bg-green-400' :
                            connectionStatus === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                        }`} />
                        <span className="text-sm text-gray-500">
                            {connectionStatus === 'connected' ? '接続中' :
                             connectionStatus === 'error' ? '接続エラー' : '再接続中...'}
                        </span>
                    </div>
                </div>

                {/* エラーメッセージ */}
                {getErrorMessage() && (
                    <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-red-600">{getErrorMessage()}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                    {/* メインゲームエリア */}
                    <div className="xl:col-span-3 space-y-6">
                        {/* ゲームボード */}
                        <GameBoard
                            gameData={gameData}
                            players={players}
                            highlightedColumns={selectedCombination || []}
                            isInteractive={false}
                        />

                        {/* ゲームコントロール */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* サイコロエリア */}
                            <DiceRoller
                                diceValues={gameData.diceValues}
                                isRolling={diceRolling}
                                canRoll={isCurrentTurn && gameState.phase === 'rolling'}
                                onRoll={handleRollDice}
                                showCombinations={gameState.phase === 'choosing' && isCurrentTurn}
                                availableCombinations={availableCombinations}
                                selectedCombination={selectedCombination}
                                onCombinationSelect={handleCombinationSelect}
                                onCombinationConfirm={handleCombinationConfirm}
                                isSubmitting={isSubmitting}
                            />

                            {/* ゲームアクション */}
                            <div className="bg-white rounded-lg border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">アクション</h3>
                                
                                <div className="space-y-3">
                                    {/* 進む/ストップ */}
                                    {isCurrentTurn && gameState.phase === 'deciding' && (
                                        <>
                                            <Form method="post" className="w-full">
                                                <input type="hidden" name="_action" value="continue_game" />
                                                <button
                                                    type="submit"
                                                    disabled={isSubmitting}
                                                    className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
                                                >
                                                    進む
                                                </button>
                                            </Form>
                                            
                                            <Form method="post" className="w-full">
                                                <input type="hidden" name="_action" value="stop_turn" />
                                                <button
                                                    type="submit"
                                                    disabled={isSubmitting}
                                                    className="w-full bg-yellow-600 text-white py-3 px-4 rounded-lg hover:bg-yellow-700 disabled:opacity-50 font-medium transition-colors"
                                                >
                                                    ストップ
                                                </button>
                                            </Form>
                                        </>
                                    )}

                                    {/* ゲーム退出 */}
                                    <Form method="post">
                                        <input type="hidden" name="_action" value="exit_game" />
                                        <button
                                            type="submit"
                                            className="w-full bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 font-medium transition-colors"
                                        >
                                            ロビーに戻る
                                        </button>
                                    </Form>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* サイドバー */}
                    <div className="space-y-6">
                        {/* プレイヤー一覧 */}
                        <PlayerList
                            players={players}
                            currentUserId={user.id}
                            mode="game"
                        />

                        {/* ゲームログ */}
                        <GameLog
                            logs={gameData.logs}
                            players={players}
                            showTimestamps={true}
                            autoScroll={true}
                        />
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}