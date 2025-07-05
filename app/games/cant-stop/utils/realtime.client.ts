import { getSupabaseBrowserClient } from "~/libs/supabase.client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// 型定義
interface ConnectionState {
    room: "connected" | "disconnected" | "error" | "connecting";
    game: "connected" | "disconnected" | "error" | "connecting";
    lastError?: string;
}

interface RoomSubscriptionCallbacks {
    onParticipantChanged?: (participants: any[]) => void;
    onRoomStatusChanged?: (room: any) => void;
    onWinStatsChanged?: (winStats: any[]) => void;
    onConnectionStateChanged?: (state: ConnectionState) => void;
}

interface GameSubscriptionCallbacks {
    onGameStateChanged?: (gameState: any) => void;
    onGameEnded?: (result: any) => void;
    onConnectionStateChanged?: (state: ConnectionState) => void;
}

/**
 * Can't Stop ゲーム用のリアルタイムクライアント
 */
export class CantStopRealtimeClient {
    private supabase: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    private roomId: string;
    private roomChannel: RealtimeChannel | null = null;
    private gameChannel: RealtimeChannel | null = null;
    private connectionState: ConnectionState = {
        room: 'disconnected',
        game: 'disconnected'
    };
    private reconnectTimeouts: NodeJS.Timeout[] = [];
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isDestroyed = false;

    constructor(roomId: string) {
        this.roomId = roomId;
        
        console.log('CantStopRealtimeClient初期化開始 - roomId:', roomId);
        
        try {
            this.supabase = getSupabaseBrowserClient();
            console.log('Supabaseクライアントを初期化しました');
            
            // Supabaseの設定情報をログ出力
            console.log('Supabase URL確認:', import.meta.env.VITE_SUPABASE_URL?.substring(0, 30) + '...');
        } catch (error) {
            console.error('Supabaseクライアントの初期化に失敗:', error);
            this.supabase = null;
            this.connectionState.room = 'error';
            this.connectionState.game = 'error';
            this.connectionState.lastError = 'Supabaseクライアントの初期化に失敗しました';
        }

        // ページの可視性変更を監視
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        }

        // ページアンロード時のクリーンアップ
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', this.cleanup.bind(this));
        }
    }

    /**
     * ページの可視性変更ハンドラー
     */
    private handleVisibilityChange() {
        if (document.visibilityState === 'visible') {
            console.log('ページが表示されました。接続状態を確認します');
            this.checkAndReconnect();
        }
    }

    /**
     * 接続状態の確認と再接続
     */
    private checkAndReconnect() {
        if (this.isDestroyed) return;

        const roomConnected = this.roomChannel?.state === 'joined';
        const gameConnected = this.gameChannel?.state === 'joined';

        if (!roomConnected || !gameConnected) {
            console.log('切断を検出しました。再接続を試行します');
            this.attemptReconnect();
        }
    }

    /**
     * 再接続の試行
     */
    private attemptReconnect() {
        if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('再接続の最大試行回数に達しました');
            this.connectionState.room = 'error';
            this.connectionState.game = 'error';
            this.connectionState.lastError = '再接続に失敗しました';
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);

        console.log(`再接続を試行します (${this.reconnectAttempts}/${this.maxReconnectAttempts}) - ${delay}ms後`);

        const timeoutId = setTimeout(() => {
            if (!this.isDestroyed) {
                this.cleanup();
                // 少し待ってから再初期化
                setTimeout(() => {
                    if (!this.isDestroyed) {
                        this.initializeChannels();
                    }
                }, 500);
            }
        }, delay);

        this.reconnectTimeouts.push(timeoutId);
    }

    /**
     * チャンネルの初期化
     */
    private initializeChannels() {
        if (!this.supabase) {
            console.error('Supabaseクライアントが初期化されていません');
            this.connectionState.lastError = 'Supabaseクライアントが利用できません';
            return;
        }

        try {
            // ルームチャンネルの初期化（シンプルな設定）
            this.roomChannel = this.supabase.channel(`room-${this.roomId}`);

            // ゲームチャンネルの初期化（シンプルな設定）
            this.gameChannel = this.supabase.channel(`game-${this.roomId}`);

            console.log('チャンネルを初期化しました');
        } catch (error) {
            console.error('チャンネルの初期化に失敗:', error);
            this.connectionState.lastError = 'チャンネルの初期化に失敗しました';
        }
    }

    /**
     * ルームの変更を購読
     */
    subscribeToRoom(callbacks: RoomSubscriptionCallbacks) {
        if (!this.roomChannel) {
            this.initializeChannels();
        }

        if (!this.roomChannel) {
            console.error('ルームチャンネルが初期化されていません');
            callbacks.onConnectionStateChanged?.({
                ...this.connectionState,
                room: 'error',
                lastError: 'ルームチャンネルの初期化に失敗'
            });
            return;
        }

        this.connectionState.room = 'connecting';
        callbacks.onConnectionStateChanged?.(this.connectionState);

        this.roomChannel
            // ブロードキャストイベントを監視（postgres_changesの代わり）
            .on('broadcast', { event: 'participant_update' }, (payload) => {
                console.log('参加者の変更を受信:', payload);
                callbacks.onParticipantChanged?.(payload.payload.participants || []);
            })
            .on('broadcast', { event: 'room_update' }, (payload) => {
                console.log('ルーム状態の変更を受信:', payload);
                callbacks.onRoomStatusChanged?.(payload.payload.room);
            })
            .on('broadcast', { event: 'win_stats_update' }, (payload) => {
                console.log('勝利統計の変更を受信:', payload);
                callbacks.onWinStatsChanged?.(payload.payload.winStats || []);
            })
            .subscribe((status) => {
                console.log('ルームチャンネルの状態:', status);
                
                if (status === 'SUBSCRIBED') {
                    this.connectionState.room = 'connected';
                    this.reconnectAttempts = 0; // 成功時はリセット
                    console.log('ルームチャンネルに正常に接続しました');
                } else if (status === 'CHANNEL_ERROR') {
                    this.connectionState.room = 'error';
                    this.connectionState.lastError = 'ルームチャンネルでエラーが発生しました';
                    console.error('ルームチャンネルでエラーが発生:', status);
                    
                    // エラー時は再接続を試行
                    setTimeout(() => this.attemptReconnect(), 1000);
                } else if (status === 'TIMED_OUT') {
                    this.connectionState.room = 'error';
                    this.connectionState.lastError = 'ルームチャンネルの接続がタイムアウトしました';
                    console.error('ルームチャンネルの接続がタイムアウト');
                    
                    // タイムアウト時も再接続を試行
                    setTimeout(() => this.attemptReconnect(), 2000);
                } else if (status === 'CLOSED') {
                    this.connectionState.room = 'disconnected';
                    this.connectionState.lastError = 'ルームチャンネルが閉じられました';
                    console.warn('ルームチャンネルが閉じられました');
                    
                    // 閉じられた場合も再接続を試行
                    setTimeout(() => this.attemptReconnect(), 3000);
                } else {
                    this.connectionState.room = 'connecting';
                }
                
                callbacks.onConnectionStateChanged?.(this.connectionState);
            });
    }

    /**
     * ゲーム状態の変更を購読
     */
    subscribeToGame(callbacks: GameSubscriptionCallbacks) {
        if (!this.gameChannel) {
            this.initializeChannels();
        }

        if (!this.gameChannel) {
            console.error('ゲームチャンネルが初期化されていません');
            callbacks.onConnectionStateChanged?.({
                ...this.connectionState,
                game: 'error',
                lastError: 'ゲームチャンネルの初期化に失敗'
            });
            return;
        }

        this.connectionState.game = 'connecting';
        callbacks.onConnectionStateChanged?.(this.connectionState);

        this.gameChannel
            .on('broadcast', { event: 'game_state_update' }, (payload) => {
                console.log('ゲーム状態の変更を受信:', payload);
                callbacks.onGameStateChanged?.(payload.payload.gameState);
            })
            .on('broadcast', { event: 'game_ended' }, (payload) => {
                console.log('ゲーム終了イベントを受信:', payload);
                callbacks.onGameEnded?.(payload.payload);
            })
            .subscribe((status) => {
                console.log('ゲームチャンネルの状態:', status);
                
                if (status === 'SUBSCRIBED') {
                    this.connectionState.game = 'connected';
                    this.reconnectAttempts = 0; // 成功時はリセット
                    console.log('ゲームチャンネルに正常に接続しました');
                } else if (status === 'CHANNEL_ERROR') {
                    this.connectionState.game = 'error';
                    this.connectionState.lastError = 'ゲームチャンネルでエラーが発生しました';
                    console.error('ゲームチャンネルでエラーが発生:', status);
                    
                    // エラー時は再接続を試行
                    setTimeout(() => this.attemptReconnect(), 1000);
                } else if (status === 'TIMED_OUT') {
                    this.connectionState.game = 'error';
                    this.connectionState.lastError = 'ゲームチャンネルの接続がタイムアウトしました';
                    console.error('ゲームチャンネルの接続がタイムアウト');
                    
                    // タイムアウト時も再接続を試行
                    setTimeout(() => this.attemptReconnect(), 2000);
                } else if (status === 'CLOSED') {
                    this.connectionState.game = 'disconnected';
                    this.connectionState.lastError = 'ゲームチャンネルが閉じられました';
                    console.warn('ゲームチャンネルが閉じられました');
                    
                    // 閉じられた場合も再接続を試行
                    setTimeout(() => this.attemptReconnect(), 3000);
                } else {
                    this.connectionState.game = 'connecting';
                }
                
                callbacks.onConnectionStateChanged?.(this.connectionState);
            });
    }

    /**
     * 接続状態の変更通知
     */
    onConnectionStateChanged(callback: (state: ConnectionState) => void) {
        if (callback) {
            callback(this.connectionState);
        }
    }

    /**
     * 全購読の解除
     */
    unsubscribeAll() {
        if (this.roomChannel) {
            this.roomChannel.unsubscribe();
            this.roomChannel = null;
            this.connectionState.room = 'disconnected';
        }
        
        if (this.gameChannel) {
            this.gameChannel.unsubscribe();
            this.gameChannel = null;
            this.connectionState.game = 'disconnected';
        }
    }

    /**
     * クリーンアップ
     */
    cleanup() {
        this.isDestroyed = true;
        
        // タイムアウトをクリア
        this.reconnectTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        this.reconnectTimeouts = [];
        
        // 購読を解除
        this.unsubscribeAll();
        
        // イベントリスナーを削除
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        }
        
        if (typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', this.cleanup.bind(this));
        }
        
        console.log('リアルタイムクライアントをクリーンアップしました');
    }

    /**
     * 接続状態を確認
     */
    getConnectionStatus(): ConnectionState {
        return { ...this.connectionState };
    }

    /**
     * 手動再接続
     */
    async forceReconnect() {
        console.log('手動再接続を実行します');
        this.reconnectAttempts = 0;
        this.unsubscribeAll();
        
        // 少し待ってから再接続
        setTimeout(() => {
            this.checkAndReconnect();
        }, 1000);
    }
}

/**
 * リアルタイムクライアントのファクトリー関数
 */
export function createRealtimeClient(roomId: string): CantStopRealtimeClient {
    return new CantStopRealtimeClient(roomId);
}

/**
 * ユーザー情報を整形するヘルパー関数（クライアント用）
 */
export function formatUserFromAuth(authUser: any): { id: string; username: string; avatar?: string } | null {
    if (!authUser) {
        console.log('authUser is null or undefined');
        return null;
    }
    
    console.log('Formatting user:', authUser);
    
    // 既に整形済みの場合
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
    
    const formattedUser = {
        id: authUser.id,
        username: customClaims.global_name || 
                 metadata.full_name || 
                 metadata.name || 
                 metadata.display_name || 
                 authUser.email?.split('@')[0] || 
                 "User",
        avatar: metadata.avatar_url || metadata.picture
    };
    
    console.log('Formatted user result:', formattedUser);
    return formattedUser;
}