import type { Metadata } from "next";
import { WalletProvider } from "@/lib/web3/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "FairCircle | Private group finance",
  description:
    "Private group budgeting, fair cost splitting, and confidential collections.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
