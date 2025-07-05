// Can't Stop ゲーム用のパフォーマンス最適化ヘルパー

/**
 * リアルタイム更新の頻度制限
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => void {
    let lastCall = 0;
    
    return (...args: Parameters<T>) => {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            func.apply(null, args);
        }
    };
}

/**
 * 連続する同じ更新をスキップ
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(null, args), delay);
    };
}

/**
 * オブジェクトの深い比較（浅い変更の無視）
 */
export function deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    
    if (obj1 == null || obj2 == null) return false;
    
    if (typeof obj1 !== typeof obj2) return false;
    
    if (typeof obj1 !== 'object') return obj1 === obj2;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
}

/**
 * 状態変更の最適化（変更がある場合のみ更新）
 */
export function createOptimizedUpdater<T>(
    setter: (value: T | ((prev: T) => T)) => void
) {
    return (newValue: T | ((prev: T) => T)) => {
        setter(prev => {
            const nextValue = typeof newValue === 'function' 
                ? (newValue as (prev: T) => T)(prev)
                : newValue;
            
            return deepEqual(prev, nextValue) ? prev : nextValue;
        });
    };
}

/**
 * メモ化キャッシュ（計算結果の再利用）
 */
export class MemoCache<K, V> {
    private cache = new Map<string, { value: V; timestamp: number }>();
    private maxSize: number;
    private ttl: number; // Time to live in milliseconds

    constructor(maxSize = 100, ttl = 5 * 60 * 1000) { // デフォルト5分
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    get(key: K): V | undefined {
        const keyStr = JSON.stringify(key);
        const item = this.cache.get(keyStr);
        
        if (!item) return undefined;
        
        // TTL チェック
        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(keyStr);
            return undefined;
        }
        
        return item.value;
    }

    set(key: K, value: V): void {
        const keyStr = JSON.stringify(key);
        
        // サイズ制限チェック
        if (this.cache.size >= this.maxSize && !this.cache.has(keyStr)) {
            // 最も古いエントリを削除
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }
        
        this.cache.set(keyStr, {
            value,
            timestamp: Date.now()
        });
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

/**
 * 組み合わせ計算のメモ化
 */
const combinationCache = new MemoCache<number[], number[][]>();

export function getCachedCombinations(diceValues: number[]): number[][] {
    const cached = combinationCache.get(diceValues);
    if (cached) return cached;
    
    const combinations = [
        [diceValues[0] + diceValues[1], diceValues[2] + diceValues[3]],
        [diceValues[0] + diceValues[2], diceValues[1] + diceValues[3]],
        [diceValues[0] + diceValues[3], diceValues[1] + diceValues[2]]
    ];
    
    combinationCache.set(diceValues, combinations);
    return combinations;
}

/**
 * バッチ更新（複数の状態変更をまとめる）
 */
export class BatchUpdater {
    private pendingUpdates: (() => void)[] = [];
    private isScheduled = false;

    schedule(updater: () => void): void {
        this.pendingUpdates.push(updater);
        
        if (!this.isScheduled) {
            this.isScheduled = true;
            // React の更新サイクルに合わせる
            requestAnimationFrame(() => {
                const updates = [...this.pendingUpdates];
                this.pendingUpdates = [];
                this.isScheduled = false;
                
                // すべての更新をまとめて実行
                updates.forEach(update => update());
            });
        }
    }
}

/**
 * リアルタイム通信の最適化設定
 */
export const REALTIME_OPTIMIZATION = {
    // 状態更新の頻度制限（ミリ秒）
    STATE_UPDATE_THROTTLE: 100,
    
    // UI更新の遅延（ミリ秒）
    UI_UPDATE_DEBOUNCE: 50,
    
    // 再接続の設定
    RECONNECT: {
        MAX_ATTEMPTS: 5,
        INITIAL_DELAY: 1000,
        MAX_DELAY: 30000,
        BACKOFF_FACTOR: 2
    },
    
    // キャッシュの設定
    CACHE: {
        MAX_SIZE: 100,
        TTL: 5 * 60 * 1000 // 5分
    }
} as const;

/**
 * 接続品質の測定
 */
export class ConnectionQualityMonitor {
    private latencyHistory: number[] = [];
    private maxHistory = 10;
    private lastPingTime = 0;

    measureLatency(): Promise<number> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            this.lastPingTime = startTime;
            
            // 簡単なping測定（実際のネットワーク測定ではなく処理時間）
            setTimeout(() => {
                const latency = Date.now() - startTime;
                this.addLatency(latency);
                resolve(latency);
            }, 0);
        });
    }

    private addLatency(latency: number): void {
        this.latencyHistory.push(latency);
        if (this.latencyHistory.length > this.maxHistory) {
            this.latencyHistory.shift();
        }
    }

    getAverageLatency(): number {
        if (this.latencyHistory.length === 0) return 0;
        
        const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
        return sum / this.latencyHistory.length;
    }

    getConnectionQuality(): 'excellent' | 'good' | 'fair' | 'poor' {
        const avgLatency = this.getAverageLatency();
        
        if (avgLatency < 50) return 'excellent';
        if (avgLatency < 100) return 'good';
        if (avgLatency < 200) return 'fair';
        return 'poor';
    }

    reset(): void {
        this.latencyHistory = [];
        this.lastPingTime = 0;
    }
}

/**
 * ゲーム状態の差分計算
 */
export function calculateGameStateDiff(
    oldState: any,
    newState: any
): {
    hasChanges: boolean;
    changedFields: string[];
    significantChanges: boolean;
} {
    const changedFields: string[] = [];
    const significantFields = [
        'current_turn_user_id',
        'phase',
        'game_data.columns',
        'game_data.tempMarkers',
        'game_data.completedColumns',
        'game_data.diceValues'
    ];

    // フィールドごとの変更チェック
    const checkField = (path: string, obj1: any, obj2: any) => {
        const keys = path.split('.');
        let val1 = obj1;
        let val2 = obj2;
        
        for (const key of keys) {
            val1 = val1?.[key];
            val2 = val2?.[key];
        }
        
        if (!deepEqual(val1, val2)) {
            changedFields.push(path);
            return true;
        }
        return false;
    };

    // 主要フィールドのチェック
    for (const field of significantFields) {
        checkField(field, oldState, newState);
    }

    const hasChanges = changedFields.length > 0;
    const significantChanges = changedFields.some(field => 
        significantFields.includes(field)
    );

    return {
        hasChanges,
        changedFields,
        significantChanges
    };
}