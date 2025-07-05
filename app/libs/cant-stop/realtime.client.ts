import { getSupabaseBrowserClient } from "~/libs/supabase.client";
import type { RealtimeEvent, SupabaseUser } from "./types";
import { REALTIME_CHANNELS } from "~/utils/cant-stop/constants";

/**
 * 接続状態の管理
 */
interface ConnectionState {
    room: 'disconnected' | 'connecting' | 'connected' | 'error';
    game: 'disconnected' | 'connecting' | 'connected' | 'error';
    lastError?: string;
}

/**
 * ルーム専用のリアルタイム通信クライアント
 */
export class CantStopRealtimeClient {
    private supabase;
    private roomChannel: any = null;
    private gameChannel: any = null;
    private roomId: string;
    private connectionState: ConnectionState = {
        room: 'disconnected',
        game: 'disconnected'
    };
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000; // 1秒から開始
    private reconnectTimeouts: NodeJS.Timeout[] = [];
    private isDestroyed = false;

    constructor(roomId: string) {
        this.supabase = getSupabaseBrowserClient();
        this.roomId = roomId;
        
        // ページの可視性変更を監視
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        }
        
        // ウィンドウのunloadイベントを監視
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', this.cleanup.bind(this));
        }
    }

    /**
     * ページの可視性変更ハンドラー
     */
    private handleVisibilityChange() {
        if (document.hidden) {
            console.log('ページが非表示になりました');
        } else {
            console.log('ページが表示されました');
            this.checkAndReconnect();
        }
    }

    /**
     * 接続状態をチェックして必要に応じて再接続
     */
    private checkAndReconnect() {
        if (this.isDestroyed) return;
        
        const roomState = this.roomChannel?.state || 'disconnected';
        const gameState = this.gameChannel?.state || 'disconnected';
        
        if (roomState === 'closed' || roomState === 'errored') {
            console.log('ルームチャンネルの再接続が必要です');
            this.reconnectRoom();
        }
        
        if (gameState === 'closed' || gameState === 'errored') {
            console.log('ゲームチャンネルの再接続が必要です');
            this.reconnectGame();
        }
    }

    /**
     * ルーム情報の変更を購読（参加者の入退室、準備状態など）
     */
    subscribeToRoom(callbacks: {
        onParticipantChanged?: (participants: any[]) => void;
        onRoomStatusChanged?: (room: any) => void;
        onWinStatsChanged?: (winStats: any[]) => void;
        onConnectionStateChanged?: (state: ConnectionState) => void;
    }) {
        if (this.roomChannel) {
            this.unsubscribeFromRoom();
        }

        this.connectionState.room = 'connecting';
        this.notifyConnectionStateChange(callbacks.onConnectionStateChanged);

        const channelName = `${REALTIME_CHANNELS.ROOM_PREFIX}${this.roomId}`;
        this.roomChannel = this.supabase.channel(channelName);

        // 参加者の変更を監視
        this.roomChannel
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'room_participants',
                    filter: `room_id=eq.${this.roomId}`
                },
                async (payload: any) => {
                    console.log('参加者変更:', payload);
                    if (callbacks.onParticipantChanged) {
                        try {
                            // 最新の参加者一覧を取得
                            const { data } = await this.supabase
                                .from('room_participants')
                                .select('*')
                                .eq('room_id', this.roomId);
                            
                            callbacks.onParticipantChanged(data || []);
                        } catch (error) {
                            console.error('参加者データ取得エラー:', error);
                        }
                    }
                }
            );

        // ルーム状態の変更を監視
        this.roomChannel
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'game_rooms',
                    filter: `id=eq.${this.roomId}`
                },
                (payload: any) => {
                    console.log('ルーム状態変更:', payload);
                    if (callbacks.onRoomStatusChanged) {
                        callbacks.onRoomStatusChanged(payload.new);
                    }
                }
            );

        // 勝利統計の変更を監視
        this.roomChannel
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'room_wins',
                    filter: `room_id=eq.${this.roomId}`
                },
                async (payload: any) => {
                    console.log('勝利統計変更:', payload);
                    if (callbacks.onWinStatsChanged) {
                        try {
                            // 最新の勝利統計を取得
                            const { data } = await this.supabase
                                .from('room_wins')
                                .select('*')
                                .eq('room_id', this.roomId);
                            
                            callbacks.onWinStatsChanged(data || []);
                        } catch (error) {
                            console.error('勝利統計データ取得エラー:', error);
                        }
                    }
                }
            );

        // 接続状態の監視
        this.roomChannel.subscribe((status: string) => {
            console.log('ルームチャンネル接続状況:', status);
            
            switch (status) {
                case 'SUBSCRIBED':
                    this.connectionState.room = 'connected';
                    this.reconnectAttempts = 0;
                    break;
                case 'CHANNEL_ERROR':
                case 'TIMED_OUT':
                    this.connectionState.room = 'error';
                    this.connectionState.lastError = status;
                    this.scheduleReconnect('room');
                    break;
                case 'CLOSED':
                    this.connectionState.room = 'disconnected';
                    if (!this.isDestroyed) {
                        this.scheduleReconnect('room');
                    }
                    break;
            }
            
            this.notifyConnectionStateChange(callbacks.onConnectionStateChanged);
        });

        return this.roomChannel;
    }

    /**
     * ゲーム状態の変更を購読
     */
    subscribeToGame(callbacks: {
        onGameStateChanged?: (gameState: any) => void;
        onGameEnded?: (result: any) => void;
        onConnectionStateChanged?: (state: ConnectionState) => void;
    }) {
        if (this.gameChannel) {
            this.unsubscribeFromGame();
        }

        this.connectionState.game = 'connecting';
        this.notifyConnectionStateChange(callbacks.onConnectionStateChanged);

        const channelName = `${REALTIME_CHANNELS.GAME_PREFIX}${this.roomId}`;
        this.gameChannel = this.supabase.channel(channelName);

        // ゲーム状態の変更を監視
        this.gameChannel
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'game_states',
                    filter: `room_id=eq.${this.roomId}`
                },
                (payload: any) => {
                    console.log('ゲーム状態変更:', payload);
                    if (callbacks.onGameStateChanged) {
                        callbacks.onGameStateChanged(payload.new);
                    }
                }
            );

        // ゲーム履歴（ゲーム終了）を監視
        this.gameChannel
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'game_history',
                    filter: `room_id=eq.${this.roomId}`
                },
                (payload: any) => {
                    console.log('ゲーム終了:', payload);
                    if (callbacks.onGameEnded) {
                        callbacks.onGameEnded(payload.new);
                    }
                }
            );

        // 接続状態の監視
        this.gameChannel.subscribe((status: string) => {
            console.log('ゲームチャンネル接続状況:', status);
            
            switch (status) {
                case 'SUBSCRIBED':
                    this.connectionState.game = 'connected';
                    this.reconnectAttempts = 0;
                    break;
                case 'CHANNEL_ERROR':
                case 'TIMED_OUT':
                    this.connectionState.game = 'error';
                    this.connectionState.lastError = status;
                    this.scheduleReconnect('game');
                    break;
                case 'CLOSED':
                    this.connectionState.game = 'disconnected';
                    if (!this.isDestroyed) {
                        this.scheduleReconnect('game');
                    }
                    break;
            }
            
            this.notifyConnectionStateChange(callbacks.onConnectionStateChanged);
        });

        return this.gameChannel;
    }

    /**
     * 再接続のスケジューリング
     */
    private scheduleReconnect(channelType: 'room' | 'game') {
        if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log(`${channelType}チャンネルの再接続を断念しました`);
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

        console.log(`${channelType}チャンネルを${delay}ms後に再接続試行 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        const timeoutId = setTimeout(() => {
            if (!this.isDestroyed) {
                if (channelType === 'room') {
                    this.reconnectRoom();
                } else {
                    this.reconnectGame();
                }
            }
        }, delay);

        this.reconnectTimeouts.push(timeoutId);
    }

    /**
     * ルームチャンネルの再接続
     */
    private async reconnectRoom() {
        if (this.isDestroyed) return;
        
        console.log('ルームチャンネル再接続中...');
        this.unsubscribeFromRoom();
    }

    /**
     * ゲームチャンネルの再接続
     */
    private async reconnectGame() {
        if (this.isDestroyed) return;
        
        console.log('ゲームチャンネル再接続中...');
        this.unsubscribeFromGame();
    }

    /**
     * 接続状態変更の通知
     */
    private notifyConnectionStateChange(callback?: (state: ConnectionState) => void) {
        if (callback) {
            callback(this.connectionState);
        }
    }

    /**
     * ルーム購読の解除
     */
    unsubscribeFromRoom() {
        if (this.roomChannel) {
            this.roomChannel.unsubscribe();
            this.roomChannel = null;
            this.connectionState.room = 'disconnected';
        }
    }

    /**
     * ゲーム購読の解除
     */
    unsubscribeFromGame() {
        if (this.gameChannel) {
            this.gameChannel.unsubscribe();
            this.gameChannel = null;
            this.connectionState.game = 'disconnected';
        }
    }

    /**
     * 全購読の解除
     */
    unsubscribeAll() {
        this.unsubscribeFromRoom();
        this.unsubscribeFromGame();
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
 * ユーザー情報を整形するヘルパー関数
 */
export function formatUserFromAuth(authUser: SupabaseUser | any): { id: string; username: string; avatar?: string } | null {
    if (!authUser) return null;
    
    const metadata = authUser.raw_user_meta_data || authUser.user_metadata || {};
    const customClaims = metadata.custom_claims || {};
    
    return {
        id: authUser.id,
        username: customClaims.global_name || metadata.full_name || metadata.name || metadata.display_name || "User",
        avatar: metadata.avatar_url || metadata.picture
    };
}