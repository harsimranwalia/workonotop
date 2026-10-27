'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!token) setError('Invalid reset link. Please request a new one.');
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess(true);
            } else {
                setError(data.message || 'Failed to reset password. The link may have expired.');
            }
        } catch {
            setError('Something went wrong. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-paper font-sans antialiased text-ink flex items-center justify-center px-5 py-10">
            <div className="bg-white rounded-[28px] border border-line shadow-card w-full max-w-md overflow-hidden">

                {/* Header */}
                <div className="px-6 sm:px-8 pt-8 pb-6 border-b border-line">
                    <span className="h-11 w-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
                    <h1 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
                        {success ? 'Password Reset!' : 'Set New Password'}
                    </h1>
                    <p className="text-ink-soft mt-1.5">
                        {success ? 'You can now log in with your new password.' : 'Enter a new password for your account.'}
                    </p>
                </div>

                <div className="p-6 sm:p-8">
                    {success ? (
                        <div className="text-center">
                            <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-10 h-10 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <p className="text-ink-soft mb-6">Your password has been updated successfully.</p>
                            <Link
                                href="/"
                                className="block w-full bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-2xl font-bold text-center transition"
                            >
                                Back to Home — Log In
                            </Link>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex items-center gap-2">
                                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    {error}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1.5">
                                    New Password <span className="text-red-600">*</span>
                                </label>
                                <div className="relative">
                                    <input
                                        type={showNew ? 'text' : 'password'}
                                        required
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        placeholder="Min. 8 characters"
                                        disabled={!token}
                                        className="w-full px-4 py-3 pr-11 border border-line rounded-xl text-ink placeholder:text-ink-muted focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition disabled:bg-paper"
                                    />
                                    <button type="button" onClick={() => setShowNew(p => !p)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                                        {showNew
                                            ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                            : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                        }
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-ink mb-1.5">
                                    Confirm Password <span className="text-red-600">*</span>
                                </label>
                                <div className="relative">
                                    <input
                                        type={showConfirm ? 'text' : 'password'}
                                        required
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        placeholder="Repeat password"
                                        disabled={!token}
                                        className="w-full px-4 py-3 pr-11 border border-line rounded-xl text-ink placeholder:text-ink-muted focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition disabled:bg-paper"
                                    />
                                    <button type="button" onClick={() => setShowConfirm(p => !p)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                                        {showConfirm
                                            ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                            : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                        }
                                    </button>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={submitting || !token}
                                className="w-full bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-2xl font-bold transition disabled:opacity-50 mt-2"
                            >
                                {submitting ? 'Resetting...' : 'Reset Password'}
                            </button>

                            <p className="text-center text-sm text-ink-muted">
                                <Link href="/" className="text-ink font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">← Back to Home</Link>
                            </p>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-brand-500 border-t-transparent" />
            </div>
        }>
            <ResetPasswordForm />
        </Suspense>
    );
}