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
} from "~/games/cant-stop/utils/constants";

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
            
            // ルーム満員チェック
            const { data: currentParticipants, error: participantCountError } = await supabase
                .from(DB_TABLES.ROOM_PARTICIPANTS)
                .select('user_id')
                .eq('room_id', room.id);

            if (participantCountError) throw participantCountError;
            
            if (currentParticipants.length >= room.max_players) {
                return { success: false, error: ERROR_MESSAGES.ROOM_FULL };
            }
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
            const { error: joinError } = await supabase
                .from(DB_TABLES.ROOM_PARTICIPANTS)
                .insert({
                    room_id: room.id,
                    user_id: userId,
                    is_ready: false
                });

            if (joinError) throw joinError;

            // 勝利統計を初期化（まだ存在しない場合）
            const { data: existingWinStat } = await supabase
                .from(DB_TABLES.ROOM_WINS)
                .select('id')
                .eq('room_id', room.id)
                .eq('user_id', userId)
                .single();

            if (!existingWinStat) {
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
        // ルーム情報を取得（room_idかidかを判別）
        let room;
        let roomError;
        
        // UUIDかどうかをチェック
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        if (isUUID) {
            // UUIDの場合はidで検索
            const result = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('*')
                .eq('id', roomId)
                .single();
            room = result.data;
            roomError = result.error;
        } else {
            // 文字列の場合はroom_idで検索
            const result = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('*')
                .eq('room_id', roomId.toLowerCase())
                .single();
            room = result.data;
            roomError = result.error;
        }

        if (roomError) throw roomError;

        // 参加者一覧を取得（ユーザー情報も含む）
        const { data: participantsData, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*')
            .eq('room_id', room.id)  // fix: roomIdではなくroom.idを使用
            .order('joined_at', { ascending: true });

        if (participantsError) throw participantsError;

        // 認証されたユーザーのIDリストを取得
        const userIds = participantsData?.map(p => p.user_id) || [];
        
        // 全ユーザーの詳細情報を一括取得
        const userDetails: { [key: string]: User | null } = {};
        
        for (const userId of userIds) {
            try {
                // 現在のリクエストのSupabaseクライアントでユーザー情報を取得
                const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
                
                if (userData?.user && !userError) {
                    const discordData = userData.user.user_metadata;
                    const customClaims = discordData?.custom_claims;
                    
                    // より包括的なユーザー名の取得
                    const username = customClaims?.global_name ||
                                   discordData?.full_name ||
                                   discordData?.name ||
                                   discordData?.display_name ||
                                   discordData?.username ||
                                   userData.user.email?.split('@')[0] ||
                                   `User${userData.user.id.slice(-4)}`;
                    
                    userDetails[userId] = {
                        id: userData.user.id,
                        email: userData.user.email,
                        username: username,
                        avatar: discordData?.avatar_url,
                        raw_user_meta_data: userData.user.user_metadata
                    };
                    
                    console.log(`User ${userId} formatted:`, userDetails[userId]);
                } else {
                    console.warn(`Failed to get user data for ${userId}:`, userError);
                    userDetails[userId] = {
                        id: userId,
                        username: `User${userId.slice(-4)}`,
                        email: undefined,
                        raw_user_meta_data: undefined
                    };
                }
            } catch (userFetchError) {
                console.warn(`ユーザー情報取得失敗 (${userId}):`, userFetchError);
                userDetails[userId] = {
                    id: userId,
                    username: `User${userId.slice(-4)}`,
                    email: undefined,
                    raw_user_meta_data: undefined
                };
            }
        }

        // 参加者データにユーザー情報を結合
        const participants = participantsData?.map(participant => ({
            ...participant,
            user: userDetails[participant.user_id] || null
        })) || [];

        // 勝利統計を取得
        const { data: winStats, error: winStatsError } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .select('*')
            .eq('room_id', room.id)  // fix: roomIdではなくroom.idを使用
            .order('wins_count', { ascending: false });

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
        // UUIDかどうかをチェック
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        let actualRoomId = roomId;
        
        if (!isUUID) {
            // 文字列の場合は、まずroom_idからUUIDを取得
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('id')
                .eq('room_id', roomId.toLowerCase())
                .single();
                
            if (roomError) throw roomError;
            actualRoomId = room.id;
        }

        const { data: gameState, error } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .select('*')
            .eq('room_id', actualRoomId)
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
        // UUIDかどうかをチェック
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        let actualRoomId = roomId;
        
        if (!isUUID) {
            // 文字列の場合は、まずroom_idからUUIDを取得
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('id')
                .eq('room_id', roomId.toLowerCase())
                .single();
                
            if (roomError) throw roomError;
            actualRoomId = room.id;
        }

        // 参加者から削除
        const { error: participantError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .delete()
            .eq('room_id', actualRoomId)
            .eq('user_id', userId);

        if (participantError) throw participantError;

        // ルームの残り参加者数をチェック
        const { data: remainingParticipants, error: countError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('user_id')
            .eq('room_id', actualRoomId);

        if (countError) throw countError;

        if (remainingParticipants.length === 0) {
            // 参加者がいない場合はルームを削除
            const { error: deleteError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .delete()
                .eq('id', actualRoomId);

            if (deleteError) throw deleteError;
        } else {
            // ホストが退出した場合は新しいホストを設定
            const { data: room } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('host_user_id')
                .eq('id', actualRoomId)
                .single();

            if (room && room.host_user_id === userId) {
                const newHostId = remainingParticipants[0].user_id;
                await supabase
                    .from(DB_TABLES.GAME_ROOMS)
                    .update({ host_user_id: newHostId })
                    .eq('id', actualRoomId);
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
        // UUIDかどうかをチェック
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        let actualRoomId = roomId;
        
        if (!isUUID) {
            // 文字列の場合は、まずroom_idからUUIDを取得
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('id, host_user_id')
                .eq('room_id', roomId.toLowerCase())
                .single();
                
            if (roomError) throw roomError;
            actualRoomId = room.id;
            
            // ホスト権限をチェック
            if (room.host_user_id !== hostUserId) {
                return { success: false, error: ERROR_MESSAGES.NOT_HOST };
            }
        } else {
            // ホスト権限をチェック
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('host_user_id')
                .eq('id', actualRoomId)
                .single();

            if (roomError) throw roomError;
            if (room.host_user_id !== hostUserId) {
                return { success: false, error: ERROR_MESSAGES.NOT_HOST };
            }
        }

        // 対象プレイヤーを削除
        const { error: kickError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .delete()
            .eq('room_id', actualRoomId)
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
 * 準備状態をトグル
 */
export async function toggleReady(
    request: Request, 
    roomId: string, 
    userId: string
): Promise<DatabaseResult> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // UUIDかどうかをチェック
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        let actualRoomId = roomId;
        
        if (!isUUID) {
            // 文字列の場合は、まずroom_idからUUIDを取得
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('id')
                .eq('room_id', roomId.toLowerCase())
                .single();
                
            if (roomError) throw roomError;
            actualRoomId = room.id;
        }

        // 現在の準備状態を取得
        const { data: participant, error: getError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('is_ready')
            .eq('room_id', actualRoomId)
            .eq('user_id', userId)
            .single();

        if (getError) throw getError;

        // 準備状態を反転
        const { error: updateError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .update({ is_ready: !participant.is_ready })
            .eq('room_id', actualRoomId)
            .eq('user_id', userId);

        if (updateError) throw updateError;

        return { success: true };
    } catch (error) {
        console.error('準備状態変更エラー:', error);
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
        // UUIDかどうかをチェック
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        let actualRoomId = roomId;
        
        if (!isUUID) {
            // 文字列の場合は、まずroom_idからUUIDを取得
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('id, host_user_id')
                .eq('room_id', roomId.toLowerCase())
                .single();
                
            if (roomError) throw roomError;
            actualRoomId = room.id;
            
            // ホスト権限をチェック
            if (room.host_user_id !== hostUserId) {
                return { success: false, error: ERROR_MESSAGES.NOT_HOST };
            }
        } else {
            // ホスト権限をチェック
            const { data: room, error: roomError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .select('host_user_id')
                .eq('id', actualRoomId)
                .single();

            if (roomError) throw roomError;
            if (room.host_user_id !== hostUserId) {
                return { success: false, error: ERROR_MESSAGES.NOT_HOST };
            }
        }

        // 全員の準備完了をチェック
        const { data: participants, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('user_id, is_ready')
            .eq('room_id', actualRoomId)
            .order('joined_at', { ascending: true });

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
            .eq('id', actualRoomId);

        if (updateRoomError) throw updateRoomError;

        // 初期ゲーム状態を作成
        const initialGameData: GameData = {
            columns: {},
            tempMarkers: {},
            completedColumns: {},
            diceValues: [],
            logs: [{ message: GAME_MESSAGES.GAME_START }]
        };

        // 最初のプレイヤー（参加順）
        const firstPlayerId = participants[0].user_id;

        const { error: gameStateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .insert({
                room_id: actualRoomId,
                current_turn_user_id: firstPlayerId,
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