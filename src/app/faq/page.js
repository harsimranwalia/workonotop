'use client'

import { useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { Minus, Plus } from 'lucide-react'

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState(null)

  const faqs = [
    {
      question: "How do I book a service?",
      answer: "Simply search for the service you need, select a date and time, and confirm your booking. You'll receive instant confirmation and can track your booking status in 'My Bookings'."
    },
    {
      question: "How do I pay?",
      answer: "Payments are processed AFTER the job is completed. You only pay when you're satisfied with the work. We accept all major credit cards, digital wallets, and bank transfers."
    },
    {
      question: "Are the tradespeople verified?",
      answer: "Yes! All our pros undergo background checks, license verification, and are fully insured. You can see their ratings and read reviews from other customers before booking."
    },
    {
      question: "What if I need to cancel?",
      answer: "Free cancellation up to 24 hours before the scheduled time. You can cancel anytime from your 'My Bookings' page."
    },
    {
      question: "What areas do you serve?",
      answer: "We currently serve Metro Vancouver and surrounding areas. We're expanding to more cities soon!"
    },
    {
      question: "How is the price calculated?",
      answer: "You're charged based on the actual time worked. Standard rate applies for the first X minutes, and overtime rate applies if the job takes longer."
    },
    {
      question: "What if I'm not satisfied?",
      answer: "We have a 100% satisfaction guarantee. If you're not happy with the work, contact us within 48 hours and we'll make it right."
    },
    {
      question: "How do I become a pro?",
      answer: "Visit our 'Become a Pro' page and sign up. We'll guide you through the verification process."
    }
  ]

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-4xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">FAQ</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">Frequently Asked Questions</h1>
          <p className="text-lg text-ink-soft leading-relaxed">Find answers to common questions</p>
        </div>
      </section>

      <section className="py-14 lg:py-20 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-4xl">

          {/* FAQ List */}
          <div className="divide-y divide-line border-y border-line">
            {faqs.map((faq, index) => {
              const open = openIndex === index
              return (
                <div key={index}>
                  <button
                    onClick={() => setOpenIndex(open ? null : index)}
                    aria-expanded={open}
                    className="w-full py-5 flex items-center justify-between gap-6 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg"
                  >
                    <span className="font-semibold text-ink text-base sm:text-lg">{faq.question}</span>
                    <span className={`h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition ${open ? 'bg-ink border-ink text-white' : 'border-line text-ink'}`} aria-hidden="true">
                      {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </button>

                  {open && (
                    <div className="pb-6 pr-12 text-ink-soft leading-relaxed">
                      {faq.answer}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Still Need Help */}
          <div className="mt-10">
            <p className="text-ink-muted">
              Still have questions?{' '}
              <Link href="/contact" className="font-semibold text-ink underline underline-offset-4 decoration-ink/30 hover:decoration-ink">
                Contact us
              </Link>
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
