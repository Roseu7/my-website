import { createSupabaseServerClient } from "~/utils/supabase-auth.server";
import { createClient } from "@supabase/supabase-js";
import type { 
    GameRoom, 
    RoomParticipant, 
    User, 
    RoomWins,
    GameState,
    DatabaseResult 
} from "~/games/cant-stop/utils/types";
import { DB_TABLES } from "~/games/cant-stop/utils/constants";

/**
 * Admin権限でのSupabaseクライアントを作成
 */
function createSupabaseAdminClient() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
        return null;
    }
    
    try {
        return createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    } catch (error) {
        console.error('Failed to create admin client:', error);
        return null;
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
 * ルームに参加または作成
 */
export async function joinOrCreateRoom(
    request: Request,
    roomId: string,
    userId: string
): Promise<DatabaseResult<GameRoom>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        // 既存のルームを検索
        let { data: room, error: searchError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('*')
            .eq('room_id', roomId.toLowerCase())
            .single();

        if (searchError && searchError.code !== 'PGRST116') {
            throw searchError;
        }

        if (!room) {
            // ルームが存在しない場合は新規作成
            const { data: newRoom, error: createError } = await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .insert({
                    room_id: roomId.toLowerCase(),
                    host_user_id: userId,
                    status: 'waiting'
                })
                .select()
                .single();

            if (createError) throw createError;
            room = newRoom;
        }

        // 参加者数をチェック
        const { count } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*', { count: 'exact' })
            .eq('room_id', room.id);

        if (count && count >= room.max_players) {
            return { success: false, error: "ルームが満員です" };
        }

        // ユーザーが既に参加している場合は何もしない
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
 * セッションベースで他のユーザー情報を取得
 */
async function getUsersByIdsFromSession(request: Request, userIds: string[], currentUser: User | null): Promise<{ [key: string]: User }> {
    const userMap: { [key: string]: User } = {};
    
    try {
        // Admin クライアントを作成
        const adminClient = createSupabaseAdminClient();
        
        if (!adminClient) {
            return await getUsersByIdsFromProfiles(request, userIds, currentUser);
        }
        
        // 各ユーザーIDに対して情報を設定
        for (const userId of userIds) {
            if (currentUser && userId === currentUser.id) {
                // 現在のユーザーは実際の情報を使用
                userMap[userId] = currentUser;
            } else {
                // 他のユーザー：Admin権限でauth.usersから取得
                try {
                    const { data: authData, error } = await adminClient.auth.admin.getUserById(userId);
                    
                    if (!error && authData?.user) {
                        const user = authData.user;
                        const metadata = user.user_metadata || {};
                        const customClaims = metadata.custom_claims || {};
                        
                        userMap[userId] = {
                            id: userId,
                            username: customClaims.global_name || 
                                     metadata.full_name || 
                                     metadata.name || 
                                     metadata.display_name ||
                                     metadata.username ||
                                     user.email?.split('@')[0] ||
                                     `Player${userId.slice(-4)}`,
                            avatar: metadata.avatar_url || metadata.picture,
                            email: user.email,
                            raw_user_meta_data: metadata
                        };
                    } else {
                        throw new Error(`Admin auth failed: ${error?.message}`);
                    }
                } catch (adminError) {
                    // Admin権限が使えない場合のフォールバック：プロファイルテーブルから取得
                    const fallbackData = await getUsersByIdsFromProfiles(request, [userId], null);
                    if (fallbackData[userId]) {
                        userMap[userId] = fallbackData[userId];
                    } else {
                        // 最終フォールバック
                        userMap[userId] = {
                            id: userId,
                            username: `Player${userId.slice(-4)}`,
                            email: undefined,
                            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                            raw_user_meta_data: undefined
                        };
                    }
                }
            }
        }
    } catch (error) {
        console.error('ユーザー情報取得エラー:', error);
        
        // エラーの場合は全てフォールバック
        for (const userId of userIds) {
            if (currentUser && userId === currentUser.id) {
                userMap[userId] = currentUser;
            } else {
                userMap[userId] = {
                    id: userId,
                    username: `Player${userId.slice(-4)}`,
                    email: undefined,
                    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                    raw_user_meta_data: undefined
                };
            }
        }
    }
    
    return userMap;
}

/**
 * プロファイルテーブルからユーザー情報を取得（フォールバック用）
 */
async function getUsersByIdsFromProfiles(request: Request, userIds: string[], currentUser: User | null): Promise<{ [key: string]: User }> {
    const userMap: { [key: string]: User } = {};
    const { supabase } = createSupabaseServerClient(request);
    
    try {
        // プロファイルテーブルからユーザー情報を取得
        const { data: profiles, error } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', userIds);
        
        if (error) {
            console.error('プロファイル取得エラー:', error);
        }
        
        // 各ユーザーIDに対して情報を設定
        for (const userId of userIds) {
            if (currentUser && userId === currentUser.id) {
                // 現在のユーザーは実際の情報を使用
                userMap[userId] = currentUser;
            } else {
                // プロファイルテーブルから取得した情報を使用
                const profile = profiles?.find((p: { id: string; username: string; avatar_url: string }) => p.id === userId);
                if (profile && profile.username) {
                    userMap[userId] = {
                        id: userId,
                        username: profile.username,
                        avatar: profile.avatar_url,
                        email: undefined,
                        raw_user_meta_data: undefined
                    };
                } else {
                    // プロファイルが見つからない場合のフォールバック
                    userMap[userId] = {
                        id: userId,
                        username: `Player${userId.slice(-4)}`,
                        email: undefined,
                        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                        raw_user_meta_data: undefined
                    };
                }
            }
        }
    } catch (error) {
        console.error('プロファイル取得エラー:', error);
        
        // エラーの場合は全てフォールバック
        for (const userId of userIds) {
            if (currentUser && userId === currentUser.id) {
                userMap[userId] = currentUser;
            } else {
                userMap[userId] = {
                    id: userId,
                    username: `Player${userId.slice(-4)}`,
                    email: undefined,
                    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                    raw_user_meta_data: undefined
                };
            }
        }
    }
    
    return userMap;
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

        // 参加者のユーザーIDリストを取得
        const userIds = participantsData?.map((p: RoomParticipant) => p.user_id) || [];
        
        // 現在のユーザー情報を取得
        const currentUser = await getCurrentUserData(request);
        
        // セッションベースでユーザー情報を取得
        const userMap = await getUsersByIdsFromSession(request, userIds, currentUser);
        
        // 参加者データにユーザー情報を結合
        const participants = participantsData?.map((participant: RoomParticipant) => ({
            ...participant,
            user: userMap[participant.user_id] || null
        })) || [];

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
): Promise<DatabaseResult<void>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUID(supabase, roomId);

        // 参加者から削除
        const { error: deleteError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .delete()
            .eq('room_id', actualRoomId)
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        // 参加者が0人になった場合はルームを削除
        const { count } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*', { count: 'exact' })
            .eq('room_id', actualRoomId);

        if (count === 0) {
            await supabase
                .from(DB_TABLES.GAME_ROOMS)
                .delete()
                .eq('id', actualRoomId);
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
 * プレイヤーをキック
 */
export async function kickPlayer(
    request: Request,
    roomId: string,
    hostUserId: string,
    targetUserId: string
): Promise<DatabaseResult<void>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUID(supabase, roomId);

        // ホスト権限を確認
        const { data: room } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('host_user_id')
            .eq('id', actualRoomId)
            .single();

        if (room?.host_user_id !== hostUserId) {
            return { success: false, error: "ホスト権限がありません" };
        }

        // 対象プレイヤーを削除
        const { error: deleteError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .delete()
            .eq('room_id', actualRoomId)
            .eq('user_id', targetUserId);

        if (deleteError) throw deleteError;

        return { success: true };
    } catch (error) {
        console.error('キックエラー:', error);
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
): Promise<DatabaseResult<void>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUID(supabase, roomId);

        // 現在の準備状態を取得
        const { data: participant, error: getError } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('is_ready')
            .eq('room_id', actualRoomId)
            .eq('user_id', userId)
            .single();

        if (getError) throw getError;

        // 準備状態を切り替え
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
 * ゲームを開始
 */
export async function startGame(
    request: Request,
    roomId: string,
    hostUserId: string
): Promise<DatabaseResult<void>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUID(supabase, roomId);

        // ホスト権限を確認
        const { data: room } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .select('host_user_id')
            .eq('id', actualRoomId)
            .single();

        if (room?.host_user_id !== hostUserId) {
            return { success: false, error: "ホスト権限がありません" };
        }

        // 参加者数と準備状態を確認
        const { data: participants } = await supabase
            .from(DB_TABLES.ROOM_PARTICIPANTS)
            .select('*')
            .eq('room_id', actualRoomId);

        if (!participants || participants.length < 2) {
            return { success: false, error: "最低2人のプレイヤーが必要です" };
        }

        const allReady = participants.every((p: any) => p.is_ready);
        if (!allReady) {
            return { success: false, error: "全員の準備完了が必要です" };
        }

        // ルームステータスを 'playing' に変更
        const { error: updateError } = await supabase
            .from(DB_TABLES.GAME_ROOMS)
            .update({ status: 'playing' })
            .eq('id', actualRoomId);

        if (updateError) throw updateError;

        // ゲーム状態を初期化
        const { error: gameStateError } = await supabase
            .from(DB_TABLES.GAME_STATES)
            .insert({
                room_id: actualRoomId,
                current_turn_user_id: participants[0].user_id,
                turn_number: 1,
                phase: 'rolling',
                game_data: {
                    columns: {},
                    tempMarkers: {},
                    completedColumns: {},
                    diceValues: [],
                    logs: [{ message: 'ゲーム開始！' }]
                }
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
 * ゲーム状態を取得
 */
export async function getGameState(
    request: Request,
    roomId: string
): Promise<DatabaseResult<GameState>> {
    const { supabase } = createSupabaseServerClient(request);

    try {
        const actualRoomId = await getRoomUUID(supabase, roomId);

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
 * roomIdからUUIDを取得するヘルパー関数
 */
async function getRoomUUID(supabase: any, roomId: string): Promise<string> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
    
    if (isUUID) {
        return roomId;
    }
    
    const { data: room, error } = await supabase
        .from(DB_TABLES.GAME_ROOMS)
        .select('id')
        .eq('room_id', roomId.toLowerCase())
        .single();
        
    if (error) throw error;
    return room.id;
}

