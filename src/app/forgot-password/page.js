'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { Mail, ArrowLeft, ArrowRight, Loader2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import Header from 'src/components/Header';
import Footer from 'src/components/Footer';

function ForgotPasswordContent() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
      } else {
        setError(data.message || 'Something went wrong');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-full max-w-md text-center space-y-6 animate-fadeIn">
        <div className="flex justify-center">
          <div className="bg-brand-50 p-4 rounded-full">
            <CheckCircle2 className="h-12 w-12 text-brand-600" />
          </div>
        </div>
        <h2 className="font-display text-3xl font-semibold text-ink tracking-[-0.025em]">Check your email.</h2>
        <p className="text-ink-soft">We have sent a password reset link to <span className="text-ink font-semibold">{email}</span></p>
        <Link href="/login" className="inline-flex items-center gap-2 text-ink font-bold transition underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md relative z-10">
      <div className="mb-8 text-center lg:text-left space-y-2">
        <Link href="/login" className="inline-flex items-center gap-2 text-ink-soft hover:text-ink text-sm font-semibold mb-4 transition">
          <ArrowLeft className="h-4 w-4" /> Back to Login
        </Link>
        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink tracking-[-0.025em] leading-tight">Reset password.</h2>
        <p className="text-ink-soft">Enter your email and we&apos;ll send you a recovery link</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl animate-shake flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-800 font-semibold">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink ml-1">Email Address</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Mail className="h-5 w-5 text-ink-muted group-focus-within:text-brand-600 transition-colors" />
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-12 pr-4 py-4 border border-line rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-ink/40 text-base bg-white text-ink placeholder:text-ink-muted transition font-medium"
              placeholder="you@example.com"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-2xl transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] text-lg"
        >
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <>Send Reset Link <ArrowRight className="h-5 w-5" /></>}
        </button>
      </form>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-white font-sans antialiased text-ink flex">
        {/* Left panel - branding (Hidden on mobile) */}
        <div className="hidden lg:flex flex-col justify-between w-2/5 bg-brand-900 p-12 text-white relative overflow-hidden">
          <img src="/images/services/counter-clean.jpg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-950 via-brand-900/85 to-brand-900/60" aria-hidden="true" />
          
          <div className="relative z-10">
            <Link href="/" className="inline-block">
              <h1 className="font-display text-2xl font-semibold tracking-tight">WorkOnTap</h1>
            </Link>
          </div>

          <div className="relative z-10">
            <div className="space-y-6">
               <h2 className="font-display text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Don&apos;t worry, it <br />happens to the best of us.</h2>
               <div className="p-6 bg-white/[0.06] rounded-3xl backdrop-blur-sm border border-white/10 max-w-md">
                 <p className="text-white/80 leading-relaxed">&quot;A simple reset and you&apos;ll be back to booking top quality services in no time. We protect your account with bank-level security.&quot;</p>
               </div>
            </div>
          </div>
          <p className="relative z-10 text-white/50 text-xs font-bold uppercase tracking-[0.16em] leading-none">© 2025 WorkOnTap Technologies</p>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 md:p-24 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-brand-50 rounded-full blur-3xl lg:hidden"></div>
          <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-paper-deep rounded-full blur-3xl lg:hidden"></div>

          <Suspense fallback={<div className="animate-pulse">Loading...</div>}>
            <ForgotPasswordContent />
          </Suspense>
        </div>
      </div>
      <Footer />
    </>
  );
}
