import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { getSeoForPath } from '@/lib/seo'
import { BadgeCheck, Handshake, Users } from 'lucide-react'

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const seo = await getSeoForPath('/about');
  return {
    title: seo.title || 'About Us | WorkOnTap',
    description: seo.description || 'Learn about WorkOnTap - connecting trusted local tradespeople with homeowners since 2022.',
    keywords: seo.keywords || 'about workontap, trades vancouver, home services',
    alternates: { canonical: seo.canonical || 'https://workontap.com/about' },
    openGraph: {
      title: seo.ogTitle || seo.title || 'About Us | WorkOnTap',
      description: seo.ogDescription || seo.description,
      url: seo.canonical || 'https://workontap.com/about',
      siteName: 'WorkOnTap',
      images: seo.ogImage ? [{ url: seo.ogImage }] : [],
    },
  };
}

export default async function AboutPage() {
  const values = [
    { icon: Handshake, title: 'Trust', desc: 'Every pro is background-checked and verified' },
    { icon: BadgeCheck, title: 'Quality', desc: 'We stand behind every job with our guarantee' },
    { icon: Users, title: 'Community', desc: 'Supporting local tradespeople and homeowners' },
  ]

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* Hero Section */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">About us</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">About WorkOnTap</h1>
          <p className="text-lg text-ink-soft leading-relaxed max-w-2xl">
            Connecting trusted local tradespeople with homeowners since 2022
          </p>
        </div>
      </section>

      {/* Story + Mission */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="space-y-10">
              <div>
                <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-4">Our Story</h2>
                <p className="text-lg text-ink-soft leading-relaxed">
                  WorkOnTap was born from a simple idea: homeowners should be able to find trusted,
                  qualified tradespeople quickly and easily. What started as a small local service
                  in Metro Vancouver has grown into a platform connecting thousands of homeowners with
                  verified professionals across Metro Vancouver and beyond.
                </p>
              </div>
              <div>
                <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-4">Our Mission</h2>
                <p className="text-lg text-ink-soft leading-relaxed">
                  We&apos;re on a mission to take the stress out of home maintenance. By providing
                  transparent pricing, verified reviews, and guaranteed work, we help homeowners
                  feel confident in every booking.
                </p>
              </div>
            </div>
            <div className="overflow-hidden rounded-[32px] aspect-[4/3] lg:aspect-[4/5]">
              <img src="/images/services/moving.jpg" alt="A Work On Tap mover carrying a box through a bright living room" className="h-full w-full object-cover" />
            </div>
          </div>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-16 lg:py-24 bg-paper border-y border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-10">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {values.map(({ icon: ValueIcon, title, desc }) => (
              <div key={title} className="rounded-[28px] bg-white border border-line p-6">
                <span className="h-11 w-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5">
                  <ValueIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold text-ink mb-2">{title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 lg:py-20 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line border-y border-line">
            {[
              ['500K+', 'Jobs Completed'],
              ['5K+', 'Trusted Pros'],
              ['4.8★', 'Average Rating'],
            ].map(([figure, label]) => (
              <div key={label} className="py-8 sm:px-8 text-center">
                <div className="font-display text-4xl font-semibold tracking-tight text-brand-700">{figure}</div>
                <div className="text-sm text-ink-muted mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
