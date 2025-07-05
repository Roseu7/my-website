// Can't Stop ゲーム用のヘルパー関数

import type { GameData, Player } from "~/libs/cant-stop/types";
import { COLUMN_HEIGHTS, GAME_SETTINGS } from "./constants";

/**
 * ルームIDを正規化（小文字変換）
 */
export function normalizeRoomId(roomId: string): string {
    return roomId.toLowerCase().trim();
}

/**
 * ルームIDの妥当性をチェック
 */
export function validateRoomId(roomId: string): {
    isValid: boolean;
    error?: string;
} {
    if (!roomId || roomId.trim().length === 0) {
        return { isValid: false, error: "ルームIDが入力されていません" };
    }

    const trimmed = roomId.trim();
    
    if (trimmed.length < 3 || trimmed.length > 20) {
        return { isValid: false, error: "ルームIDは3文字以上20文字以下で入力してください" };
    }

    if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
        return { isValid: false, error: "ルームIDは半角英数字のみで入力してください" };
    }

    return { isValid: true };
}

/**
 * サイコロの組み合わせを計算
 */
export function calculateDiceCombinations(dice: number[]): number[][] {
    if (dice.length !== 4) {
        throw new Error("サイコロは4つ必要です");
    }

    return [
        [dice[0] + dice[1], dice[2] + dice[3]],
        [dice[0] + dice[2], dice[1] + dice[3]],
        [dice[0] + dice[3], dice[1] + dice[2]]
    ];
}

/**
 * 進行可能な組み合わせをフィルタリング
 */
export function getValidCombinations(
    combinations: number[][],
    gameData: GameData,
    currentPlayerId: string
): number[][] {
    return combinations.filter(combo => 
        combo.every(sum => {
            // 完成済みコラムは進行不可
            if (gameData.completedColumns[sum]) {
                return false;
            }

            // 3つまでの一時マーカー制限をチェック
            const tempMarkerCount = Object.keys(gameData.tempMarkers).length;
            const hasCurrentMarker = gameData.tempMarkers[sum] === currentPlayerId;
            
            if (tempMarkerCount >= GAME_SETTINGS.MAX_TEMP_MARKERS && !hasCurrentMarker) {
                return false;
            }

            return true;
        })
    );
}

/**
 * コラムが完成しているかチェック
 */
export function isColumnCompleted(column: number, progress: number): boolean {
    const requiredSteps = COLUMN_HEIGHTS[column];
    return progress >= requiredSteps;
}

/**
 * プレイヤーが勝利したかチェック
 */
export function checkPlayerVictory(playerId: string, gameData: GameData): boolean {
    const completedByPlayer = Object.values(gameData.completedColumns)
        .filter(winnerId => winnerId === playerId).length;
    
    return completedByPlayer >= GAME_SETTINGS.WINNING_COLUMNS;
}

/**
 * ゲーム状態から次のターンプレイヤーを決定
 */
export function getNextPlayer(playerIds: string[], currentPlayerId: string): string {
    const currentIndex = playerIds.findIndex(id => id === currentPlayerId);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    return playerIds[nextIndex];
}

/**
 * プレイヤーの進行状況を計算
 */
export function getPlayerProgress(
    playerId: string, 
    column: number, 
    gameData: GameData
): {
    permanentProgress: number;
    tempProgress: number;
    totalProgress: number;
} {
    const permanentProgress = gameData.columns[column]?.[playerId] || 0;
    const hasTemp = gameData.tempMarkers[column] === playerId ? 1 : 0;
    const totalProgress = permanentProgress + hasTemp;

    return {
        permanentProgress,
        tempProgress: hasTemp,
        totalProgress
    };
}

/**
 * コラムの中央揃え用オフセットを計算
 */
export function calculateColumnOffset(columnNumber: number): {
    topOffset: number;
    bottomOffset: number;
} {
    const height = COLUMN_HEIGHTS[columnNumber];
    const maxHeight = Math.max(...Object.values(COLUMN_HEIGHTS));
    
    const centerLine = Math.ceil(maxHeight / 2);
    const columnCenter = Math.ceil(height / 2);
    const topOffset = Math.max(0, centerLine - columnCenter);
    const bottomOffset = Math.max(0, maxHeight - height - topOffset);

    return { topOffset, bottomOffset };
}

/**
 * ゲームログメッセージを生成
 */
export function createGameLogMessage(
    type: 'dice_roll' | 'combination_selected' | 'progress' | 'stop' | 'bust' | 'column_completed' | 'victory',
    data?: any
): string {
    switch (type) {
        case 'dice_roll':
            return `サイコロ: ${data.dice.join(', ')}`;
        case 'combination_selected':
            return `組み合わせ「${data.combination[0]}と${data.combination[1]}」を選択`;
        case 'progress':
            return '進行しました';
        case 'stop':
            return 'ターンを終了しました';
        case 'bust':
            return 'バスト！一時進行がリセットされました';
        case 'column_completed':
            return `コラム${data.column}を完成`;
        case 'victory':
            return `${data.columns}つのコラムを完成させて勝利！`;
        default:
            return '';
    }
}

/**
 * 時間をフォーマット（ゲーム時間表示用）
 */
export function formatGameDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes === 0) {
        return `${remainingSeconds}秒`;
    }
    
    return `${minutes}分${remainingSeconds}秒`;
}

/**
 * 配列をシャッフル（プレイヤー順序等で使用）
 */
export function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * デバウンス関数（入力遅延用）
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
 * ローカルストレージのヘルパー（設定保存用）
 */
export const localStorage = {
    get: (key: string, defaultValue: any = null) => {
        if (typeof window === 'undefined') return defaultValue;
        
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },
    
    set: (key: string, value: any) => {
        if (typeof window === 'undefined') return;
        
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('ローカルストレージへの保存に失敗しました:', error);
        }
    },
    
    remove: (key: string) => {
        if (typeof window === 'undefined') return;
        
        try {
            window.localStorage.removeItem(key);
        } catch (error) {
            console.warn('ローカルストレージからの削除に失敗しました:', error);
        }
    }
};