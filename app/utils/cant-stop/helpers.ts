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
    const trimmed = roomId.trim();
    
    if (trimmed.length === 0) {
        return { isValid: false, error: "ルームIDを入力してください" };
    }
    
    if (trimmed.length < 3) {
        return { isValid: false, error: "ルームIDは3文字以上で入力してください" };
    }
    
    if (trimmed.length > 20) {
        return { isValid: false, error: "ルームIDは20文字以下で入力してください" };
    }
    
    if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
        return { isValid: false, error: "ルームIDは半角英数字のみで入力してください" };
    }
    
    return { isValid: true };
}

/**
 * サイコロの全組み合わせを計算
 */
export function calculateDiceCombinations(diceValues: number[]): number[][] {
    if (diceValues.length !== 4) return [];
    
    const [d1, d2, d3, d4] = diceValues;
    
    // 3つの可能な組み合わせ
    return [
        [d1 + d2, d3 + d4].sort((a, b) => a - b),
        [d1 + d3, d2 + d4].sort((a, b) => a - b),
        [d1 + d4, d2 + d3].sort((a, b) => a - b)
    ];
}

/**
 * 進行可能な組み合わせをフィルタリング
 */
export function getValidCombinations(
    allCombinations: number[][],
    gameData: GameData,
    playerId: string
): number[][] {
    return allCombinations.filter(combination => {
        // 一時マーカーが3つ使用されている場合、既に一時マーカーがあるコラムのみ
        const tempMarkerCount = Object.keys(gameData.tempMarkers || {}).length;
        
        if (tempMarkerCount >= GAME_SETTINGS.MAX_TEMP_MARKERS) {
            return combination.every(column => 
                gameData.tempMarkers?.[column] === playerId
            );
        }
        
        // 完成したコラムは使用不可
        return combination.every(column => 
            !gameData.completedColumns?.[column]
        );
    });
}

/**
 * コラムが完成しているかチェック
 */
export function isColumnCompleted(column: number, progress: number): boolean {
    const requiredHeight = COLUMN_HEIGHTS[column];
    return progress >= requiredHeight;
}

/**
 * プレイヤーの勝利条件をチェック
 */
export function checkPlayerVictory(playerId: string, gameData: GameData): boolean {
    const completedCount = Object.values(gameData.completedColumns)
        .filter(completerId => completerId === playerId)
        .length;
    
    return completedCount >= GAME_SETTINGS.WINNING_COLUMNS;
}

/**
 * 次のプレイヤーを取得
 */
export function getNextPlayer(
    currentPlayerId: string,
    players: Player[]
): Player | null {
    const currentIndex = players.findIndex(p => p.id === currentPlayerId);
    if (currentIndex === -1) return null;
    
    const nextIndex = (currentIndex + 1) % players.length;
    return players[nextIndex];
}

/**
 * プレイヤーの進行状況を取得
 */
export function getPlayerProgress(
    column: number,
    playerId: string,
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
            console.error('LocalStorage設定エラー:', error);
        }
    },
    
    remove: (key: string) => {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(key);
    }
};

/**
 * プレイヤー名の表示用フォーマット
 */
export function formatPlayerName(player: Player, maxLength: number = 12): string {
    if (player.username.length <= maxLength) {
        return player.username;
    }
    
    return player.username.slice(0, maxLength - 3) + '...';
}

/**
 * コラム番号から表示用ラベルを生成
 */
export function getColumnLabel(column: number): string {
    return column.toString();
}

/**
 * ゲーム進行率を計算（統計表示用）
 */
export function calculateGameProgress(gameData: GameData): {
    totalMoves: number;
    averageProgressPerColumn: number;
    completionRate: number;
} {
    const totalColumns = Object.keys(COLUMN_HEIGHTS).length;
    const completedColumns = Object.keys(gameData.completedColumns).length;
    const totalMoves = gameData.logs.filter(log => 
        log.message.includes('進行') || log.message.includes('完成')
    ).length;
    
    let totalProgress = 0;
    Object.keys(COLUMN_HEIGHTS).forEach(col => {
        const column = parseInt(col);
        const maxHeight = COLUMN_HEIGHTS[column];
        const playerProgresses = Object.values(gameData.columns[column] || {});
        const maxProgress = Math.max(0, ...playerProgresses);
        totalProgress += Math.min(maxProgress, maxHeight) / maxHeight;
    });
    
    return {
        totalMoves,
        averageProgressPerColumn: totalProgress / totalColumns,
        completionRate: completedColumns / totalColumns
    };
}

/**
 * ランダムなルームIDを生成
 */
export function generateRandomRoomId(length: number = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
}