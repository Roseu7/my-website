import { createBrowserClient } from "@supabase/ssr";

export const createSupabaseBrowserClient = () => {
    return createBrowserClient(
        window.ENV.SUPABASE_URL,
        window.ENV.SUPABASE_ANON_KEY
    );
};

let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;

export const getSupabaseBrowserClient = () => {
    if (!supabase) {
        supabase = createSupabaseBrowserClient();
    }
    return supabase;
};