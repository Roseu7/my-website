import { createSupabaseServerClient } from "~/utils/supabase-auth.server";
import type { 
    GameRoom, 
    RoomParticipant, 
    GameState, 
    RoomWins, 
    DatabaseResult,
    GameData,
    User 
} from "./types";
import { 
    DB_TABLES, 
    ERROR_MESSAGES, 
    GAME_SETTINGS,
    GAME_MESSAGES 
} from "~/utils/cant-stop/constants";

/**
 * ルームを作成または参加
 */
export async function joinOrCreateRoom(
    request: Request, 
    roomId: string, 
    userId: string
): Promise<DatabaseResult<GameRoom>> {
    const { supabase } = createSupabaseServerClient(request);
    
    try {
        // 正規化されたルームIDで検索
        const normalizedRoomId = roomId.toLowerCase();
        
        // 既存のルームを検索
        const { data: existingRoom, error: roomError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('*')
            .eq('room_id', normalizedRoomId)
            .single();

        let room: GameRoom;

        if (roomError && roomError.code === 'PGRST116') {
            // ルームが存在しない場合は新規作成
            const { data: newRoom, error: createError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .insert({
                    room_id: normalizedRoomId,
                    host_user_id: userId,
                    status: 'waiting',
                    max_players: GAME_SETTINGS.MAX_PLAYERS
                })
                .select()
                .single();

            if (createError) throw createError;
            room = newRoom;

            // 勝利統計を初期化
            await supabase
                .from(DB_TABLES.ROOM_WINS)
                .insert({
                    room_id: room.id,
                    user_id: userId,
                    wins_count: 0
                });

        } else if (roomError) {
            throw roomError;
        } else {
            room = existingRoom;
        }

        // 既に参加しているかチェック
        const { data: existingParticipant } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*')
            .eq('room_id', room.id)
            .eq('user_id', userId)
            .single();

        if (!existingParticipant) {
            // 参加者として追加
            const { error: participantError } = await supabase
                .from(DB_TABLES.ROOM_PARTICIPANTS)
                .insert({
                    room_id: room.id,
                    user_id: userId,
                    is_ready: false
                });

            if (participantError) throw participantError;

            // 勝利統計がない場合は追加
            const { data: existingWins } = await supabase
                .from(DB_TABLES.ROOM_WINS)
                .select('*')
                .eq('room_id', room.id)
                .eq('user_id', userId)
                .single();

            if (!existingWins) {
                await supabase
                    .from(DB_TABLES.ROOM_WINS)
                    .insert({
                        room_id: room.id,
                        user_id: userId,
                        wins_count: 0
                    });
            }
        }

        return { success: true, data: room };
    } catch (error) {
        console.error('ルーム参加エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * ルームから退出
 */
export async function leaveRoom(
    request: Request, 
    roomId: string, 
    userId: string
): Promise<DatabaseResult> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 参加者から削除
        const { error: participantError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .delete()
            .eq('room_id', roomId)
            .eq('user_id', userId);

        if (participantError) throw participantError;

        // ルームの残り参加者数をチェック
        const { data: remainingParticipants, error: countError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('user_id')
            .eq('room_id', roomId);

        if (countError) throw countError;

        if (remainingParticipants.length === 0) {
            // 参加者がいない場合はルームを削除
            const { error: deleteError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .delete()
                .eq('id', roomId);

            if (deleteError) throw deleteError;
        } else {
            // ホストが退出した場合は新しいホストを設定
            const { data: room } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('host_user_id')
                .eq('id', roomId)
                .single();

            if (room && room.host_user_id === userId) {
                const newHostId = remainingParticipants[0].user_id;
                await supabase
                    .from(DB_TABLES.GAME_ROOMS)
                    .update({ host_user_id: newHostId })
                    .eq('id', roomId);
            }
        }

        return { success: true };
    } catch (error) {
        console.error('ルーム退出エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * プレイヤーをキック（ホストのみ）
 */
export async function kickPlayer(
    request: Request, 
    roomId: string, 
    hostUserId: string, 
    targetUserId: string
): Promise<DatabaseResult> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // ホスト権限をチェック
        const { data: room, error: roomError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('host_user_id')
            .eq('id', roomId)
            .single();

        if (roomError) throw roomError;
        if (room.host_user_id !== hostUserId) {
            return { success: false, error: ERROR_MESSAGES.NOT_HOST };
        }

        // 対象プレイヤーを削除
        const { error: kickError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .delete()
            .eq('room_id', roomId)
            .eq('user_id', targetUserId);

        if (kickError) throw kickError;

        return { success: true };
    } catch (error) {
        console.error('プレイヤーキックエラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * 準備状態を切り替え
 */
export async function toggleReady(
    request: Request, 
    roomId: string, 
    userId: string
): Promise<DatabaseResult<{ isReady: boolean }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 現在の準備状態を取得
        const { data: participant, error: getError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('is_ready')
            .eq('room_id', roomId)
            .eq('user_id', userId)
            .single();

        if (getError) throw getError;

        // 準備状態を切り替え
        const newReadyState = !participant.is_ready;
        const { error: updateError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .update({ is_ready: newReadyState })
            .eq('room_id', roomId)
            .eq('user_id', userId);

        if (updateError) throw updateError;

        return { success: true, data: { isReady: newReadyState } };
    } catch (error) {
        console.error('準備状態切り替えエラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * ゲーム開始（ホストのみ）
 */
export async function startGame(
    request: Request, 
    roomId: string, 
    hostUserId: string
): Promise<DatabaseResult> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // ホスト権限をチェック
        const { data: room, error: roomError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('host_user_id')
            .eq('id', roomId)
            .single();

        if (roomError) throw roomError;
        if (room.host_user_id !== hostUserId) {
            return { success: false, error: ERROR_MESSAGES.NOT_HOST };
        }

        // 全員の準備完了をチェック
        const { data: participants, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('is_ready')
            .eq('room_id', roomId);

        if (participantsError) throw participantsError;
        if (participants.length < GAME_SETTINGS.MIN_PLAYERS) {
            return { success: false, error: ERROR_MESSAGES.NOT_ENOUGH_PLAYERS };
        }
        if (!participants.every(p => p.is_ready)) {
            return { success: false, error: ERROR_MESSAGES.NOT_ALL_READY };
        }

        // ルームステータスを'playing'に更新
        const { error: updateRoomError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .update({ status: 'playing' })
            .eq('id', roomId);

        if (updateRoomError) throw updateRoomError;

        // 初期ゲーム状態を作成
        const initialGameData: GameData = {
            columns: {},
            tempMarkers: {},
            completedColumns: {},
            diceValues: [],
            logs: [{ message: GAME_MESSAGES.GAME_START }]
        };

        const { error: gameStateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .insert({
                room_id: roomId,
                current_turn_user_id: hostUserId, // 最初はホストから開始
                turn_number: 1,
                game_data: initialGameData,
                phase: 'rolling'
            });

        if (gameStateError) throw gameStateError;

        return { success: true };
    } catch (error) {
        console.error('ゲーム開始エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * ルーム情報と参加者一覧を取得
 */
export async function getRoomData(
    request: Request, 
    roomId: string
): Promise<DatabaseResult<{
    room: GameRoom;
    participants: (RoomParticipant & { user: User | null })[];
    winStats: RoomWins[];
}>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // ルーム情報を取得
        const { data: room, error: roomError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('*')
            .eq('id', roomId)
            .single();

        if (roomError) throw roomError;

        // 参加者一覧を取得（ユーザー情報も含む）
        const { data: participantsData, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*')
            .eq('room_id', roomId);

        if (participantsError) throw participantsError;

        // 参加者のユーザー情報を個別に取得
        const participants = [];
        if (participantsData) {
            for (const participant of participantsData) {
                const { data: userData } = await supabase.auth.admin.getUserById(participant.user_id);
                participants.push({
                    ...participant,
                    user: userData.user ? {
                        id: userData.user.id,
                        email: userData.user.email,
                        raw_user_meta_data: userData.user.user_metadata
                    } : null
                });
            }
        }

        // 勝利統計を取得
        const { data: winStats, error: winStatsError } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .select('*')
            .eq('room_id', roomId);

        if (winStatsError) throw winStatsError;

        return {
            success: true,
            data: {
                room,
                participants: participants as (RoomParticipant & { user: User | null })[],
                winStats: winStats || []
            }
        };
    } catch (error) {
        console.error('ルーム情報取得エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * ゲーム状態を取得
 */
export async function getGameState(
    request: Request, 
    roomId: string
): Promise<DatabaseResult<GameState>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const { data: gameState, error } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', roomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        return { success: true, data: gameState };
    } catch (error) {
        console.error('ゲーム状態取得エラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}