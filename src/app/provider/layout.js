


























'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Home, Briefcase, DollarSign, User, LogOut, Menu, X, ChevronRight, MessageCircle, AlertCircle, Star } from 'lucide-react';

const STRIPE_REQUIRED_PATHS = ['/provider/chats', '/provider/earnings', '/provider/jobs'];

function StripeRequiredModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">💳</span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Stripe Not Connected</h3>
          <p className="text-sm text-gray-500 mb-1">
            You need to connect your Stripe account to access this feature.
          </p>
          <p className="text-xs text-gray-400 mb-5">
            Connect Stripe to accept jobs, receive payments, and chat with customers.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl text-sm hover:bg-gray-50 transition">
              Later
            </button>
            <Link href="/provider/onboarding?step=3"
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-sm transition text-center"
              onClick={onClose}>
              Connect Stripe →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProviderLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState(null);
  const [stripeConnected, setStripeConnected] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stripeModal, setStripeModal] = useState(false);

  const publicPaths = [
    '/provider/login', '/provider/signup', '/provider/verify-email',
    '/provider/verify-email-pending', '/provider/onboarding', '/provider/pending',
    '/provider/rejected', '/provider/forgot-password', '/provider/reset-password'
  ];

  const isPublic = publicPaths.some(p => pathname.startsWith(p));

  useEffect(() => { checkAuth(); }, [pathname]);

  useEffect(() => {
    if (loading) return;
    if (isPublic) return;
    if (!provider) return;
    if (stripeConnected) return;

    const isRestricted = STRIPE_REQUIRED_PATHS.some(p => pathname.startsWith(p));
    if (isRestricted) {
      setStripeModal(true);
      router.replace('/provider/dashboard');
    }
  }, [pathname, loading, provider, stripeConnected, isPublic]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/provider/me');
      let data = null;
      if (res.ok) {
        const text = await res.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {}
        }
      }

      if (!data || !data.success || !data.provider) {
        if (!isPublic) {
          router.push('/provider/login');
        } else {
          setLoading(false);
        }
        return;
      }

      const prov = data.provider;

      // ── Hard stops (order matters) ──────────────────────────────────────────

      if (prov.status === 'rejected') {
        router.push('/provider/rejected');
        return;
      }

      if (!prov.email_verified && prov.status !== 'active') {
        router.push('/provider/verify-email-pending');
        return;
      }

      // ── Fully active provider (High priority) ───────────────────────────────
      if (prov.status === 'active') {
        setProvider(prov);
        const isStripeOnboarded = !!prov.stripe_onboarding_complete;
        setStripeConnected(isStripeOnboarded);

        // If they are on a "locked" path, send them to dashboard
        const restrictedPaths = ['/provider/onboarding', '/provider/pending', '/provider/rejected', '/provider/verify-email-pending'];
        if (restrictedPaths.some(p => pathname.startsWith(p))) {
          // Exception: Allow Step 3 (Stripe) if not onboarded yet
          const urlParams = new URLSearchParams(window.location.search);
          const currentStep = urlParams.get('step');

          if (pathname === '/provider/onboarding' && currentStep === '3' && !isStripeOnboarded) {
            // Keep them on onboarding step 3
          } else {
            router.replace('/provider/dashboard');
          }
        }

        setLoading(false);
        return;
      }

      // ── Not yet active - check onboarding progress ──────────────────────────

      // Not finished onboarding yet → go to whatever step they left off
      if (!prov.onboarding_completed) {
        router.push('/provider/onboarding');
        return;
      }

      // ── Onboarding completed but awaiting admin approval ────────────────────
      if (prov.onboarding_completed && prov.status !== 'active') {

        // documents_uploaded = 0 means admin rejected docs and reset the flag.
        // Send provider back to step 2 to re-upload — no extra API call needed.
        if (!prov.documents_uploaded) {
          router.push('/provider/onboarding?step=2');
          setLoading(false);
          return;
        }

        // Docs uploaded and waiting for admin review
        if (pathname !== '/provider/pending') router.push('/provider/pending');
        setLoading(false);
        return;
      }

      // ── Fully active provider ───────────────────────────────────────────────
      setProvider(prov);
      setStripeConnected(prov.stripe_onboarding_complete || false);

    } catch (error) {
      console.error('Auth check error:', error);
      if (!isPublic) router.push('/provider/login');
    } finally {
      setLoading(false);
    }
  };

  const handleNavClick = (e, href) => {
    if (!stripeConnected && STRIPE_REQUIRED_PATHS.some(p => href.startsWith(p))) {
      e.preventDefault();
      setMobileMenuOpen(false);
      setStripeModal(true);
    }
  };

  const navItems = [
    { href: '/provider/dashboard', label: 'Dashboard', icon: Home },
    { href: '/provider/available-jobs', label: 'Available Jobs', icon: Briefcase },
    { href: '/provider/jobs', label: 'My Jobs', icon: Briefcase, stripeRequired: true },
    { href: '/provider/chats', label: 'Messages', icon: MessageCircle, stripeRequired: true },
    { href: '/provider/payouts', label: 'Earnings', icon: DollarSign, stripeRequired: true },
    { href: '/provider/ratings', label: 'Ratings', icon: Star },
    { href: '/provider/profile', label: 'Profile', icon: User },
  ];

  // The sign-up page is shown at once to visitors with no session; the session check still runs beside it and
  // redirects a signed-in provider.
  const shownAtOnce = pathname.startsWith('/provider/signup');

  if (loading && !shownAtOnce) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-500 font-medium">Loading...</span>
      </div>
    </div>
  );

  if (isPublic) return children;

  if (!provider) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const handleLogout = async () => {
    await fetch('/api/provider/logout', { method: 'POST' });
    window.location.href = '/provider/login';
  };

  const renderNavItem = (item, isMobile = false) => {
    const Icon = item.icon;
    const isActive = pathname === item.href;
    const isLocked = item.stripeRequired && !stripeConnected;

    return (
      <Link
        key={item.href}
        href={item.href}
        title={sidebarCollapsed ? item.label : ''}
        onClick={(e) => {
          handleNavClick(e, item.href);
          if (isMobile && !isLocked) setMobileMenuOpen(false);
        }}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group w-full ${isActive ? 'bg-green-50 text-green-700'
          : isLocked ? 'text-gray-400 hover:bg-amber-50 cursor-pointer'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-green-600' : isLocked ? 'text-gray-300' : 'text-gray-400 group-hover:text-gray-600'
          }`} />

        {(isMobile || !sidebarCollapsed) && <span className="flex-1">{item.label}</span>}

        {isLocked && !sidebarCollapsed && (
          <span className="ml-auto text-[10px] bg-amber-100 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-semibold">
            💳
          </span>
        )}
        {isActive && !sidebarCollapsed && !isLocked && !isMobile && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500" />
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">

      <StripeRequiredModal
        isOpen={stripeModal}
        onClose={() => setStripeModal(false)}
      />

      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col fixed top-0 left-0 h-full bg-white border-r border-gray-100 shadow-sm z-40 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-60'}`}>
        <div className={`flex items-center h-16 border-b border-gray-100 px-4 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!sidebarCollapsed && (
            <Link href="/provider/dashboard">
              <Image src="/logo.png" alt="Logo" width={140} height={45} className="object-contain" />
            </Link>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <ChevronRight className={`h-4 w-4 transition-transform duration-300 ${sidebarCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {!stripeConnected && !sidebarCollapsed && (
          <div className="mx-2 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              Stripe not connected
            </p>
            <Link href="/provider/onboarding?step=3"
              className="text-[11px] text-amber-600 underline font-medium mt-0.5 block">
              Connect now →
            </Link>
          </div>
        )}

        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map(item => (
            <div key={item.href}>{renderNavItem(item, false)}</div>
          ))}
        </nav>

        <div className={`border-t border-gray-100 p-3 ${sidebarCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3 mb-2 px-2">
              {provider?.avatar_url ? (
                <img src={provider.avatar_url} alt={provider.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-green-700 text-sm font-semibold">{provider?.name?.[0]?.toUpperCase()}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{provider?.name}</p>
                <p className="text-xs text-gray-400 truncate">{provider?.email}</p>
              </div>
            </div>
          )}
          <button onClick={handleLogout} title={sidebarCollapsed ? 'Logout' : ''}
            className={`flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition w-full ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Mobile Sidebar */}
      <aside className={`lg:hidden fixed top-0 left-0 h-full w-64 bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-100">
          <Link href="/provider/dashboard">
            <Image src="/logo.png" alt="Logo" width={140} height={45} className="object-contain" />
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!stripeConnected && (
          <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              Stripe not connected
            </p>
            <Link href="/provider/onboarding?step=3"
              onClick={() => setMobileMenuOpen(false)}
              className="text-[11px] text-amber-600 underline font-medium mt-0.5 block">
              Connect now →
            </Link>
          </div>
        )}

        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map(item => renderNavItem(item, true))}
        </nav>

        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3 mb-3">
            {provider?.avatar_url ? (
              <img src={provider.avatar_url} alt={provider.name} className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                <span className="text-green-700 font-semibold">{provider?.name?.[0]?.toUpperCase()}</span>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-gray-800">{provider?.name}</p>
              <p className="text-xs text-gray-400">{provider?.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-xl transition w-full">
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'}`}>
        <header className="lg:hidden bg-white border-b border-gray-100 h-14 flex items-center px-4 sticky top-0 z-30 shadow-sm">
          <button onClick={() => setMobileMenuOpen(true)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/provider/dashboard" className="ml-3">
            <Image src="/logo.png" alt="Logo" width={120} height={40} className="object-contain" />
          </Link>
          {!stripeConnected && (
            <Link href="/provider/onboarding?step=3"
              className="ml-auto flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2.5 py-1.5 rounded-full font-semibold border border-amber-200">
              💳 Connect Stripe
            </Link>
          )}
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}





















