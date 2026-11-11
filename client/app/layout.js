import Script from 'next/script';
import { Inter, Newsreader } from 'next/font/google';
import Providers from '@/components/Providers';
import { IrisDefs } from '@/components/ui/Iris';
import { THEME_KEY } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Serif for answers only (text that comes from the visitor's documents)
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', display: 'swap' });

export const metadata = {
  title: 'Anchor',
  description: 'Ask questions about your documents and get answers that show the page they came from.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#c8cfd7' },
    { media: '(prefers-color-scheme: dark)', color: '#14171c' },
  ],
};

// Applies a theme chosen with the toggle before the first paint, so there is no flash of
// the other theme. Without a saved choice the CSS follows the system setting.
const themeScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full font-sans text-fg">
        <Script id="anchor-theme" strategy="beforeInteractive">{themeScript}</Script>
        <IrisDefs />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
