// Can't Stop ゲーム用の型定義

export interface User {
    id: string;
    username: string;
    avatar?: string;
    email?: string;
    raw_user_meta_data?: any;
}

export interface GameRoom {
    id: string;
    room_id: string;
    host_user_id: string;
    status: 'waiting' | 'playing' | 'finished';
    max_players: number;
    created_at: string;
    updated_at: string;
}

export interface RoomParticipant {
    id: string;
    room_id: string;
    user_id: string;
    joined_at: string;
    is_ready: boolean;
    user?: User | null;
}

export interface GameState {
    id: string;
    room_id: string;
    current_turn_user_id: string | null;
    turn_number: number;
    game_data: GameData;
    phase: GamePhase;
    created_at: string;
    updated_at: string;
}

export interface GameData {
    columns: { [key: number]: { [playerId: string]: number } };
    tempMarkers: { [key: number]: string };
    completedColumns: { [key: number]: string };
    diceValues: number[];
    logs: GameLog[];
    selectedCombination?: number[]; // 選択中の組み合わせ
}

export interface GameLog {
    message: string;
    playerId?: string;
    timestamp?: string;
}

export interface RoomWins {
    id: string;
    room_id: string;
    user_id: string;
    wins_count: number;
    updated_at: string;
}

export interface GameHistory {
    id: string;
    room_id: string;
    winner_user_id: string;
    participants: string[]; // JSON配列としてデータベースに保存
    game_duration_seconds: number;
    completed_at: string;
}

// ゲームフェーズ（データベーススキーマに対応）
export type GamePhase = 'rolling' | 'choosing' | 'deciding' | 'stopped' | 'busting';

// プレイヤー情報（ゲーム中）
export interface Player {
    id: string;
    username: string;
    avatar?: string;
    color: PlayerColor;
    isCurrentTurn: boolean;
    isReady?: boolean;
    isHost?: boolean;
}

// プレイヤーカラー
export type PlayerColor = 
    | 'bg-red-500' 
    | 'bg-blue-500' 
    | 'bg-green-500' 
    | 'bg-yellow-500';

// サイコロの組み合わせ
export interface DiceCombination {
    dice1: number;
    dice2: number;
    sum1: number;
    sum2: number;
}

// ロビー状態
export interface LobbyState {
    room: GameRoom;
    participants: (RoomParticipant & { user: User | null })[];
    winStats: RoomWins[];
    currentUser: User;
    isHost: boolean;
}

// ゲーム状態（クライアント用）
export interface ClientGameState {
    room: GameRoom;
    players: Player[];
    gameState: GameState;
    currentUser: User;
    isCurrentTurn: boolean;
}

// 結果画面用
export interface GameResult {
    winner: Player;
    players: Player[];
    winStats: (RoomWins & { player: Player })[];
    gameHistory: GameLog[];
    roomId: string;
}

// リアルタイム通信用イベント
export interface RealtimeEvent {
    type: 'participant_joined' | 'participant_left' | 'ready_changed' | 'game_started' | 'game_state_updated' | 'game_ended';
    data: any;
    userId?: string;
    timestamp: string;
}

// エラー型
export interface DatabaseError {
    success: false;
    error: string | Error;
}

export interface DatabaseSuccess<T = any> {
    success: true;
    data?: T;
}

export type DatabaseResult<T = any> = DatabaseSuccess<T> | DatabaseError;

// Supabase特有の型
export interface SupabaseUser {
    id: string;
    email?: string;
    user_metadata?: {
        full_name?: string;
        name?: string;
        avatar_url?: string;
        custom_claims?: {
            global_name?: string;
        };
    };
}