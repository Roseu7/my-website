import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { logout } from "~/utils/supabase-auth.server";

export async function action({ request }: ActionFunctionArgs) {
    return logout(request);
}

export async function loader({ request }: LoaderFunctionArgs) {
    // GETでアクセスされた場合もログアウト処理を実行
    return logout(request);
}