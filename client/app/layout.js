import './globals.css';

export const metadata = {
  title: 'Anchor',
  description: 'Self-correcting retrieval-augmented Q&A over your documents',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
