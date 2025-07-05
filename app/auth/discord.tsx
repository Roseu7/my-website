import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { createSupabaseServerClient } from "~/utils/supabase-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo") || "/";
    
    console.log('Discord auth - redirectTo:', redirectTo);
    
    const { supabase, headers } = createSupabaseServerClient(request);
    
    // コールバックURLを正しく設定
    const isDev = process.env.NODE_ENV === "development";
    const baseUrl = isDev 
        ? "http://localhost:5173" 
        : process.env.APP_URL_PROD || "https://roseu.fly.dev";
    
    const callbackUrl = `${baseUrl}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`;
    
    console.log('Discord auth - callbackUrl:', callbackUrl);
    
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
            redirectTo: callbackUrl,
        },
    });
    
    if (error) {
        console.error("Discord OAuth error:", error);
        return redirect("/login?error=auth_failed");
    }
    
    if (data.url) {
        return redirect(data.url, { headers });
    }
    
    return redirect("/login?error=no_url");
}