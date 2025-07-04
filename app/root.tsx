import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useLoaderData,
} from "@remix-run/react";
import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/node";
import tailwindStylesheet from "./tailwind.css";

export const links: LinksFunction = () => [
    { rel: "stylesheet", href: tailwindStylesheet },
];

export async function loader({ request }: LoaderFunctionArgs) {
    const env = {
        SUPABASE_URL: process.env.SUPABASE_URL!,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
    };

    return { env };
}

export default function App() {
    const { env } = useLoaderData<typeof loader>();

    return (
        <html lang="ja">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <Meta />
                <Links />
            </head>
            <body>
                <Outlet />
                <script
                    dangerouslySetInnerHTML={{
                        __html: `window.ENV = ${JSON.stringify(env)}`,
                    }}
                />
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

declare global {
    interface Window {
        ENV: {
            SUPABASE_URL: string;
            SUPABASE_ANON_KEY: string;
        };
    }
}