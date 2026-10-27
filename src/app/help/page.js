'use client'

import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useState } from 'react'
import {
  ArrowRight, BadgeCheck, BookOpen, CalendarCheck, CalendarX, CreditCard, MapPin, MessageCircle, MessageSquare, Minus, Plus,
  Receipt, Search, ShieldCheck, X, Zap,
} from 'lucide-react'

const faqs = [
  {
    icon: CalendarCheck,
    category: 'Booking',
    question: 'How do I book a service?',
    answer: 'Simply search for the service you need, select a date and time, and confirm your booking. You\'ll receive instant confirmation and can track your booking status in "My Bookings".'
  },
  {
    icon: Search,
    category: 'Services',
    question: 'How do I find the right service?',
    answer: 'Use our search bar at the top of the page. Type what you need (e.g., "fix leaking tap") and we\'ll show you relevant services. You can also browse by categories.'
  },
  {
    icon: MapPin,
    category: 'Coverage',
    question: 'What areas do you serve?',
    answer: 'We currently serve Metro Vancouver and surrounding areas including Burnaby, Surrey, Richmond, Coquitlam, and more. We\'re expanding to new cities soon!'
  },
  {
    icon: BadgeCheck,
    category: 'Trust & Safety',
    question: 'How are service providers vetted?',
    answer: 'All our pros undergo background checks, license verification, and are fully insured. You can see their ratings and read verified reviews before booking.'
  },
  {
    icon: CalendarX,
    category: 'Booking',
    question: 'What if I need to cancel?',
    answer: 'Free cancellation up to 24 hours before the scheduled time. Cancel anytime from your "My Bookings" page with no penalty.'
  },
  {
    icon: CreditCard,
    category: 'Payment',
    question: 'How do I pay?',
    answer: 'Pay securely through our platform after the job is completed. We accept all major credit cards and digital wallets. No payment is charged until the work is done.'
  },
  {
    icon: MessageSquare,
    category: 'Reviews',
    question: 'How do I leave a review?',
    answer: 'After your job is marked complete, you\'ll receive an email or in-app prompt to rate and review your experience. Your feedback helps maintain our quality standards.'
  },
  {
    icon: ShieldCheck,
    category: 'Trust & Safety',
    question: 'What if I\'m not satisfied with the work?',
    answer: 'We offer a WorkOnTap Satisfaction Guarantee. If you\'re not happy, contact us within 48 hours and we\'ll make it right — at no extra cost to you.'
  },
]

const quickLinks = [
  { href: '/help/booking', icon: BookOpen, title: 'Booking Guide', desc: 'Step-by-step booking help' },
  { href: '/help/payment', icon: Receipt, title: 'Payment Help', desc: 'Billing, refunds & receipts' },
  { href: '/contact', icon: MessageCircle, title: 'Contact Support', desc: 'Talk to our team' },
  { href: '/how-it-works', icon: Zap, title: 'How It Works', desc: 'Learn the platform' },
]

const categories = ['All', 'Booking', 'Services', 'Payment', 'Coverage', 'Trust & Safety', 'Reviews']

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState(null)
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')

  const filtered = faqs.filter(f => {
    const matchCat = activeCategory === 'All' || f.category === activeCategory
    const matchSearch = !search || f.question.toLowerCase().includes(search.toLowerCase()) || f.answer.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      {/* ── Hero ── */}
      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-5xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Help Center</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">
            How can we <span className="text-brand-600">help you?</span>
          </h1>
          <p className="text-lg text-ink-soft leading-relaxed mb-8 max-w-2xl">
            Find answers to common questions or reach out to our support team
          </p>

          {/* Search bar */}
          <div className="relative max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-muted" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setOpenFaq(null) }}
              placeholder="Search questions, topics..."
              className="w-full pl-12 pr-12 py-4 rounded-2xl bg-white border border-line text-ink placeholder:text-ink-muted focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-paper transition">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Quick Links ── */}
      <section className="pt-12 lg:pt-16 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickLinks.map(({ href, icon: LinkIcon, title, desc }) => (
              <Link key={href} href={href}
                className="group flex flex-col p-5 rounded-[28px] border border-line bg-white hover:border-ink/30 hover:shadow-card transition">
                <span className="h-11 w-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
                  <LinkIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-semibold text-ink text-sm sm:text-base">{title}</span>
                <span className="text-ink-muted text-xs sm:text-sm mt-0.5">{desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ Section ── */}
      <section className="py-14 lg:py-20 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-5xl">
          <div className="mb-8">
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-2">Frequently Asked Questions</h2>
            <p className="text-ink-muted">Click a question to expand the answer</p>
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-8">
            {categories.map(cat => (
              <button key={cat} onClick={() => { setActiveCategory(cat); setOpenFaq(null) }}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
                  activeCategory === cat
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-soft border-line hover:border-ink/40 hover:text-ink'
                }`}>
                {cat}
              </button>
            ))}
          </div>

          {/* FAQ list */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 rounded-[28px] border border-line bg-paper">
              <span className="mx-auto h-11 w-11 rounded-2xl bg-white border border-line text-brand-600 flex items-center justify-center mb-4">
                <Search className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="font-semibold text-ink mb-1">No results found</p>
              <p className="text-ink-muted text-sm">Try a different search term or category</p>
              <button onClick={() => { setSearch(''); setActiveCategory('All') }}
                className="mt-5 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold rounded-2xl transition">
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-line border-y border-line">
              {filtered.map((faq, index) => {
                const open = openFaq === index
                const FaqIcon = faq.icon
                return (
                  <div key={index}>
                    <button
                      onClick={() => setOpenFaq(open ? null : index)}
                      aria-expanded={open}
                      className="w-full text-left py-5 flex items-center gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg">
                      <span className="hidden sm:flex h-11 w-11 shrink-0 rounded-2xl bg-brand-50 text-brand-600 items-center justify-center">
                        <FaqIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600 mb-1">{faq.category}</span>
                        <span className="font-semibold text-ink text-base sm:text-lg">{faq.question}</span>
                      </div>
                      <span className={`h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition ${open ? 'bg-ink border-ink text-white' : 'border-line text-ink'}`} aria-hidden="true">
                        {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </span>
                    </button>

                    {open && (
                      <div className="pb-6 pr-12 sm:pl-[60px]">
                        <p className="text-ink-soft leading-relaxed">{faq.answer}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Still need help? */}
          <div className="mt-14 relative overflow-hidden rounded-[36px] bg-brand-900 text-white px-6 py-10 sm:px-10 sm:py-12">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="max-w-md">
                <h3 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-2">Still need help?</h3>
                <p className="text-white/75 leading-relaxed">
                  Our support team is available 7 days a week. We typically respond within a few hours.
                </p>
              </div>
              <Link href="/contact"
                className="group self-start md:self-auto inline-flex items-center gap-2 px-7 py-3.5 bg-white text-ink font-bold rounded-2xl hover:bg-brand-50 transition active:scale-[0.98]">
                <MessageCircle className="w-5 h-5" aria-hidden="true" />
                Contact Support
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
