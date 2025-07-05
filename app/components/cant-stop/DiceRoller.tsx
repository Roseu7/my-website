import { useState, useEffect } from "react";
import { Form } from "@remix-run/react";
import { calculateDiceCombinations } from "~/utils/cant-stop/helpers";

interface DiceRollerProps {
    diceValues: number[];
    isRolling?: boolean;
    canRoll?: boolean;
    onRoll?: () => void;
    showCombinations?: boolean;
    availableCombinations?: number[][];
    selectedCombination?: number[] | null;
    onCombinationSelect?: (combination: number[]) => void;
    onCombinationConfirm?: () => void;
    isSubmitting?: boolean;
}

export function DiceRoller({
    diceValues,
    isRolling = false,
    canRoll = false,
    onRoll,
    showCombinations = false,
    availableCombinations = [],
    selectedCombination,
    onCombinationSelect,
    onCombinationConfirm,
    isSubmitting = false
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
     * 組み合わせが選択可能かチェック
     */
    const isCombinationAvailable = (combination: number[]): boolean => {
        return availableCombinations.some(available => 
            available.length === combination.length &&
            available.every((val, index) => val === combination[index])
        );
    };

    /**
     * 組み合わせが選択されているかチェック
     */
    const isCombinationSelected = (combination: number[]): boolean => {
        if (!selectedCombination) return false;
        return selectedCombination.length === combination.length &&
               selectedCombination.every((val, index) => val === combination[index]);
    };

    // 全組み合わせを計算
    const allCombinations = diceValues.length === 4 ? calculateDiceCombinations(diceValues) : [];

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">サイコロ</h3>

            {/* サイコロ表示 */}
            <div className="flex justify-center mb-6">
                <div className="flex space-x-3">
                    {diceValues.length > 0 ? (
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
                    {onRoll ? (
                        <button
                            type="button"
                            onClick={onRoll}
                            disabled={isRolling || isSubmitting}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                        >
                            {isRolling ? 'サイコロを振っています...' : 'サイコロを振る'}
                        </button>
                    ) : (
                        <Form method="post">
                            <input type="hidden" name="_action" value="roll_dice" />
                            <button
                                type="submit"
                                disabled={isRolling || isSubmitting}
                                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                            >
                                {isRolling ? 'サイコロを振っています...' : 'サイコロを振る'}
                            </button>
                        </Form>
                    )}
                </div>
            )}

            {/* 組み合わせ選択 */}
            {showCombinations && allCombinations.length > 0 && (
                <div>
                    <h4 className="text-md font-medium text-gray-900 mb-3">組み合わせ選択</h4>
                    
                    {availableCombinations.length > 0 ? (
                        <div className="space-y-2 mb-4">
                            {allCombinations.map((combination, index) => {
                                const isAvailable = isCombinationAvailable(combination);
                                const isSelected = isCombinationSelected(combination);
                                
                                return (
                                    <button
                                        key={index}
                                        type="button"
                                        onClick={() => isAvailable && onCombinationSelect?.(combination)}
                                        disabled={!isAvailable || isSubmitting}
                                        className={`
                                            w-full p-3 rounded-lg border-2 text-left transition-all duration-200
                                            ${isSelected ? 
                                                'border-indigo-500 bg-indigo-50 text-indigo-900' :
                                                isAvailable ? 
                                                    'border-gray-300 bg-white hover:border-indigo-300 hover:bg-indigo-50' :
                                                    'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                                            }
                                        `}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium">
                                                コラム {getCombinationText(combination)}
                                            </span>
                                            <div className="flex space-x-2">
                                                {combination.map((col, colIndex) => (
                                                    <span 
                                                        key={colIndex}
                                                        className={`
                                                            px-2 py-1 rounded text-xs
                                                            ${isSelected ? 'bg-indigo-200 text-indigo-800' :
                                                              isAvailable ? 'bg-gray-200 text-gray-700' :
                                                              'bg-gray-100 text-gray-500'}
                                                        `}
                                                    >
                                                        {col}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        {!isAvailable && (
                                            <div className="text-xs text-gray-500 mt-1">
                                                使用不可（完成済みまたは一時マーカー制限）
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg">
                            <div className="text-red-600 font-medium mb-1">バスト！</div>
                            <div className="text-sm text-red-500">
                                進行可能な組み合わせがありません
                            </div>
                        </div>
                    )}

                    {/* 組み合わせ確定ボタン */}
                    {selectedCombination && onCombinationConfirm && (
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={onCombinationConfirm}
                                disabled={isSubmitting}
                                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                            >
                                組み合わせを確定
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 組み合わせの説明 */}
            {diceValues.length === 4 && !showCombinations && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="text-sm text-blue-800">
                        <div className="font-medium mb-1">可能な組み合わせ:</div>
                        {allCombinations.map((combination, index) => (
                            <div key={index} className="text-xs">
                                • {getCombinationText(combination)}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}