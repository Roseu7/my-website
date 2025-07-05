import { useState } from "react";
import type { GameData, Player } from "~/libs/cant-stop/types";
import { COLUMN_HEIGHTS } from "~/utils/cant-stop/constants";
import { getPlayerProgress, calculateColumnOffset } from "~/utils/cant-stop/helpers";

interface GameBoardProps {
    gameData: GameData;
    players: Player[];
    onColumnClick?: (column: number) => void;
    highlightedColumns?: number[];
    isInteractive?: boolean;
}

export function GameBoard({ 
    gameData, 
    players, 
    onColumnClick, 
    highlightedColumns = [],
    isInteractive = false 
}: GameBoardProps) {
    const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);

    // コラム番号の配列（2-12）
    const columnNumbers = Object.keys(COLUMN_HEIGHTS).map(Number).sort((a, b) => a - b);
    
    // 最大高さを取得（中央揃え用）
    const maxHeight = Math.max(...Object.values(COLUMN_HEIGHTS));

    /**
     * 個別のコラムをレンダリング
     */
    const renderColumn = (columnNumber: number) => {
        const height = COLUMN_HEIGHTS[columnNumber];
        const { topOffset } = calculateColumnOffset(columnNumber);
        const isCompleted = Boolean(gameData.completedColumns[columnNumber]);
        const isHighlighted = highlightedColumns.includes(columnNumber);
        const isHovered = hoveredColumn === columnNumber;
        const hasTempMarker = Boolean(gameData.tempMarkers[columnNumber]);

        // セルの配列を生成（上から下へ）
        const cells = Array.from({ length: height }, (_, index) => {
            const cellPosition = height - index; // 1が最上段
            
            // このセルにいるプレイヤーを検索
            const playersAtCell = players.filter(player => {
                const progress = getPlayerProgress(columnNumber, player.id, gameData);
                return progress.totalProgress === cellPosition;
            });

            // 一時マーカーがあるプレイヤー
            const tempPlayer = players.find(p => gameData.tempMarkers[columnNumber] === p.id);
            const isThisCellTemp = tempPlayer && getPlayerProgress(columnNumber, tempPlayer.id, gameData).totalProgress === cellPosition;

            return {
                position: cellPosition,
                players: playersAtCell,
                isTemp: isThisCellTemp,
                tempPlayer: isThisCellTemp ? tempPlayer : null
            };
        });

        return (
            <div
                key={columnNumber}
                className={`flex flex-col items-center ${
                    isInteractive ? 'cursor-pointer' : ''
                } transition-all duration-200`}
                onClick={() => isInteractive && onColumnClick?.(columnNumber)}
                onMouseEnter={() => isInteractive && setHoveredColumn(columnNumber)}
                onMouseLeave={() => isInteractive && setHoveredColumn(null)}
            >
                {/* コラム番号 */}
                <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm mb-2 transition-colors
                    ${isCompleted ? 'bg-gray-400 text-white' : 
                      isHighlighted ? 'bg-yellow-400 text-gray-900' :
                      isHovered ? 'bg-gray-200 text-gray-900' :
                      'bg-gray-100 text-gray-700'}
                `}>
                    {columnNumber}
                </div>

                {/* 上部のオフセット（中央揃え用） */}
                {Array.from({ length: topOffset }, (_, i) => (
                    <div key={`offset-${i}`} className="w-6 h-6 mb-1" />
                ))}

                {/* コラムのセル */}
                <div className="flex flex-col space-y-1">
                    {cells.map((cell, cellIndex) => (
                        <div
                            key={cellIndex}
                            className={`
                                w-6 h-6 border-2 rounded transition-all duration-200 relative
                                ${isCompleted ? 'border-gray-400 bg-gray-200' :
                                  hasTempMarker && cell.isTemp ? 'border-yellow-400 bg-yellow-100' :
                                  'border-gray-300 bg-white'}
                                ${isHovered ? 'border-blue-400' : ''}
                            `}
                        >
                            {/* プレイヤーマーカー */}
                            {cell.players.map((player, playerIndex) => (
                                <div
                                    key={player.id}
                                    className={`
                                        absolute inset-0 rounded ${player.color} 
                                        ${cell.isTemp && cell.tempPlayer?.id === player.id ? 
                                          'opacity-70 animate-pulse' : 'opacity-90'}
                                    `}
                                    style={{
                                        transform: playerIndex > 0 ? `translate(${playerIndex * 2}px, ${playerIndex * 2}px)` : 'none',
                                        zIndex: playerIndex + 1
                                    }}
                                    title={`${player.username} - ${cell.isTemp ? '一時' : '確定'}`}
                                />
                            ))}

                            {/* 進行状況の数字表示（デバッグ用、必要に応じて表示） */}
                            {process.env.NODE_ENV === 'development' && cell.players.length > 0 && (
                                <div className="absolute -top-2 -right-2 text-xs bg-black text-white rounded-full w-4 h-4 flex items-center justify-center">
                                    {cell.position}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* コラム高さ表示 */}
                <div className="text-xs text-gray-500 mt-2">
                    {height}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">ゲームボード</h3>
                <div className="text-sm text-gray-500">
                    完成: {Object.keys(gameData.completedColumns).length}/{columnNumbers.length}
                </div>
            </div>

            {/* ボード本体 */}
            <div className="flex justify-center">
                <div className="inline-flex space-x-3 p-4 bg-gray-50 rounded-lg">
                    {columnNumbers.map(renderColumn)}
                </div>
            </div>

            {/* 凡例 */}
            <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
                {players.map(player => (
                    <div key={player.id} className="flex items-center space-x-2">
                        <div className={`w-4 h-4 rounded ${player.color}`} />
                        <span className="text-gray-700">{player.username}</span>
                        {player.isCurrentTurn && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                ターン中
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* ゲーム状態の表示 */}
            {gameData.tempMarkers && Object.keys(gameData.tempMarkers).length > 0 && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
                        <span className="text-sm text-yellow-800 font-medium">
                            一時マーカー: コラム {Object.keys(gameData.tempMarkers).join(', ')}
                        </span>
                    </div>
                </div>
            )}

            {/* インタラクティブモードの説明 */}
            {isInteractive && (
                <div className="mt-4 text-center text-sm text-gray-500">
                    コラムをクリックして選択してください
                </div>
            )}
        </div>
    );
}