// app/components/Footer.tsx
export function Footer() {
    return (
        <footer className="bg-white border-t border-gray-200">
            <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
                <div className="text-center">
                    <p className="text-sm text-gray-600">
                        © 2025 Roseu's Site. Created by 
                        <a 
                            href="https://x.com/Roseu_7" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="font-semibold text-indigo-600 hover:text-indigo-500 transition-colors ml-1"
                        >
                            ろせ
                        </a>
                    </p>
                </div>
            </div>
        </footer>
    );
}