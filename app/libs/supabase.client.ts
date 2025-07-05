import { createBrowserClient } from "@supabase/ssr";

export const createSupabaseBrowserClient = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    // デバッグ用のログ
    console.log('Environment variables check:');
    console.log('VITE_SUPABASE_URL exists:', !!supabaseUrl);
    console.log('VITE_SUPABASE_ANON_KEY exists:', !!supabaseAnonKey);
    
    if (supabaseUrl) {
        console.log('VITE_SUPABASE_URL starts with:', supabaseUrl.substring(0, 20) + '...');
    }

    if (!supabaseUrl || !supabaseAnonKey) {
        const errorMsg = `Missing environment variables:
- VITE_SUPABASE_URL: ${supabaseUrl ? '✓' : '✗'}
- VITE_SUPABASE_ANON_KEY: ${supabaseAnonKey ? '✓' : '✗'}

Make sure to add these to your .env file:
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key`;
        
        console.error(errorMsg);
        throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables are required");
    }

    try {
        const client = createBrowserClient(supabaseUrl, supabaseAnonKey);
        console.log('Supabase browser client created successfully');
        return client;
    } catch (error) {
        console.error('Failed to create Supabase browser client:', error);
        throw error;
    }
};

let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;

export const getSupabaseBrowserClient = () => {
    if (!supabase) {
        supabase = createSupabaseBrowserClient();
    }
    return supabase;
};