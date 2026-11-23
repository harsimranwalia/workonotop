'use client'

import { useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { CheckCircle2, Mail, MapPin, Phone } from 'lucide-react'

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e) => { 
    e.preventDefault()
    // Add your form submission logic here
    console.log('Form submitted:', formData)
    setSubmitted(true)
  }

  const inputClass = 'w-full px-4 py-3 bg-white border border-line rounded-xl text-ink focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition'

  if (submitted) {
    return (
      <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
        <Header />
        <section className="bg-paper border-b border-line">
          <div className="container mx-auto px-5 sm:px-6 max-w-xl py-20 text-center">
            <span className="mx-auto h-14 w-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-6">
              <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            </span>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-3">Message Sent!</h1>
            <p className="text-lg text-ink-soft mb-8">We&apos;ll get back to you within 24 hours.</p>
            <Link href="/" className="inline-flex items-center gap-2 font-semibold text-ink underline underline-offset-4 decoration-ink/30 hover:decoration-ink">
              ← Back to Home
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  const channels = [
    { icon: Mail, title: 'Email', body: <a href="mailto:support@workontap.com" className="font-semibold text-brand-700 hover:underline break-all">support@workontap.com</a>, note: '24/7 Support' },
    { icon: Phone, title: 'Phone', body: <a href="tel:1-800-WORKONTAP" className="font-semibold text-brand-700 hover:underline">1-800-WORKONTAP</a>, note: 'Mon-Fri, 9am-6pm' },
    { icon: MapPin, title: 'Office', body: <><span className="block text-ink-soft">745 Thurlow Street</span><span className="block text-ink-soft">Vancouver, BC V6E 0C5</span></> },
  ]

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl py-14 lg:py-20">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Contact</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">Contact Us</h1>
          <p className="text-lg text-ink-soft leading-relaxed">We&apos;re here to help 24/7</p>
        </div>
      </section>

      <section className="py-16 lg:py-24 bg-white">
        <div className="container mx-auto px-5 sm:px-6 max-w-7xl">
          <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-10 lg:gap-16 items-start">

            {/* Contact Info */}
            <div>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-8">Get in Touch</h2>

              <div className="divide-y divide-line border-y border-line">
                {channels.map(({ icon: ChannelIcon, title, body, note }) => (
                  <div key={title} className="flex items-start gap-4 py-5">
                    <span className="h-11 w-11 shrink-0 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
                      <ChannelIcon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-ink mb-0.5">{title}</h3>
                      {body}
                      {note && <p className="text-sm text-ink-muted mt-0.5">{note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Contact Form */}
            <div className="rounded-[28px] border border-line bg-paper p-6 sm:p-8">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-ink mb-6">Send a Message</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="contact-name" className="block text-sm font-semibold text-ink mb-1.5">Name</label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-sm font-semibold text-ink mb-1.5">Email</label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="contact-subject" className="block text-sm font-semibold text-ink mb-1.5">Subject</label>
                <input
                  id="contact-subject"
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="contact-message" className="block text-sm font-semibold text-ink mb-1.5">Message</label>
                <textarea
                  id="contact-message"
                  rows="4"
                  required
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className={inputClass}
                />
              </div>

              <button
                type="submit"
                className="w-full bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-2xl font-bold transition active:scale-[0.99]"
              >
                Send Message
              </button>
            </form>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
