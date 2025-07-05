// Can't Stop ゲーム用の定数

import type { PlayerColor } from "~/libs/cant-stop/types";

// コラムの高さ設定（コラム番号: 必要段数）
export const COLUMN_HEIGHTS: { [key: number]: number } = {
    2: 3,
    3: 5,
    4: 7,
    5: 9,
    6: 11,
    7: 13,
    8: 11,
    9: 9,
    10: 7,
    11: 5,
    12: 3
};

// プレイヤーカラー
export const PLAYER_COLORS: PlayerColor[] = [
    'bg-red-500',
    'bg-blue-500', 
    'bg-green-500',
    'bg-yellow-500'
];

// プレイヤーカラーマッピング（ID順）
export const getPlayerColor = (index: number): PlayerColor => {
    return PLAYER_COLORS[index % PLAYER_COLORS.length];
};

// ゲーム設定
export const GAME_SETTINGS = {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 4,
    MAX_TEMP_MARKERS: 3,
    WINNING_COLUMNS: 3,
    DICE_COUNT: 4,
    BUST_DELAY_MS: 3000
} as const;

// ルームID設定
export const ROOM_ID_SETTINGS = {
    MIN_LENGTH: 3,
    MAX_LENGTH: 20,
    ALLOWED_PATTERN: /^[a-zA-Z0-9]+$/
} as const;

// UI設定
export const UI_SETTINGS = {
    LOG_MAX_DISPLAY: 8,
    COLUMN_CELL_HEIGHT: 24, // px
    ANIMATION_DURATION: 200 // ms
} as const;

// ゲームメッセージ
export const GAME_MESSAGES = {
    GAME_START: 'ゲーム開始！',
    BUST: 'バスト！一時進行がリセットされました',
    TURN_END: 'ターンを終了しました',
    NEXT_TURN: '次のプレイヤーのターンです',
    COLUMN_COMPLETED: (column: number) => `コラム${column}を完成`,
    VICTORY: (columns: number) => `${columns}つのコラムを完成させて勝利！`,
    DICE_ROLL: (dice: number[]) => `サイコロ: ${dice.join(', ')}`,
    COMBINATION_SELECTED: (combo: number[]) => `組み合わせ「${combo[0]}と${combo[1]}」を選択しました`,
    PROGRESS: '進行しました'
} as const;

// エラーメッセージ
export const ERROR_MESSAGES = {
    ROOM_ID_REQUIRED: 'ルームIDを入力してください',
    ROOM_ID_INVALID_CHARS: 'ルームIDは半角英数字のみで入力してください',
    ROOM_ID_INVALID_LENGTH: 'ルームIDは3文字以上20文字以下で入力してください',
    ROOM_FULL: 'ルームが満員です',
    ROOM_NOT_FOUND: 'ルームが見つかりません',
    NOT_HOST: 'ホスト権限がありません',
    NOT_ENOUGH_PLAYERS: '最低2人のプレイヤーが必要です',
    NOT_ALL_READY: '全員の準備完了が必要です',
    JOIN_FAILED: 'ルームへの参加に失敗しました'
} as const;

// データベーステーブル名
export const DB_TABLES = {
    GAME_ROOMS: 'game_rooms',
    ROOM_PARTICIPANTS: 'room_participants', 
    GAME_STATES: 'game_states',
    ROOM_WINS: 'room_wins',
    GAME_HISTORY: 'game_history'
} as const;

// リアルタイム通信チャンネル
export const REALTIME_CHANNELS = {
    ROOM_PREFIX: 'room:',
    GAME_PREFIX: 'game:'
} as const;