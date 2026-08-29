import type { Metadata, Viewport } from "next";
import { Sora, IBM_Plex_Mono, Playfair_Display } from "next/font/google";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { DeploymentRefreshPrompt } from "@/components/deployment-refresh-prompt";
import { ThemeProvider } from "@/components/theme-provider";
import { isWorkOSConfigured } from "@/lib/auth-config";
import "./globals.css";

const sora = Sora({
	variable: "--font-sans",
	subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
	variable: "--font-mono",
	weight: ["400", "500", "600", "700"],
	subsets: ["latin"],
});

const playfair = Playfair_Display({
	variable: "--font-serif",
	subsets: ["latin"],
	style: ["normal", "italic"],
});

export const metadata: Metadata = {
	title: "Compass",
	description: "Project management for connected teams",
	icons: {
		icon: "/favicon.png",
		apple: "/apple-touch-icon.png",
	},
	manifest: "/manifest.json",
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 5,
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const content = (
		<ThemeProvider>
			<DeploymentRefreshPrompt />
			{children}
		</ThemeProvider>
	);

	return (
		<html lang="en" suppressHydrationWarning>
		<body className={`${sora.variable} ${ibmPlexMono.variable} ${playfair.variable} font-sans antialiased`}>
			{isWorkOSConfigured() ? (
				<AuthKitProvider>{content}</AuthKitProvider>
			) : (
				content
			)}
		</body>
	</html>
	);
}
