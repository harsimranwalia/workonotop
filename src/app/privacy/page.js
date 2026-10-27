import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { getSeoForPath } from '@/lib/seo'

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const seo = await getSeoForPath('/privacy');
  return {
    title: seo.title || 'Privacy Policy | WorkOnTap',
    description: seo.description || 'Learn how WorkOnTap collects, uses, and protects your personal information.',
    alternates: { canonical: seo.canonical || 'https://workontap.com/privacy' },
    openGraph: {
      title: seo.ogTitle || seo.title || 'Privacy Policy | WorkOnTap',
      description: seo.ogDescription || seo.description,
      url: seo.canonical || 'https://workontap.com/privacy',
      siteName: 'WorkOnTap',
    },
  };
}

export default async function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* Hero */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-3xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Legal</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">Privacy Policy</h1>
          <p className="text-lg text-ink-soft leading-relaxed">Last updated: April 2026</p>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-5 sm:px-6 py-14 lg:py-20 max-w-3xl">
        
        <div className="divide-y divide-line">
          
          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">Introduction</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              At WorkOnTap, we take your privacy seriously. As we operate in Canada, our privacy 
              practices comply with the Personal Information Protection and Electronic Documents Act (PIPEDA) 
              and applicable provincial privacy legislations.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2.5 text-[17px] text-ink-soft leading-[1.7] marker:text-brand-600">
              <li>Contact Details: Name, email address, and phone number.</li>
              <li>Service Location: Your physical address to facilitate on-site visits.</li>
              <li>Professional Verification: For Pros, we collect background checks and identification for safety.</li>
              <li>Job Details: Descriptions and photos you upload related to your service requests.</li>
              <li>Payment Tokens: Securely processed by our partners (Stripe); we do not store full card info.</li>
            </ul>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2.5 text-[17px] text-ink-soft leading-[1.7] marker:text-brand-600">
              <li>To facilitate connections and bookings between Customers and Pros.</li>
              <li>To provide customer support and manage user accounts.</li>
              <li>To improve our platform and user experience.</li>
              <li>To comply with legal obligations under Canadian law.</li>
              <li>To prevent fraud and ensure the safety of our community.</li>
            </ul>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">Data Sharing</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              We share your contact and location information with Service Providers only as 
              necessary to complete your booking. We NEVER sell your personal information to third parties.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">Data Security</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              We use industry-standard encryption and security measures to protect your data. 
              While data may be processed outside of Canada, we ensure our partners maintain 
              security standards that meet or exceed Canadian requirements.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">Your Privacy Rights</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              Under PIPEDA, you have the right to access your personal data, correct any 
              inaccuracies, or withdraw consent for certain data uses. You can also request 
              account deletion by contacting our support team.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">Contact Us</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              For any privacy-related questions or requests, contact our Privacy Officer at:{' '}
              <a href="mailto:privacy@workontap.ca" className="font-semibold text-brand-700 underline underline-offset-4 decoration-brand-700/30 hover:decoration-brand-700 break-all">
                privacy@workontap.ca
              </a>
            </p>
          </section>
        </div>
      </div>

      <Footer />
    </div>
  )
}