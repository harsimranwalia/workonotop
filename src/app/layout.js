import { Geist, Geist_Mono, Outfit } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import Script from "next/script";
import { getSeoForPath } from "@/lib/seo";
import { linkPageKind } from "@/lib/link-pages";
import { AuthProvider } from "@/context/AuthContext";
import parse from 'html-react-parser';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata = {
  metadataBase: new URL('https://workontap.com'),
  title: {
    default: 'WorkOnTap - Home Maintenance & Trade Services',
    template: '%s | WorkOnTap'
  },
  description: 'WorkOnTap connects you with skilled and trusted local tradespeople for every job, big or small.',
  keywords: ['home maintenance', 'plumbers', 'electricians', 'hvac', 'cleaners', 'vancouver'],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    }
  },
  verification: {
    google: 'A6y8CvpEQ9Tkn0I6JPDykgUl9e2vRCmBYZiHON-QEcw',
  },
  icons: {
    icon: '/favicon.png',
  },
  openGraph: {
    title: 'WorkOnTap - Home Maintenance & Trade Services',
    description: 'WorkOnTap connects you with skilled and trusted local tradespeople.',
    url: 'https://workontap.com',
    siteName: 'WorkOnTap',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WorkOnTap - Home Maintenance & Trade Services',
    description: 'WorkOnTap connects you with skilled and trusted local tradespeople.',
  }
};

const parserOptions = {
  replace: (node) => {
    if (node.type === 'text') {
      return <></>;
    }
    if (node.name === 'script') {
      const { attribs, children } = node;
      const innerHTML = children && children.length > 0 && children[0].data ? children[0].data : '';
      if (innerHTML) {
        return <script {...attribs} dangerouslySetInnerHTML={{ __html: innerHTML }} />;
      }
      return <script {...attribs} />;
    }
  }
};

export default async function RootLayout({ children }) {
  const headersList = await headers();
  const rawPathname = headersList.get("x-pathname") || "/";
  // A page whose address is a credential (a job link, a card link) runs none of the site-wide scripts: not the ones pasted into seo_settings and not the
  // four tags below. A page that needs a widget loads it inside its own component (the card page loads Stripe.js itself). See src/lib/link-pages.js.
  const linkPage = linkPageKind(rawPathname) !== null;
  const seo = linkPage ? { headerScripts: '' } : await getSeoForPath(rawPathname);

  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} antialiased font-sans flex flex-col min-h-screen`}>
      <head>
        {seo.headerScripts && typeof seo.headerScripts === 'string' ? parse(seo.headerScripts, parserOptions) : null}
      </head>

      <body className="flex-grow flex flex-col min-h-screen" suppressHydrationWarning>
        <AuthProvider>
          {children}
        </AuthProvider>

        {linkPage ? null : (
          <>
            <Script type="module" src="https://unpkg.com/ionicons@7.1.0/dist/ionicons/ionicons.esm.js" strategy="afterInteractive" crossOrigin="anonymous" />
            <Script noModule src="https://unpkg.com/ionicons@7.1.0/dist/ionicons/ionicons.js" strategy="lazyOnload" crossOrigin="anonymous" />

            <Script src="https://accounts.google.com/gsi/client" strategy="beforeInteractive" />

            <Script src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&v=weekly&loading=async`} strategy="beforeInteractive" />
          </>
        )}
      </body>
    </html>
  );
}