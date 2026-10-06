import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "מערכת שכר ועו\"ש",
  description: "חישוב שכר, תלושים, תשלומים ודפי חשבון",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
