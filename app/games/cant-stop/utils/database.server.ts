import { createSupabaseServerClient } from "~/utils/supabase-auth.server";
import { createClient } from "@supabase/supabase-js";
import { 
    DB_TABLES, 
    ERROR_MESSAGES, 
    ROOM_ID_SETTINGS 
} from "~/games/cant-stop/utils/constants";
import type { 
    DatabaseResult, 
    GameRoom, 
    RoomParticipant, 
    User, 
    RoomWins, 
    GameState 
} from "~/games/cant-stop/utils/types";

/**
 * Admin権限付きSupabaseクライアントを作成
 */
function createSupabaseAdminClient() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    
    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

/**
 * ルーム作成または参加
 */
export async function joinOrCreateRoom(
    request: Request, 
    roomId: string, 
    userId: string
): Promise<DatabaseResult<GameRoom>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 小文字に正規化
        const normalizedRoomId = roomId.toLowerCase();

        // まず既存のルームを検索
        const { data: existingRoom, error: findError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('*')
            .eq('room_id', normalizedRoomId)
            .single();

        let room: GameRoom;

        if (findError && findError.code === 'PGRST116') {
            // ルームが存在しない場合は新規作成
            const { data: newRoom, error: createError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .insert({
                    room_id: normalizedRoomId,
                    host_user_id: userId,
                    status: 'waiting',
                    max_players: 4
                })
                .select()
                .single();

            if (createError) throw createError;
            room = newRoom;
        } else if (findError) {
            throw findError;
        } else {
            room = existingRoom;
            
            // ルームが満室かチェック
            const { data: participants, error: participantError } = await supabase
                .from(DB_TABLES.ROOM_PARTICIPANTS)
                .select('user_id')
                .eq('room_id', room.id);

            if (participantError) throw participantError;

            if (participants.length >= room.max_players) {
                // 既に参加している場合は除外
                const alreadyJoined = participants.some((p: any) => p.user_id === userId);
                if (!alreadyJoined) {
                    return { success: false, error: ERROR_MESSAGES.ROOM_FULL };
                }
            }
        }

        // 参加者として追加（既に参加している場合は何もしない）
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
 * 現在のユーザー情報を取得
 */
async function getCurrentUserData(request: Request): Promise<User | null> {
    const { supabase } = createSupabaseServerClient(request);
    
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) return null;
        
        const metadata = user.user_metadata || {};
        const customClaims = metadata.custom_claims || {};
        
        return {
            id: user.id,
            email: user.email,
            username: customClaims.global_name || 
                     metadata.full_name || 
                     metadata.name || 
                     metadata.display_name ||
                     metadata.username ||
                     user.email?.split('@')[0] ||
                     `User${user.id.slice(-4)}`,
            avatar: metadata.avatar_url || metadata.picture,
            raw_user_meta_data: metadata
        };
    } catch (error) {
        console.error('現在のユーザー情報取得エラー:', error);
        return null;
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

        // 参加者一覧を取得
        const { data: participantsData, error: participantsError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*')
            .eq('room_id', room.id)
            .order('joined_at', { ascending: true });

        if (participantsError) throw participantsError;

        // 現在のユーザー情報を取得（参照用）
        const currentUser = await getCurrentUserData(request);
        
        // 参加者データにダミーのユーザー情報を設定
        // 実際のアプリケーションでは、ユーザー情報を別のテーブルに保存するか、
        // セッション管理システムを使用する必要があります
        const participants = participantsData?.map((participant: any) => {
            // 現在のユーザーの場合は実際の情報を使用
            if (currentUser && participant.user_id === currentUser.id) {
                return {
                    ...participant,
                    user: currentUser
                };
            }
            
            // その他のユーザーはダミー情報を生成
            return {
                ...participant,
                user: {
                    id: participant.user_id,
                    username: `Player${participant.user_id.slice(-4)}`,
                    email: undefined,
                    raw_user_meta_data: undefined
                } as User
            };
        }) || [];

        // 勝利統計を取得
        const { data: winStats, error: winStatsError } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .select('*')
            .eq('room_id', room.id)
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
        // Admin API権限エラーの場合はフォールバック実装を使用
        if (error instanceof Error && error.message.includes('not_admin')) {
            console.log('Admin API権限がないため、フォールバック実装を使用します');
            return await getRoomDataFallback(request, roomId);
        }
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}

/**
 * Admin権限がない場合のフォールバック実装
 */
async function getRoomDataFallback(
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
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
        
        let room;
        if (isUUID) {
            const result = await supabase.from(DB_TABLES.GAME_ROOMS).select('*').eq('id', roomId).single();
            room = result.data;
        } else {
            const result = await supabase.from(DB_TABLES.GAME_ROOMS).select('*').eq('room_id', roomId.toLowerCase()).single();
            room = result.data;
        }

        // 参加者一覧を取得
        const { data: participantsData } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*')
            .eq('room_id', room.id)
            .order('joined_at', { ascending: true });

        // 現在のユーザー情報を取得
        const currentUser = await getCurrentUserData(request);
        
        // 参加者データを整形（現在のユーザーのみ実名、他はPlaceholder）
        const participants = participantsData?.map((participant: any) => ({
            ...participant,
            user: participant.user_id === currentUser?.id ? currentUser : {
                id: participant.user_id,
                username: `Player${participant.user_id.slice(-4)}`,
                email: undefined,
                raw_user_meta_data: undefined
            } as User
        })) || [];

        // 勝利統計を取得
        const { data: winStats } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .select('*')
            .eq('room_id', room.id)
            .order('wins_count', { ascending: false });

        return {
            success: true,
            data: {
                room,
                participants: participants as (RoomParticipant & { user: User | null })[],
                winStats: winStats || []
            }
        };
    } catch (error) {
        console.error('フォールバック実装でもエラー:', error);
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
            console.log(`空のルーム ${actualRoomId} を削除しました`);
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
                console.log(`ルーム ${actualRoomId} の新しいホストを ${newHostId} に設定しました`);
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

        // キック後、ルームの残り参加者数をチェック
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
            console.log(`空のルーム ${actualRoomId} を削除しました`);
        }

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
        console.log(`toggleReady called: roomId=${roomId}, userId=${userId}`);
        
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

        if (getError) {
            console.error('Failed to get current ready state:', getError);
            throw getError;
        }

        const newReadyState = !participant.is_ready;
        console.log(`Changing ready state from ${participant.is_ready} to ${newReadyState}`);

        // 準備状態を反転
        const { error: updateError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .update({ is_ready: newReadyState })
            .eq('room_id', actualRoomId)
            .eq('user_id', userId);

        if (updateError) {
            console.error('Failed to update ready state:', updateError);
            throw updateError;
        }

        console.log(`Ready state updated successfully to ${newReadyState}`);
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

        // 全参加者の準備状態をチェック
        const { data: participants, error: participantError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('is_ready')
            .eq('room_id', actualRoomId);

        if (participantError) throw participantError;

        if (participants.length < 2) {
            return { success: false, error: ERROR_MESSAGES.NOT_ENOUGH_PLAYERS };
        }

        const allReady = participants.every(p => p.is_ready);
        if (!allReady) {
            return { success: false, error: ERROR_MESSAGES.NOT_ALL_READY };
        }

        // ルーム状態を'playing'に変更
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .update({ status: 'playing' })
            .eq('id', actualRoomId);

        if (updateError) throw updateError;

        // ゲーム状態を初期化
        const firstPlayerId = participants[0] ? 
            (await supabase.from(DB_TABLES.ROOM_PARTICIPANTS).select('user_id').eq('room_id', actualRoomId).limit(1).single()).data?.user_id : 
            null;

        const { error: gameStateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .insert({
                room_id: actualRoomId,
                current_turn_user_id: firstPlayerId,
                turn_number: 1,
                game_data: {
                    columns: {},
                    tempMarkers: {},
                    completedColumns: {},
                    diceValues: [],
                    logs: []
                },
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
 * 空のルーム（参加者なし、waiting状態）をクリーンアップ
 */
export async function cleanupEmptyRooms(
    request: Request
): Promise<DatabaseResult<{ deletedCount: number }>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // waiting状態で参加者がいないルームを特定
        const { data: emptyRooms, error: roomError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select(`
                id,
                room_id,
                status,
                created_at,
                ${DB_TABLES.ROOM_PARTICIPANTS}!inner(count)
            `)
            .eq('status', 'waiting')
            .not(DB_TABLES.ROOM_PARTICIPANTS + '.count', 'gt', 0);

        if (roomError) throw roomError;

        // さらに確実に空のルームを特定（サブクエリで二重チェック）
        const roomIdsToDelete: string[] = [];
        
        for (const room of emptyRooms || []) {
            const { data: participants, error } = await supabase
                .from(DB_TABLES.ROOM_PARTICIPANTS)
                .select('user_id')
                .eq('room_id', room.id);

            if (!error && (!participants || participants.length === 0)) {
                roomIdsToDelete.push(room.id);
            }
        }

        if (roomIdsToDelete.length === 0) {
            return { success: true, data: { deletedCount: 0 } };
        }

        // 関連データも含めて削除
        // 1. 勝利統計を削除
        const { error: winStatsError } = await supabase
            .from(DB_TABLES.ROOM_WINS)
            .delete()
            .in('room_id', roomIdsToDelete);

        if (winStatsError) throw winStatsError;

        // 2. ゲーム状態を削除（もしあれば）
        const { error: gameStatesError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .delete()
            .in('room_id', roomIdsToDelete);

        if (gameStatesError) throw gameStatesError;

        // 3. ルームを削除
        const { error: deleteError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .delete()
            .in('id', roomIdsToDelete);

        if (deleteError) throw deleteError;

        console.log(`${roomIdsToDelete.length}個の空のルームを削除しました:`, roomIdsToDelete);

        return { success: true, data: { deletedCount: roomIdsToDelete.length } };
    } catch (error) {
        console.error('空ルームクリーンアップエラー:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
}