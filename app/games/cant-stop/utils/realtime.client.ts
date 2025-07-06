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
    private maxReconnectAttempts = 5; // 試行回数を減らす
    private isDestroyed = false;
    private isInitialized = false;

    constructor(roomId: string) {
        this.roomId = roomId;
        
        console.log('CantStopRealtimeClient初期化開始 - roomId:', roomId);
        
        // 重複初期化防止
        if (this.isInitialized) {
            console.warn('既に初期化されているクライアントです');
            return;
        }
        this.isInitialized = true;
        
        try {
            this.supabase = getSupabaseBrowserClient();
            console.log('Supabaseクライアントを初期化しました');
        } catch (error) {
            console.error('Supabaseクライアントの初期化に失敗:', error);
            this.supabase = null;
            this.connectionState.room = 'error';
            this.connectionState.game = 'error';
            this.connectionState.lastError = 'Supabaseクライアントの初期化に失敗しました';
        }

        // ページの可視性変更を監視（より安全に）
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
            // 再接続試行回数をリセット
            this.reconnectAttempts = 0;
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
     * 再接続の試行（より穏やかに）
     */
    private attemptReconnect() {
        if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log(`再接続を停止します (試行回数: ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.connectionState.room = 'error';
            this.connectionState.game = 'error';
            this.connectionState.lastError = '再接続に失敗しました';
            return;
        }

        this.reconnectAttempts++;
        // さらに長い間隔で再接続を試行
        const delay = Math.min(5000 * this.reconnectAttempts, 60000); // 5秒から60秒まで

        console.log(`再接続を試行します (${this.reconnectAttempts}/${this.maxReconnectAttempts}) - ${delay}ms後`);

        const timeoutId = setTimeout(() => {
            if (!this.isDestroyed) {
                console.log('再接続実行中...');
                this.unsubscribeAll();
                // より長い待機時間
                setTimeout(() => {
                    if (!this.isDestroyed) {
                        console.log('チャンネル再初期化中...');
                        this.initializeChannels();
                    }
                }, 3000);
            }
        }, delay);

        this.reconnectTimeouts.push(timeoutId);
    }

    /**
     * チャンネルの初期化（シンプル化）
     */
    private initializeChannels() {
        if (!this.supabase || this.isDestroyed) {
            console.error('Supabaseクライアントが初期化されていません');
            this.connectionState.lastError = 'Supabaseクライアントが利用できません';
            return;
        }

        try {
            // より軽量な設定でチャンネルを初期化
            this.roomChannel = this.supabase.channel(`room-${this.roomId}`, {
                config: {
                    broadcast: { self: false }
                }
            });

            this.gameChannel = this.supabase.channel(`game-${this.roomId}`, {
                config: {
                    broadcast: { self: false }
                }
            });

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
                    this.reconnectAttempts = 0;
                    console.log('ルームチャンネルに正常に接続しました');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    this.connectionState.room = 'error';
                    this.connectionState.lastError = `ルームチャンネル: ${status}`;
                    console.error('ルームチャンネルでエラー:', status);
                    
                    // エラー時の再接続は最初の数回のみ
                    if (this.reconnectAttempts < 2) {
                        setTimeout(() => this.attemptReconnect(), 10000);
                    } else {
                        console.log('ルームチャンネルの再接続を停止します');
                    }
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
                    this.reconnectAttempts = 0;
                    console.log('ゲームチャンネルに正常に接続しました');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    this.connectionState.game = 'error';
                    this.connectionState.lastError = `ゲームチャンネル: ${status}`;
                    console.error('ゲームチャンネルでエラー:', status);
                    
                    // エラー時の再接続は最初の数回のみ
                    if (this.reconnectAttempts < 2) {
                        setTimeout(() => this.attemptReconnect(), 10000);
                    } else {
                        console.log('ゲームチャンネルの再接続を停止します');
                    }
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
        try {
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
        } catch (error) {
            console.error('購読解除エラー:', error);
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
        
        setTimeout(() => {
            this.checkAndReconnect();
        }, 2000);
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