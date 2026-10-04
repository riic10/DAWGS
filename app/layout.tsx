import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnoopyGS | Give your images another dimension",
  description:
    "Turn a single image into an explorable 3D Gaussian splat. Made with TRELLIS.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
