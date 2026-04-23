import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DDhelper - Design QA Comparison",
  description: "Compare Figma designs against staging implementations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-black text-white">
        {children}
      </body>
    </html>
  );
}
