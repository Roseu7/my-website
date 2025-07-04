import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { createSupabaseServerClient } from "~/utils/supabase-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo") || "/";
    
    const { supabase, headers } = createSupabaseServerClient(request);
    
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
            redirectTo,
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