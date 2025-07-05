import { createServerClient, parse, serialize } from "@supabase/ssr";
import { redirect } from "@remix-run/node";
import type { User } from "~/types/user";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

// Supabaseクライアントの作成（サーバーサイド）
export function createSupabaseServerClient(request: Request) {
    const cookies = parse(request.headers.get("Cookie") ?? "");
    const headers = new Headers();

    const supabase = createServerClient(
        supabaseUrl!,
        supabaseAnonKey!,
        {
            cookies: {
                get(key) {
                    return cookies[key];
                },
                set(key, value, options) {
                    headers.append("Set-Cookie", serialize(key, value, options));
                },
                remove(key, options) {
                    headers.append("Set-Cookie", serialize(key, "", options));
                },
            },
        }
    );

    return { supabase, headers };
}

// Discord認証用のリダイレクトURL生成
export function getDiscordAuthUrl() {
    const isDev = process.env.NODE_ENV === "development";
    const redirectTo = isDev 
        ? "http://localhost:5173/auth/callback"
        : `${process.env.APP_URL_PROD}/auth/callback`;

    return `/auth/discord?redirectTo=${encodeURIComponent(redirectTo)}`;
}

// セッションからユーザー情報を取得（セキュアな方法）
export async function getUserFromSession(request: Request): Promise<User | null> {
    const { supabase } = createSupabaseServerClient(request);
    
    try {
        // セキュリティのためgetUser()を使用（getSession()ではなく）
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error || !user) {
            console.log('No user found or error:', error?.message);
            return null;
        }

        // Discord情報を取得
        const discordData = user.user_metadata;
        const customClaims = discordData?.custom_claims;
        
        // より包括的なユーザー名の取得
        const username = customClaims?.global_name ||
                        discordData?.full_name ||
                        discordData?.name ||
                        discordData?.display_name ||
                        discordData?.username ||
                        user.email?.split('@')[0] ||
                        `User${user.id.slice(-4)}`;
        
        const formattedUser = {
            id: user.id,
            email: user.email || undefined,
            username: username,
            discriminator: discordData?.discriminator || undefined,
            avatar: discordData?.avatar_url || undefined,
            discordId: discordData?.provider_id || undefined,
        };
        
        console.log('User session data:', formattedUser);
        return formattedUser;
    } catch (error) {
        console.error("Error getting user from session:", error);
        return null;
    }
}

// ログイン必須のページ用のヘルパー（現在のページへのリダイレクトを設定）
export async function requireUser(request: Request): Promise<User> {
    const user = await getUserFromSession(request);
    if (!user) {
        // 現在のURLを認証後のリダイレクト先として設定
        const currentUrl = new URL(request.url);
        const redirectTo = `${currentUrl.pathname}${currentUrl.search}`;
        throw redirect(`/auth/discord?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    return user;
}

// ログアウト
export async function logout(request: Request) {
    const { supabase, headers } = createSupabaseServerClient(request);
    
    await supabase.auth.signOut();
    
    return redirect("/", {
        headers,
    });
}