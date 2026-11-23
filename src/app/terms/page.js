import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { getSeoForPath } from '@/lib/seo'

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const seo = await getSeoForPath('/terms');
  return {
    title: seo.title || 'Terms of Service | WorkOnTap',
    description: seo.description || 'Read the Terms of Service for WorkOnTap - reliable home maintenance and trade services platform.',
    alternates: { canonical: seo.canonical || 'https://workontap.com/terms' },
    openGraph: {
      title: seo.ogTitle || seo.title || 'Terms of Service | WorkOnTap',
      description: seo.ogDescription || seo.description,
      url: seo.canonical || 'https://workontap.com/terms',
      siteName: 'WorkOnTap',
    },
  };
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* Hero */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-3xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Legal</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">Terms of Service</h1>
          <p className="text-lg text-ink-soft leading-relaxed">Last updated: April 2026</p>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-5 sm:px-6 py-14 lg:py-20 max-w-3xl">
        
        <div className="divide-y divide-line">
          
          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">1. Agreement to Terms</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              By accessing or using WorkOnTap, you agree to be bound by these Terms. 
              These Terms govern your use of the platform, website, and mobile applications. 
              If you disagree with any part, you may not access the service.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">2. The Marketplace Platform</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              WorkOnTap is a digital marketplace connecting customers with independent service professionals. 
              We are a platform provider, not a direct provider of services. All professionals on our platform 
              are independent contractors and are not employees of WorkOnTap.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">3. User Accounts</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              You must be at least 18 years old to use our services. You are responsible for 
              maintaining the confidentiality of your account credentials and for all activities 
              under your account.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">4. Booking and Payments</h2>
            <ul className="list-disc pl-5 space-y-2.5 text-[17px] text-ink-soft leading-[1.7] marker:text-brand-600">
              <li>Prices are estimates and the final amount is based on actual time and scope worked.</li>
              <li>Payment is processed securely after job completion via Stripe.</li>
              <li>All prices are subject to applicable Canadian taxes (GST/HST/PST) based on the location of service.</li>
            </ul>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">5. Professional Conduct</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              While we facilitate connections, WorkOnTap is not responsible for the actions or 
              omissions of any users. We offer a Protection Promise for your peace of mind 
              regarding the quality of work performed.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">6. Cancellation Policy</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              Cancellations more than 24 hours before the scheduled time are free. 
              Cancellations within 24 hours of the scheduled time may incur a cancellation fee.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">7. Limitation of Liability</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              To the maximum extent permitted by the laws of Canada and your applicable Province, 
              WorkOnTap shall not be liable for any indirect, incidental, or consequential damages.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">8. Governing Law</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              These Terms are governed by and construed in accordance with the laws of Canada 
              and the Province of your residence. Disputes shall be resolved in the competent 
              courts of Canada.
            </p>
          </section>

          <section className="py-8 first:pt-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-4">9. Contact Information</h2>
            <p className="text-[17px] text-ink-soft leading-[1.75]">
              For legal inquiries, contact us at:{' '}
              <a href="mailto:legal@workontap.ca" className="font-semibold text-brand-700 underline underline-offset-4 decoration-brand-700/30 hover:decoration-brand-700 break-all">
                legal@workontap.ca
              </a>
            </p>
          </section>
        </div>
      </div>

      <Footer />
    </div>
  )
}