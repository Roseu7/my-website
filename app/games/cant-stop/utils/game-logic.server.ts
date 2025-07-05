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
 * サイコロを振る
 */
export async function rollDice(
    request: Request,
    roomId: string,
    playerId: string
): Promise<DatabaseResult<{ diceValues: number[]; combinations: number[][]; canContinue: boolean }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', roomId)
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

        let newPhase = 'choosing';
        let canContinue = true;

        // バストチェック
        if (validCombinations.length === 0) {
            newPhase = 'busting';
            canContinue = false;
            
            // 一時マーカーをリセット
            gameData.tempMarkers = {};
            gameData.logs.push({
                message: createGameLogMessage('bust'),
                playerId
            });

            // 3秒後に次のターンに移行するためのタイマーを設定
            setTimeout(async () => {
                await moveToNextTurn(request, roomId, gameState.current_turn_user_id);
            }, GAME_SETTINGS.BUST_DELAY_MS);
        }

        // ゲーム状態を更新
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .update({
                game_data: gameData,
                phase: newPhase,
                updated_at: new Date().toISOString()
            })
            .eq('id', gameState.id);

        if (updateError) throw updateError;

        return {
            success: true,
            data: {
                diceValues,
                combinations: validCombinations,
                canContinue
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
        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', roomId)
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

        // 選択された組み合わせの妥当性をチェック
        const allCombinations = calculateDiceCombinations(gameState.game_data.diceValues);
        const validCombinations = getValidCombinations(allCombinations, gameState.game_data, playerId);
        
        const isValidChoice = validCombinations.some(combo => 
            combo.length === combination.length &&
            combo.every((val, index) => val === combination[index])
        );

        if (!isValidChoice) {
            return { success: false, error: "不正な組み合わせです" };
        }

        // ゲームデータを更新
        const gameData: GameData = {
            ...gameState.game_data,
            logs: [
                ...gameState.game_data.logs,
                { 
                    message: createGameLogMessage('combination_selected', { combination }), 
                    playerId 
                }
            ]
        };

        // 組み合わせを一時的に保存（game_dataに追加）
        gameData.selectedCombination = combination;

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
 * 進む（組み合わせを適用してコラムを進める）
 */
export async function continueGame(
    request: Request,
    roomId: string,
    playerId: string
): Promise<DatabaseResult<{ gameEnded: boolean; winner?: string }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', roomId)
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
            // 必須プロパティを明示的に初期化
            columns: gameState.game_data.columns || {},
            tempMarkers: gameState.game_data.tempMarkers || {},
            completedColumns: gameState.game_data.completedColumns || {},
            diceValues: gameState.game_data.diceValues || [],
            logs: gameState.game_data.logs || []
        };
        const newLogs: GameLog[] = [];

        // 各コラムに対して進行処理
        for (const column of combination) {
            // 現在の進行状況を取得
            const currentProgress = gameData.columns[column]?.[playerId] || 0;
            
            // 一時マーカーを設定
            gameData.tempMarkers[column] = playerId;
            
            // 進行状況を更新
            if (!gameData.columns[column]) {
                gameData.columns[column] = {};
            }
            gameData.columns[column][playerId] = currentProgress + 1;

            // コラム完成チェック
            if (isColumnCompleted(column, gameData.columns[column][playerId])) {
                gameData.completedColumns[column] = playerId;
                delete gameData.tempMarkers[column]; // 完成したら一時マーカーを削除
                newLogs.push({
                    message: createGameLogMessage('column_completed', { column }),
                    playerId
                });
            }
        }

        // 勝利チェック
        const hasWon = checkPlayerVictory(playerId, gameData);
        let gameEnded = false;
        let winner = undefined;

        if (hasWon) {
            gameEnded = true;
            winner = playerId;
            
            newLogs.push({
                message: createGameLogMessage('victory', { columns: GAME_SETTINGS.WINNING_COLUMNS }),
                playerId
            });

            // ルームステータスを'finished'に更新
            await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .update({ status: 'finished' })
                .eq('id', roomId);

            // 勝利統計を更新
            await updateWinStats(request, roomId, playerId);

            // ゲーム履歴に記録
            await recordGameHistory(request, roomId, playerId, gameState);
        }

        // ログを追加
        gameData.logs = [
            ...gameData.logs,
            { message: createGameLogMessage('progress'), playerId },
            ...newLogs
        ];

        // selectedCombinationを削除
        delete gameData.selectedCombination;

        // ゲーム状態を更新
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .update({
                game_data: gameData,
                phase: gameEnded ? 'finished' : 'rolling',
                updated_at: new Date().toISOString()
            })
            .eq('id', gameState.id);

        if (updateError) throw updateError;

        return { 
            success: true, 
            data: { gameEnded, winner } 
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
 * ターンを終了（ストップ）
 */
export async function stopTurn(
    request: Request,
    roomId: string,
    playerId: string
): Promise<DatabaseResult> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 現在のゲーム状態を取得
        const { data: gameState, error: getError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', roomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (getError) throw getError;

        // ターンの確認
        if (gameState.current_turn_user_id !== playerId) {
            return { success: false, error: "あなたのターンではありません" };
        }

        // 一時マーカーをクリア
        const gameData: GameData = {
            ...gameState.game_data,
            // 必須プロパティを明示的に初期化
            columns: gameState.game_data.columns || {},
            tempMarkers: {},
            completedColumns: gameState.game_data.completedColumns || {},
            diceValues: gameState.game_data.diceValues || [],
            logs: [
                ...(gameState.game_data.logs || []),
                { message: createGameLogMessage('stop'), playerId }
            ]
        };

        // selectedCombinationがあれば削除
        delete gameData.selectedCombination;

        // ゲーム状態を更新して次のターンに移行
        await moveToNextTurn(request, roomId, playerId, gameData);

        return { success: true };
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
        // 参加者一覧を取得
        const { data: participants, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('user_id')
            .eq('room_id', roomId)
            .order('joined_at', { ascending: true });

        if (participantsError) throw participantsError;

        // 次のプレイヤーを決定
        const currentIndex = participants.findIndex(p => p.user_id === currentPlayerId);
        const nextIndex = (currentIndex + 1) % participants.length;
        const nextPlayerId = participants[nextIndex].user_id;

        // 現在のゲーム状態を取得（gameDataが渡されていない場合）
        let finalGameData: GameData;
        if (!gameData) {
            const { data: currentGameState, error: getError } = await supabase
                .from(DB_TABLES.GAME_STATES)
                .select('*')
                .eq('room_id', roomId)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (getError) throw getError;
            
            finalGameData = {
                ...currentGameState.game_data,
                // 必須プロパティを明示的に初期化
                columns: currentGameState.game_data.columns || {},
                tempMarkers: currentGameState.game_data.tempMarkers || {},
                completedColumns: currentGameState.game_data.completedColumns || {},
                diceValues: currentGameState.game_data.diceValues || [],
                logs: currentGameState.game_data.logs || []
            };
        } else {
            finalGameData = gameData;
        }

        // 次のターンのログを追加
        const updatedGameData: GameData = {
            ...finalGameData,
            logs: [
                ...finalGameData.logs,
                { message: GAME_MESSAGES.NEXT_TURN }
            ]
        };

        // ゲーム状態を更新
        const { data: currentGameState } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('id')
            .eq('room_id', roomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (currentGameState) {
            const { error: updateError } = await supabase
                .from(DB_TABLES.GAME_STATES)
                .update({
                    current_turn_user_id: nextPlayerId,
                    turn_number: await getNextTurnNumber(supabase, roomId),
                    game_data: updatedGameData,
                    phase: 'rolling',
                    updated_at: new Date().toISOString()
                })
                .eq('id', currentGameState.id);

            if (updateError) throw updateError;
        }
    } catch (error) {
        console.error('次のターン移行エラー:', error);
    }
}

/**
 * 次のターン番号を取得
 */
async function getNextTurnNumber(supabase: any, roomId: string): Promise<number> {
    const { data: currentGame } = await supabase
        .from(DB_TABLES.GAME_STATES)
        .select('turn_number')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    return (currentGame?.turn_number || 0) + 1;
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
        const { data: currentStats, error: getError } = await supabase
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