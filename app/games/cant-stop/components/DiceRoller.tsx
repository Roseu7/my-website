import { useState, useEffect } from "react";
import { Form } from "@remix-run/react";

interface DiceRollerProps {
    diceValues: number[];
    isRolling?: boolean;
    canRoll?: boolean;
    showCombinations?: boolean;
    availableCombinations?: number[][];
    selectedCombination?: number[] | null;
    onCombinationSelect?: (combination: number[]) => void;
    isSubmitting?: boolean;
    onDiceRoll?: (event: React.FormEvent<HTMLFormElement>) => void;
    gamePhase?: string;
    isCurrentTurn?: boolean;
}

// サイコロの組み合わせを計算するローカル関数
function calculateDiceCombinations(diceValues: number[]): number[][] {
    if (diceValues.length !== 4) return [];
    
    const [d1, d2, d3, d4] = diceValues;
    
    // 3つの可能な組み合わせ
    return [
        [d1 + d2, d3 + d4].sort((a, b) => a - b),
        [d1 + d3, d2 + d4].sort((a, b) => a - b),
        [d1 + d4, d2 + d3].sort((a, b) => a - b)
    ];
}

export function DiceRoller({
    diceValues,
    isRolling = false,
    canRoll = false,
    showCombinations = false,
    availableCombinations = [],
    selectedCombination,
    onCombinationSelect,
    isSubmitting = false,
    onDiceRoll,
    gamePhase,
    isCurrentTurn = false
}: DiceRollerProps) {
    const [animatingDice, setAnimatingDice] = useState<boolean[]>([]);
    const [showDiceAnimation, setShowDiceAnimation] = useState(false);

    // サイコロアニメーション効果
    useEffect(() => {
        if (isRolling) {
            setShowDiceAnimation(true);
            setAnimatingDice(new Array(4).fill(true));
            
            // アニメーション終了
            const timer = setTimeout(() => {
                setAnimatingDice(new Array(4).fill(false));
                setShowDiceAnimation(false);
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [isRolling]);

    /**
     * サイコロの面を描画
     */
    const renderDiceFace = (value: number, index: number) => {
        const isAnimating = animatingDice[index] || showDiceAnimation;
        const dots = getDiceDots(isAnimating ? Math.floor(Math.random() * 6) + 1 : value);

        return (
            <div
                key={index}
                className={`
                    w-16 h-16 bg-white border-2 border-gray-300 rounded-lg 
                    flex items-center justify-center shadow-md transition-all duration-150
                    ${isAnimating ? 'animate-bounce' : ''}
                `}
            >
                <div className="grid grid-cols-3 gap-1 w-12 h-12">
                    {dots.map((hasDot, dotIndex) => (
                        <div
                            key={dotIndex}
                            className={`
                                w-2 h-2 rounded-full transition-all duration-100
                                ${hasDot ? 'bg-gray-800' : 'bg-transparent'}
                            `}
                        />
                    ))}
                </div>
            </div>
        );
    };

    /**
     * サイコロの目のパターンを取得
     */
    const getDiceDots = (value: number): boolean[] => {
        const patterns: { [key: number]: boolean[] } = {
            1: [false, false, false, false, true, false, false, false, false],
            2: [true, false, false, false, false, false, false, false, true],
            3: [true, false, false, false, true, false, false, false, true],
            4: [true, false, true, false, false, false, true, false, true],
            5: [true, false, true, false, true, false, true, false, true],
            6: [true, false, true, true, false, true, true, false, true]
        };
        
        return patterns[value] || patterns[1];
    };

    /**
     * 組み合わせの表示用テキスト
     */
    const getCombinationText = (combination: number[]): string => {
        return `${combination[0]} + ${combination[1]}`;
    };

    /**
     * 組み合わせが選択されているかチェック
     */
    const isCombinationSelected = (combination: number[]): boolean => {
        if (!selectedCombination) return false;
        return selectedCombination.length === combination.length &&
               selectedCombination.every((val, index) => val === combination[index]);
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">サイコロ</h3>

            {/* サイコロ表示 */}
            <div className="flex justify-center mb-6">
                <div className="flex space-x-3">
                    {diceValues.length === 4 ? (
                        diceValues.map((value, index) => renderDiceFace(value, index))
                    ) : (
                        // 初期状態（サイコロが振られていない）
                        Array.from({ length: 4 }, (_, index) => (
                            <div
                                key={index}
                                className="w-16 h-16 bg-gray-100 border-2 border-gray-300 rounded-lg flex items-center justify-center"
                            >
                                <div className="text-gray-400 text-sm">?</div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* サイコロの合計表示 */}
            {diceValues.length === 4 && !isRolling && (
                <div className="text-center mb-4">
                    <div className="text-sm text-gray-600">
                        合計: {diceValues.reduce((sum, val) => sum + val, 0)}
                    </div>
                    <div className="text-xs text-gray-500">
                        ({diceValues.join(' + ')})
                    </div>
                </div>
            )}

            {/* サイコロを振るボタン */}
            {canRoll && (
                <div className="text-center mb-6">
                    <Form method="post" onSubmit={onDiceRoll}>
                        <input type="hidden" name="_action" value="roll_dice" />
                        <button
                            type="submit"
                            disabled={isRolling || isSubmitting || !canRoll}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                        >
                            {isRolling ? 'サイコロを振っています...' : 'サイコロを振る'}
                        </button>
                    </Form>
                </div>
            )}

            {/* 組み合わせ選択 */}
            {showCombinations && availableCombinations.length > 0 && (
                <div>
                    <h4 className="text-md font-semibold text-gray-900 mb-3">利用可能な組み合わせ</h4>
                    <div className="grid grid-cols-1 gap-2">
                        {availableCombinations.map((combination, index) => (
                            <div
                                key={index}
                                className={`
                                    p-3 rounded-lg border-2 transition-all duration-200 font-medium cursor-pointer
                                    ${isCombinationSelected(combination)
                                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                        : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-indigo-300 hover:bg-indigo-25'
                                    }
                                    ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                                onClick={() => !isSubmitting && onCombinationSelect?.(combination)}
                            >
                                コラム {getCombinationText(combination)}
                            </div>
                        ))}
                    </div>
                    
                    {/* 組み合わせ確定ボタン */}
                    {selectedCombination && isCurrentTurn && (
                        <div className="mt-4 text-center">
                            <Form method="post">
                                <input type="hidden" name="_action" value="choose_combination" />
                                <input type="hidden" name="combination" value={JSON.stringify(selectedCombination)} />
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                                >
                                    {isSubmitting ? '処理中...' : '組み合わせを確定'}
                                </button>
                            </Form>
                        </div>
                    )}
                </div>
            )}

            {/* 進む/ストップボタン */}
            {gamePhase === 'deciding' && isCurrentTurn && (
                <div className="mt-6">
                    <div className="grid grid-cols-2 gap-4">
                        <Form method="post">
                            <input type="hidden" name="_action" value="continue" />
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                            >
                                進む
                            </button>
                        </Form>
                        
                        <Form method="post">
                            <input type="hidden" name="_action" value="stop" />
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                            >
                                ストップ
                            </button>
                        </Form>
                    </div>
                </div>
            )}

            {/* 組み合わせがない場合（バスト） */}
            {showCombinations && availableCombinations.length === 0 && diceValues.length === 4 && (
                <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="text-red-600 font-medium mb-2">
                        バスト！
                    </div>
                    <div className="text-sm text-red-500">
                        進行可能な組み合わせがありません
                    </div>
                </div>
            )}

            {/* デバッグ情報（開発用） */}
            {process.env.NODE_ENV === 'development' && (
                <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
                    <div>canRoll: {canRoll.toString()}</div>
                    <div>showCombinations: {showCombinations.toString()}</div>
                    <div>availableCombinations: {availableCombinations.length}</div>
                    <div>selectedCombination: {selectedCombination ? JSON.stringify(selectedCombination) : 'null'}</div>
                    <div>diceValues: [{diceValues.join(', ')}]</div>
                    <div>isSubmitting: {isSubmitting.toString()}</div>
                    <div>onCombinationSelect: {onCombinationSelect ? 'available' : 'null'}</div>
                </div>
            )}
        </div>
    );
}