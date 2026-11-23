import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { ArrowRight, BadgeCheck, Clock, Receipt, ShieldCheck, UserCheck } from 'lucide-react'

const IMG = '/images/services'

const covered = [
  { icon: BadgeCheck, title: 'Quality of Work', desc: <>If the work isn&apos;t up to professional standards, we&apos;ll fix it.</> },
  { icon: UserCheck, title: 'Professional Conduct', desc: 'All pros are background-checked and insured.' },
  { icon: Receipt, title: 'Fair Pricing', desc: 'You only pay for the actual time worked.' },
  { icon: Clock, title: 'Timely Service', desc: <>If the pro is significantly late, we&apos;ll help reschedule.</> },
]

export default function GuaranteePage() {
  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* Hero */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Protection Promise</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">Our Guarantee</h1>
          <p className="text-lg text-ink-soft leading-relaxed max-w-2xl">
            We stand behind every job. 100% satisfaction guaranteed.
          </p>
        </div>
      </section>

      {/* Main Guarantee */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="rounded-[28px] bg-brand-900 text-white p-8 sm:p-10 relative overflow-hidden">
              <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
              <div className="relative">
                <span className="h-11 w-11 rounded-2xl bg-white/10 text-brand-200 flex items-center justify-center mb-6">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight leading-tight mb-4">WorkOnTap Protection Promise</h2>
                <p className="text-lg text-white/75 leading-relaxed">
                  If you&apos;re not happy with the work, we&apos;ll make it right.
                  Contact us within 48 hours of job completion.
                </p>
              </div>
            </div>
            <div className="overflow-hidden rounded-[32px] aspect-[4/3]">
              <img src={`${IMG}/deep-cleaning.jpg`} alt="A Work On Tap cleaner finishing a deep clean" className="h-full w-full object-cover" />
            </div>
          </div>
        </div>
      </section>

      {/* What's Covered */}
      <section className="py-16 lg:py-24 bg-paper border-y border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-10">What&apos;s Covered</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {covered.map(({ icon: CoverIcon, title, desc }) => (
              <div key={title} className="rounded-[28px] bg-white border border-line p-6">
                <span className="h-11 w-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5">
                  <CoverIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold text-ink mb-2">{title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to File a Claim */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-4">How to File a Claim</h2>
            <p className="text-ink-muted leading-relaxed mb-6">Have an issue with a job?</p>
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-2xl font-bold transition active:scale-[0.98]"
            >
              Contact Support <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {[
              'Contact us within 48 hours of job completion',
              'Provide your booking number and details of the issue',
              <>We&apos;ll review and get back to you within 24 hours</>,
              <>If eligible, we&apos;ll arrange for a fix or refund</>,
            ].map((item, i) => (
              <li key={i} className="flex gap-5 py-5">
                <span className="font-display text-sm font-semibold text-brand-600 pt-0.5 w-6 shrink-0">0{i + 1}</span>
                <span className="text-ink-soft leading-relaxed">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Footer />
    </div>
  )
}
