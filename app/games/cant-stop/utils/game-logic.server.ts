import { createSupabaseServerClient } from "~/utils/supabase-auth.server";
import type { 
    GameData, 
    GameState as GameStateType, 
    DatabaseResult,
    GameLog 
} from "./types";
import { 
    DB_TABLES, 
    GAME_MESSAGES, 
    GAME_SETTINGS,
    COLUMN_HEIGHTS 
} from "~/games/cant-stop/utils/constants";
import { 
    calculateDiceCombinations, 
    getValidCombinations,
    isColumnCompleted,
    checkPlayerVictory,
    getNextPlayer,
    createGameLogMessage
} from "~/games/cant-stop/utils/helpers";

/**
 * roomIdからUUIDを取得するヘルパー関数
 */
async function getRoomUUIDFromIdentifier(supabase: any, identifier: string): Promise<string> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    
    if (isUUID) {
        return identifier;
    }
    
    const { data: room, error } = await supabase
        .from(DB_TABLES.GAME_ROOMS)
        .select('id')
        .eq('room_id', identifier.toLowerCase())
        .single();
        
    if (error) throw error;
    return room.id;
}

/**
 * サイコロを振る
 */
export async function rollDice(
    request: Request,
    roomId: string,
    playerId: string
): Promise<DatabaseResult<{ diceValues: number[]; combinations: number[][]; canContinue: boolean }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUIDFromIdentifier(supabase, roomId);

        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', actualRoomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (getError) throw getError;

        // ターンの確認
        if (gameState.current_turn_user_id !== playerId) {
            return { success: false, error: "あなたのターンではありません" };
        }

        if (gameState.phase !== 'rolling') {
            return { success: false, error: "サイコロを振るフェーズではありません" };
        }

        // サイコロを振る（1-6の4つ）
        const diceValues = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
        
        // 組み合わせを計算
        const allCombinations = calculateDiceCombinations(diceValues);
        
        // 進行可能な組み合わせをフィルタリング
        const validCombinations = getValidCombinations(allCombinations, gameState.game_data, playerId);

        const gameData: GameData = {
            ...gameState.game_data,
            diceValues,
            logs: [
                ...gameState.game_data.logs,
                { 
                    message: createGameLogMessage('dice_roll', { dice: diceValues }), 
                    playerId 
                }
            ]
        };

        // バストチェック
        const canContinue = validCombinations.length > 0;
        
        if (!canContinue) {
            // バスト処理：一時マーカーをクリア
            const bustGameData: GameData = {
                ...gameData,
                tempMarkers: {}, // 一時マーカーをクリア
                logs: [
                    ...gameData.logs,
                    { 
                        message: createGameLogMessage('bust'), 
                        playerId 
                    }
                ]
            };

            // selectedCombinationがあれば削除
            delete bustGameData.selectedCombination;

            // 次のターンに移行
            await moveToNextTurn(request, actualRoomId, playerId, bustGameData);

            return { 
                success: true, 
                data: { 
                    diceValues, 
                    combinations: [], 
                    canContinue: false 
                } 
            };
        }

        // ゲーム状態を更新
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .update({
                game_data: gameData,
                phase: 'choosing',
                updated_at: new Date().toISOString()
            })
            .eq('id', gameState.id);

        if (updateError) throw updateError;

        // リアルタイム通知を送信
        try {
            await supabase
                .channel(`game-${actualRoomId}`)
                .send({
                    type: 'broadcast',
                    event: 'game_state_update',
                    payload: {
                        gameState: {
                            ...gameState,
                            game_data: gameData,
                            phase: 'choosing',
                            updated_at: new Date().toISOString()
                        },
                        action: canContinue ? 'dice_rolled' : 'bust'
                    }
                });
            console.log('サイコロ振りの通知を送信しました');
        } catch (notifyError) {
            console.error('リアルタイム通知の送信に失敗:', notifyError);
        }

        return { 
            success: true, 
            data: { 
                diceValues, 
                combinations: validCombinations, 
                canContinue: true 
            } 
        };
    } catch (error) {
        console.error('サイコロ振りエラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * 組み合わせを選択
 */
export async function chooseCombination(
    request: Request,
    roomId: string,
    playerId: string,
    combination: number[]
): Promise<DatabaseResult> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUIDFromIdentifier(supabase, roomId);

        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', actualRoomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (getError) throw getError;

        // ターンとフェーズの確認
        if (gameState.current_turn_user_id !== playerId) {
            return { success: false, error: "あなたのターンではありません" };
        }

        if (gameState.phase !== 'choosing') {
            return { success: false, error: "組み合わせ選択フェーズではありません" };
        }

        // 組み合わせが有効かチェック
        const allCombinations = calculateDiceCombinations(gameState.game_data.diceValues);
        const validCombinations = getValidCombinations(allCombinations, gameState.game_data, playerId);
        const isValidChoice = validCombinations.some(combo => 
            combo.length === combination.length && 
            combo.every(val => combination.includes(val))
        );

        if (!isValidChoice) {
            return { success: false, error: "無効な組み合わせです" };
        }

        // 一時マーカー数の制限チェック（Can't Stopルール：最大3つまで）
        const currentTempColumns = Object.keys(gameState.game_data.tempMarkers || {});
        
        // 重複を排除した新しいコラム数を計算
        const uniqueNewColumns = [...new Set(combination)].filter(col => 
            !currentTempColumns.includes(col.toString())
        );
        
        console.log('一時マーカー制限チェック:', {
            currentTempColumns,
            combination,
            uniqueNewColumns,
            totalAfter: currentTempColumns.length + uniqueNewColumns.length
        });
        
        if (currentTempColumns.length + uniqueNewColumns.length > GAME_SETTINGS.MAX_TEMP_MARKERS) {
            return { 
                success: false, 
                error: `同時に進行できるコラムは最大${GAME_SETTINGS.MAX_TEMP_MARKERS}つまでです（現在${currentTempColumns.length}、追加${uniqueNewColumns.length}）` 
            };
        }

        // ゲームデータを更新（組み合わせを記録＋一時マーカーを配置）
        const gameData: GameData = {
            ...gameState.game_data,
            selectedCombination: combination,
            tempMarkers: {
                ...gameState.game_data.tempMarkers,
                // 重複を排除してコラムに一時マーカーを配置
                ...([...new Set(combination)].reduce((markers, column) => {
                    markers[column] = playerId;
                    return markers;
                }, {} as { [key: number]: string }))
            },
            logs: [
                ...gameState.game_data.logs,
                { 
                    message: createGameLogMessage('combination_selected', { combo: combination }), 
                    playerId 
                }
            ]
        };

        // ゲーム状態を更新
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .update({
                game_data: gameData,
                phase: 'deciding',
                updated_at: new Date().toISOString()
            })
            .eq('id', gameState.id);

        if (updateError) throw updateError;

        // リアルタイム通知を送信
        try {
            await supabase
                .channel(`game-${actualRoomId}`)
                .send({
                    type: 'broadcast',
                    event: 'game_state_update',
                    payload: {
                        gameState: {
                            ...gameState,
                            game_data: gameData,
                            phase: 'deciding',
                            updated_at: new Date().toISOString()
                        }
                    }
                });
            console.log('リアルタイム通知を送信しました');
        } catch (notifyError) {
            console.error('リアルタイム通知の送信に失敗:', notifyError);
            // 通知の失敗はゲームロジックに影響しないため、続行
        }

        return { success: true };
    } catch (error) {
        console.error('組み合わせ選択エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * 進む（一時的な進行のみ）
 */
export async function continueGame(
    request: Request,
    roomId: string,
    playerId: string
): Promise<DatabaseResult<{ gameEnded: boolean; winner?: string }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUIDFromIdentifier(supabase, roomId);

        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', actualRoomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (getError) throw getError;

        // ターンとフェーズの確認
        if (gameState.current_turn_user_id !== playerId) {
            return { success: false, error: "あなたのターンではありません" };
        }

        if (gameState.phase !== 'deciding') {
            return { success: false, error: "進行フェーズではありません" };
        }

        const combination = gameState.game_data.selectedCombination;
        if (!combination) {
            return { success: false, error: "選択された組み合わせがありません" };
        }

        const gameData: GameData = { 
            ...gameState.game_data,
            columns: gameState.game_data.columns || {},
            tempMarkers: gameState.game_data.tempMarkers || {},
            completedColumns: gameState.game_data.completedColumns || {},
            diceValues: gameState.game_data.diceValues || [],
            logs: gameState.game_data.logs || []
        };

        // 各コラムに対して一時的な進行処理
        for (const column of combination) {
            // 一時マーカーを配置（一時的な進行）
            gameData.tempMarkers[column] = playerId;
        }

        // ログを追加
        gameData.logs = [
            ...gameData.logs,
            { 
                message: createGameLogMessage('progress'), 
                playerId 
            }
        ];

        // selectedCombinationを削除
        delete gameData.selectedCombination;

        // ゲーム状態を更新（まだ永続化はしない）
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .update({
                game_data: gameData,
                phase: 'rolling', // 再度サイコロを振る
                updated_at: new Date().toISOString()
            })
            .eq('id', gameState.id);

        if (updateError) throw updateError;

        // リアルタイム通知を送信
        try {
            await supabase
                .channel(`game-${actualRoomId}`)
                .send({
                    type: 'broadcast',
                    event: 'game_state_update',
                    payload: {
                        gameState: {
                            ...gameState,
                            game_data: gameData,
                            phase: 'rolling',
                            updated_at: new Date().toISOString()
                        },
                        action: 'continue'
                    }
                });
            console.log('進行の通知を送信しました');
        } catch (notifyError) {
            console.error('リアルタイム通知の送信に失敗:', notifyError);
        }

        return { 
            success: true, 
            data: { gameEnded: false } // 進行時点では勝利判定しない
        };
    } catch (error) {
        console.error('ゲーム進行エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * ターンを終了（ストップ）- 一時マーカーを永続化
 */
export async function stopTurn(
    request: Request,
    roomId: string,
    playerId: string
): Promise<DatabaseResult<{ gameEnded: boolean; winner?: string }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUIDFromIdentifier(supabase, roomId);

        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', actualRoomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (getError) throw getError;

        // ターンの確認
        if (gameState.current_turn_user_id !== playerId) {
            return { success: false, error: "あなたのターンではありません" };
        }

        const gameData: GameData = {
            ...gameState.game_data,
            columns: gameState.game_data.columns || {},
            tempMarkers: gameState.game_data.tempMarkers || {},
            completedColumns: gameState.game_data.completedColumns || {},
            diceValues: gameState.game_data.diceValues || [],
            logs: gameState.game_data.logs || []
        };

        const newLogs: GameLog[] = [];
        let gameEnded = false;
        let winner: string | undefined;

        // 一時マーカーを永続化
        for (const [column, markerId] of Object.entries(gameData.tempMarkers)) {
            if (markerId === playerId) {
                const columnNum = parseInt(column);
                
                // 現在の永続進行状況を取得
                const currentProgress = gameData.columns[columnNum]?.[playerId] || 0;
                const newProgress = currentProgress + 1;

                // 永続進行状況を更新
                if (!gameData.columns[columnNum]) {
                    gameData.columns[columnNum] = {};
                }
                gameData.columns[columnNum][playerId] = newProgress;

                console.log(`コラム${columnNum}: ${currentProgress} → ${newProgress}`);

                // コラム完成チェック
                if (isColumnCompleted(columnNum, newProgress)) {
                    gameData.completedColumns[columnNum] = playerId;
                    newLogs.push({ 
                        message: createGameLogMessage('column_completed', { column: columnNum }), 
                        playerId 
                    });
                    console.log(`コラム${columnNum}が完成しました！`);
                }
            }
        }

        // 一時マーカーをクリア
        gameData.tempMarkers = {};

        // 勝利チェック
        const completedCount = Object.values(gameData.completedColumns).filter(
            completerId => completerId === playerId
        ).length;

        if (completedCount >= GAME_SETTINGS.WINNING_COLUMNS) {
            gameEnded = true;
            winner = playerId;
            
            newLogs.push({
                message: createGameLogMessage('victory', { columns: completedCount }),
                playerId
            });

            // ルームステータスを'finished'に更新
            await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .update({ status: 'finished' })
                .eq('id', actualRoomId);

            // 勝利統計を更新
            await updateWinStats(request, actualRoomId, playerId);

            // ゲーム履歴に記録
            await recordGameHistory(request, actualRoomId, playerId, gameState);
        }

        // ログを追加
        gameData.logs = [
            ...gameData.logs,
            { message: createGameLogMessage('stop'), playerId },
            ...newLogs
        ];

        // selectedCombinationがあれば削除
        delete gameData.selectedCombination;

        if (!gameEnded) {
            // ゲーム続行の場合は次のターンに移行
            await moveToNextTurn(request, actualRoomId, playerId, gameData);
        } else {
            // ゲーム終了の場合は状態を更新
            const { error: updateError } = await supabase
                .from(DB_TABLES.GAME_STATES)
                .update({
                    game_data: gameData,
                    phase: 'finished',
                    updated_at: new Date().toISOString()
                })
                .eq('id', gameState.id);

            if (updateError) throw updateError;
        }

        return { 
            success: true,
            data: { gameEnded, winner }
        };
    } catch (error) {
        console.error('ターン終了エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * 次のターンに移行
 */
async function moveToNextTurn(
    request: Request,
    roomId: string,
    currentPlayerId: string,
    gameData?: GameData
): Promise<void> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 参加者一覧を取得（参加順）
        const { data: participants, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('user_id')
            .eq('room_id', roomId)
            .order('joined_at', { ascending: true });

        if (participantsError) throw participantsError;

        // 次のプレイヤーを決定
        const nextPlayerId = getNextPlayer(currentPlayerId, participants.map(p => p.user_id));

        // 現在のゲーム状態を取得（gameDataが渡されていない場合）
        let currentGameData = gameData;
        let gameStateId: string;
        
        if (!currentGameData) {
            const { data: gameState, error: getError } = await supabase
                .from(DB_TABLES.GAME_STATES)
                .select('*')
                .eq('room_id', roomId)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (getError) throw getError;
            currentGameData = gameState.game_data;
            gameStateId = gameState.id;
        } else {
            // gameDataが渡されている場合、最新のゲーム状態IDを取得
            const { data: gameState, error: getError } = await supabase
                .from(DB_TABLES.GAME_STATES)
                .select('id')
                .eq('room_id', roomId)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (getError) throw getError;
            gameStateId = gameState.id;
        }

        // ゲーム状態を更新（SQLポリシー修正により正常に動作）
        const { data: updatedState, error: updateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .update({
                current_turn_user_id: nextPlayerId,
                turn_number: (gameData ? 1 : 0) + 1,
                game_data: currentGameData,
                phase: 'rolling',
                updated_at: new Date().toISOString()
            })
            .eq('id', gameStateId)
            .select()
            .single();

        if (updateError) {
            console.error('ゲーム状態更新エラー:', updateError);
            throw updateError;
        }

        console.log('ゲーム状態が正常に更新されました:', updatedState);

        // リアルタイム通知を送信
        try {
            const channelName = `game-${roomId}`;
            console.log('リアルタイム通知送信中:', channelName);
            
            await supabase
                .channel(channelName)
                .send({
                    type: 'broadcast',
                    event: 'game_state_update',
                    payload: {
                        gameState: updatedState,
                        action: 'turn_changed',
                        newTurnPlayer: nextPlayerId
                    }
                });
            console.log('ターン移行の通知を送信しました');
        } catch (notifyError) {
            console.error('リアルタイム通知の送信に失敗:', notifyError);
        }
    } catch (error) {
        console.error('ターン移行エラー:', error);
    }
}

/**
 * 勝利統計を更新
 */
async function updateWinStats(
    request: Request,
    roomId: string,
    winnerId: string
): Promise<void> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 現在の勝利数を取得
        const { data: currentStats } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .select('wins_count')
            .eq('room_id', roomId)
            .eq('user_id', winnerId)
            .single();

        const currentWins = currentStats?.wins_count || 0;

        // 勝利数を更新
        const { error: updateError } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .upsert({
                room_id: roomId,
                user_id: winnerId,
                wins_count: currentWins + 1,
                updated_at: new Date().toISOString()
            });

        if (updateError) throw updateError;
    } catch (error) {
        console.error('勝利統計更新エラー:', error);
    }
}

/**
 * ゲーム履歴を記録
 */
async function recordGameHistory(
    request: Request,
    roomId: string,
    winnerId: string,
    gameState: GameStateType
): Promise<void> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 参加者一覧を取得
        const { data: participants, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('user_id')
            .eq('room_id', roomId);

        if (participantsError) throw participantsError;

        const participantIds = participants.map(p => p.user_id);
        const gameStartTime = new Date(gameState.created_at);
        const gameEndTime = new Date();
        const gameDurationSeconds = Math.floor((gameEndTime.getTime() - gameStartTime.getTime()) / 1000);

        // ゲーム履歴を記録
        const { error: historyError } = await supabase
            .from(DB_TABLES.GAME_HISTORY)
            .insert({
                room_id: roomId,
                winner_user_id: winnerId,
                participants: participantIds,
                game_duration_seconds: gameDurationSeconds,
                completed_at: new Date().toISOString()
            });

        if (historyError) throw historyError;
    } catch (error) {
        console.error('ゲーム履歴記録エラー:', error);
    }
}

/**
 * ルームの参加者一覧を取得
 */
async function getParticipants(supabase: any, roomId: string): Promise<any[]> {
    const { data: participants } = await supabase
        .from(DB_TABLES.ROOM_PARTICIPANTS)
        .select('user_id')
        .eq('room_id', roomId)
        .order('joined_at', { ascending: true });
    
    return participants || [];
}