'use client';

import { useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export default function DataDeletionPage() {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const getWordCount = (text) => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate word count
    const wordCount = getWordCount(reason);
    if (wordCount > 500) {
      setError('Reason for deletion cannot exceed 500 words.');
      return;
    }

    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/auth/data-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        setEmail('');
        setReason('');
      } else {
        setError(data.message || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      console.error('Submission error:', err);
      setError('Failed to submit request. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-ink overflow-x-hidden">
      <Header />

      <section className="bg-paper border-b border-line">
        <div className="container mx-auto px-5 sm:px-6 max-w-3xl py-12 lg:py-16">
          <Link 
            href="/" 
            className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink font-semibold mb-8"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Homepage
          </Link>
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand-600 mb-3">Your data</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] font-semibold tracking-[-0.025em] text-ink mb-4">Data Deletion Request</h1>
          <p className="text-lg text-ink-soft leading-relaxed">
            Submit a request to permanently delete your account and associated data.
          </p>
        </div>
      </section>

      <main className="container mx-auto px-5 sm:px-6 py-12 lg:py-16 max-w-3xl">
        <div className="rounded-[28px] border border-line bg-white p-6 sm:p-8">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-8">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-900">Important</h3>
                <p className="text-sm text-amber-800 mt-1 leading-relaxed">
                  This action is permanent and cannot be undone. Once processed, all your personal data, job history, and account settings will be permanently removed from our platform.
                </p>
              </div>
            </div>
          </div>

          {message && (
            <div className="bg-brand-50 border border-brand-200 text-brand-800 rounded-2xl p-4 mb-8">
              {message}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 mb-8">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-ink mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                required
                placeholder="john@example.com"
                className="w-full px-4 py-3 rounded-xl border border-line text-ink placeholder:text-ink-muted focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="reason" className="block text-sm font-semibold text-ink">
                  Reason for Deletion
                </label>
                <span className={`text-xs font-medium ${getWordCount(reason) > 500 ? 'text-red-600' : 'text-ink-muted'}`}>
                  {getWordCount(reason)} / 500 words
                </span>
              </div>
              <textarea
                id="reason"
                rows={4}
                placeholder="Please let us know why you'd like to delete your data..."
                className={`w-full px-4 py-3 rounded-xl border text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 transition resize-none ${
                  getWordCount(reason) > 500 ? 'border-red-300 focus:border-red-400 focus:ring-red-500/10' : 'border-line focus:border-ink/40 focus:ring-brand-500/10'
                }`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-bold px-7 py-3.5 rounded-2xl transition active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Deletion Request'}
            </button>
          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}
