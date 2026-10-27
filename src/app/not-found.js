import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden flex flex-col">
      <Header />

      <section className="flex-1 flex items-center bg-paper border-b border-line py-16 lg:py-24">
        <div className="container mx-auto px-5 sm:px-6 max-w-xl text-center">

          {/* 404 Number */}
          <h1 className="font-display text-[96px] sm:text-[128px] leading-none font-semibold tracking-[-0.04em] text-brand-600 mb-4">404</h1>

          {/* Message */}
          <h2 className="font-display text-3xl font-semibold tracking-tight text-ink mb-3">
            Page Not Found
          </h2>

          <p className="text-lg text-ink-soft leading-relaxed mb-8">
            Sorry, the page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          {/* Quick Links */}
          <div className="space-y-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-2xl font-bold transition active:scale-[0.99]"
            >
              Go to Homepage
            </Link>

            <div className="flex gap-3">
              <Link
                href="/services"
                className="flex-1 rounded-2xl border border-line bg-white hover:border-ink/40 text-ink px-4 py-3 font-semibold transition"
              >
                Services
              </Link>
              <Link
                href="/help"
                className="flex-1 rounded-2xl border border-line bg-white hover:border-ink/40 text-ink px-4 py-3 font-semibold transition"
              >
                Help Center
              </Link>
            </div>
          </div>

          {/* Contact Link */}
          <p className="text-sm text-ink-muted mt-8">
            Need help? <Link href="/contact" className="font-semibold text-ink underline underline-offset-4 decoration-ink/30 hover:decoration-ink">Contact Support</Link>
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
