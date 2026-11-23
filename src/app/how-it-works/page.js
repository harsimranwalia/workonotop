import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import {
  ArrowRight, CalendarCheck, CreditCard, ListChecks, ShieldCheck, SlidersHorizontal, Tag, Wrench,
} from 'lucide-react'

const IMG = '/images/services'

export default function HowItWorksPage() {
  const steps = [
    {
      icon: SlidersHorizontal,
      title: 'Tell us about the job',
      description: 'Choose a service and answer a few quick questions about your home or the task. No phone call, no waiting for a quote.'
    },
    {
      icon: Tag,
      title: 'Pick your option',
      description: 'Choose the level of service that fits. The price on screen changes with every answer, so you see what the job costs before you book.'
    },
    {
      icon: ListChecks,
      title: "See what's included",
      description: 'Check exactly what is covered and add any extras you want.'
    },
    {
      icon: CalendarCheck,
      title: 'Choose when and where',
      description: 'Pick a date and time, add your address and confirm. Your card is held, not charged.'
    },
    {
      icon: Wrench,
      title: 'The pro does the job',
      description: 'Your pro comes at the time you booked and completes the work.'
    },
    {
      icon: CreditCard,
      title: "You pay once it's done",
      description: 'Your card is charged only after the work is finished.'
    }
  ]

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* Hero */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Booking with Work On Tap</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">How It Works</h1>
          <p className="text-lg text-ink-soft leading-relaxed max-w-2xl">
            Book in four short steps. The pro does the job, and you pay once it&apos;s done.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-10 lg:gap-16 items-start">
            <ol className="divide-y divide-line border-y border-line">
              {steps.map(({ icon: StepIcon, title, description }, index) => (
                <li key={title} className="flex gap-5 py-6">
                  <span className="h-11 w-11 shrink-0 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
                    <StepIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-brand-600 mb-1">0{index + 1}</p>
                    <h3 className="text-lg font-semibold text-ink mb-1.5">{title}</h3>
                    <p className="text-ink-muted leading-relaxed">{description}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="lg:sticky lg:top-28">
              <div className="overflow-hidden rounded-[32px] aspect-[4/3] lg:aspect-[4/5]">
                <img src={`${IMG}/regular-house-cleaning.jpg`} alt="A Work On Tap cleaner at work in a bright home" className="h-full w-full object-cover" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Promise + CTA */}
      <section className="pb-16 lg:pb-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="relative overflow-hidden rounded-[36px] bg-brand-900 text-white px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
            <div className="relative grid lg:grid-cols-[1.2fr_0.8fr] gap-8 lg:gap-16 items-center">
              <div>
                <span className="h-11 w-11 rounded-2xl bg-white/10 text-brand-200 flex items-center justify-center mb-5">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight leading-tight mb-4">Not happy with the work?</h2>
                <p className="text-white/75 text-lg leading-relaxed max-w-xl">
                  Tell us within 48 hours and we will make it right. That is our{' '}
                  <Link href="/guarantee" className="font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">Protection Promise</Link>.
                </p>
              </div>
              <div className="lg:justify-self-end">
                <Link
                  href="/services"
                  className="group inline-flex items-center gap-2 bg-white text-ink hover:bg-brand-50 px-7 py-3.5 rounded-2xl font-bold transition active:scale-[0.98]"
                >
                  Get Started Now <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
