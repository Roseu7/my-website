import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { createSupabaseServerClient } from "~/utils/supabase-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const redirectTo = url.searchParams.get("redirectTo") || "/";
    
    console.log('Auth callback - code exists:', !!code);
    console.log('Auth callback - error:', error);
    console.log('Auth callback - redirectTo:', redirectTo);
    
    if (error) {
        console.error("Auth callback error:", error);
        return redirect("/login?error=callback_error");
    }
    
    if (!code) {
        return redirect("/login?error=missing_code");
    }
    
    const { supabase, headers } = createSupabaseServerClient(request);
    
    try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        
        if (exchangeError) {
            console.error("Code exchange error:", exchangeError);
            return redirect("/login?error=exchange_failed");
        }
        
        console.log('Auth callback - authentication successful, redirecting to:', redirectTo);
        
        // 認証成功、元のページまたはホームページにリダイレクト
        return redirect(redirectTo, { headers });
        
    } catch (error) {
        console.error("Auth callback unexpected error:", error);
        return redirect("/login?error=unexpected_error");
    }
}