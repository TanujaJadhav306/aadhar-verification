import "./globals.css";

export const metadata = {
  title: "Aadhaar / DL Verification (Demo)",
  description: "Upload ID + capture selfie + face match (demo)"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


