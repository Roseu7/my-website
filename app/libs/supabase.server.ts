import { createServerClient } from "@supabase/ssr";

export const createSupabaseServerClient = (request: Request) => {
    const cookieString = request.headers.get("Cookie") || "";

    return createServerClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(key) {
                    const cookies = new URLSearchParams(cookieString.replace(/; /g, "&"));
                    return cookies.get(key) || undefined;
                },
                set() {
                    // handled by response
                },
                remove() {
                    // handled by response
                },
            },
        }
    );
};