import { Link, Form } from "@remix-run/react";
import type { User } from "~/types/user";

interface HeaderProps {
    user?: User | null;
}

export function Header({ user }: HeaderProps) {
    return (
        <header className="bg-white shadow-sm">
            <nav className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="flex h-16 items-center justify-between">
                    <Link to="/" className="flex items-center space-x-3">
                        <div className="h-12 w-12 rounded-xl overflow-hidden bg-white border-2 border-gray-200 flex items-center justify-center relative group">
                            <img 
                                src="/cat-icon.png" 
                                alt="Roseu's Site" 
                                className="w-10 h-10 object-contain group-hover:opacity-0 transition-opacity duration-300"
                            />
                            <img 
                                src="/cat-icon-wink.png" 
                                alt="Roseu's Site" 
                                className="w-10 h-10 object-contain absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                            />
                        </div>
                        <span className="text-xl font-bold text-gray-900">Roseu's Site</span>
                    </Link>
                    
                    <div className="flex items-center space-x-4">
                        <Link 
                            to="/games" 
                            className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                        >
                            ゲーム
                        </Link>
                        <Link 
                            to="/tools" 
                            className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                        >
                            ツール
                        </Link>
                        
                        {user ? (
                            <div className="flex items-center space-x-3">
                                <Link
                                    to="/profile"
                                    className="flex items-center space-x-2 text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                                >
                                    {user.avatar ? (
                                        <img
                                            src={user.avatar}
                                            alt="アバター"
                                            className="w-8 h-8 rounded-full"
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
                                            <span className="text-white text-sm font-bold">
                                                {user.username.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    )}
                                    <span>{user.username}</span>
                                </Link>
                                <Form method="post" action="/logout">
                                    <button
                                        type="submit"
                                        className="inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                                    >
                                        ログアウト
                                    </button>
                                </Form>
                            </div>
                        ) : (
                            <Link 
                                to="/login" 
                                className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                            >
                                ログイン
                            </Link>
                        )}
                    </div>
                </div>
            </nav>
        </header>
    );
}