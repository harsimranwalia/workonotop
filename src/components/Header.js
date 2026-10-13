'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from 'src/context/AuthContext';
import {
  ChevronDown, Menu, X, LogOut, LayoutDashboard,
  User, BookOpen, Home
} from 'lucide-react';

export default function Header() {
  const router = useRouter();
  const {
    user,
    userType,
    loading,
    logout,
    isProvider,
    isAdmin,
    getDashboardLink,
    getUserDisplayName,
    getUserInitials
  } = useAuth();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [proDropdownOpen, setProDropdownOpen] = useState(false);
  const [loginDropdownOpen, setLoginDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const proRef = useRef(null);
  const loginRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (proRef.current && !proRef.current.contains(e.target)) setProDropdownOpen(false);
      if (loginRef.current && !loginRef.current.contains(e.target)) setLoginDropdownOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const goToProLogin = () => { router.push('/provider/login'); setMobileMenuOpen(false); setProDropdownOpen(false); };
  const goToProSignup = () => { router.push('/provider/signup'); setMobileMenuOpen(false); setProDropdownOpen(false); };
  const handleLogout = () => { logout(true); setShowLogoutConfirm(false); };

  // Don't render if loading
  if (loading) {
    return (
      <header className="bg-white sticky top-0 z-50 border-b border-gray-100 shadow-sm">
        <div className="container mx-auto px-6 max-w-7xl h-20 flex items-center justify-between">
          <Link href="/">
            <Image src="/logo.png" alt="Logo" width={180} height={60} className="object-contain" />
          </Link>
          <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
        </div>
      </header>
    );
  }

  const isLoggedIn = !!userType;
  // The booking button is the header's main action for everyone who can book (not providers, not admins).
  const canBook = !isLoggedIn || (!isProvider() && !isAdmin());

  return (
    <>
      <header className="bg-white sticky top-0 z-50 border-b border-gray-100 shadow-sm">
        <nav className="container mx-auto px-6 max-w-7xl h-20 flex items-center justify-between gap-3">

          <Link href="/" className="flex-shrink-0">
            <Image src="/logo.png" alt="Logo" width={200} height={65} className="object-contain hover:opacity-90 transition" priority />
          </Link>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
            {(!isLoggedIn || !isProvider()) && (
              <Link href="/services" className="text-gray-600 hover:text-green-700 transition">Explore Services</Link>
            )}
            {isLoggedIn && (
              <Link href={getDashboardLink()} className="text-gray-600 hover:text-green-700 transition">Dashboard</Link>
            )}
            <Link href="/help" className="text-gray-600 hover:text-green-700 transition">Help Center</Link>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            {canBook && (
              <Link href="/#book"
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition shadow-sm">
                Book now
              </Link>
            )}
            {isLoggedIn ? (
              <div className="relative" ref={userMenuRef}>
                <button onClick={() => setUserMenuOpen(p => !p)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-gray-50 transition">
                  <div className={`w-8 h-8 rounded-full ${isAdmin() ? 'bg-purple-600' : isProvider() ? 'bg-blue-600' : 'bg-green-600'} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 overflow-hidden`}>
                    {getUserInitials()}
                  </div>
                  <div className="flex flex-col leading-none text-left">
                    <span className="text-sm font-semibold text-gray-900 truncate max-w-[100px]">{getUserDisplayName()}</span>
                    <span className={`text-xs font-medium ${isAdmin() ? 'text-purple-600' : isProvider() ? 'text-blue-500' : 'text-green-600'}`}>
                      {isAdmin() ? 'Admin' : isProvider() ? 'Pro Account' : 'Customer'}
                    </span>
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                    <div className="p-1.5">
                      <Link href={getDashboardLink()} onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-xl transition">
                        <Home className="h-4 w-4" /> Dashboard
                      </Link>
                    </div>
                    <div className="border-t border-gray-100 p-1.5">
                      <button onClick={() => { setUserMenuOpen(false); setShowLogoutConfirm(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50 rounded-xl transition">
                        <LogOut className="h-4 w-4" /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Login and Signup buttons remain same */}
                <div className="relative" ref={loginRef}>
                  <button onClick={() => { setLoginDropdownOpen(p => !p); setProDropdownOpen(false); }}
                    className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-green-700 px-3 py-2 rounded-xl hover:bg-gray-50 transition">
                    Log In <ChevronDown className={`h-3.5 w-3.5 transition-transform ${loginDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {loginDropdownOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                      <div className="p-1.5">
                        <Link href="/login" onClick={() => setLoginDropdownOpen(false)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-green-50 rounded-xl transition text-left">
                          <User className="h-4 w-4 text-green-600" /> Customer Login
                        </Link>
                        <Link href="/provider/login" onClick={() => setLoginDropdownOpen(false)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 rounded-xl transition text-left">
                          <LayoutDashboard className="h-4 w-4 text-blue-600" /> Pro Login
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative" ref={proRef}>
                  <button onClick={() => { setProDropdownOpen(p => !p); setLoginDropdownOpen(false); }}
                    className="flex items-center gap-1.5 border border-gray-200 hover:border-green-600 text-gray-700 hover:text-green-700 text-sm font-semibold px-4 py-2 rounded-xl transition">
                    Sign Up <ChevronDown className={`h-3.5 w-3.5 transition-transform ${proDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {proDropdownOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                      <div className="p-1.5">
                        <Link href="/signup" onClick={() => setProDropdownOpen(false)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-green-50 rounded-xl transition text-left">
                          <User className="h-4 w-4 text-green-600" /> Customer Sign Up
                        </Link>
                        <Link href="/provider/signup" onClick={() => setProDropdownOpen(false)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-purple-50 rounded-xl transition text-left">
                          <LayoutDashboard className="h-4 w-4 text-purple-600" /> Become a Pro
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="md:hidden flex items-center gap-2">
            {canBook && (
              <Link href="/#book" onClick={() => setMobileMenuOpen(false)}
                className="bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm whitespace-nowrap active:scale-[0.98]">
                Book now
              </Link>
            )}
            <button className="p-2 rounded-xl text-gray-600 hover:bg-gray-100 transition"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileMenuOpen(p => !p)}>
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-2">
            {(!isLoggedIn || !isProvider()) && (
              <Link href="/services" onClick={() => setMobileMenuOpen(false)}
                className="block px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
                Explore Services
              </Link>
            )}
            {isLoggedIn && (
              <Link href={getDashboardLink()} onClick={() => setMobileMenuOpen(false)}
                className="block px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
                Dashboard
              </Link>
            )}
            <Link href="/help" onClick={() => setMobileMenuOpen(false)}
              className="block px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
              Help Center
            </Link>

            {isLoggedIn && (
              <button onClick={() => { setMobileMenuOpen(false); setShowLogoutConfirm(true); }}
                className="w-full mt-4 px-4 py-2 bg-red-50 text-red-600 text-sm font-semibold rounded-xl">
                Logout
              </button>
            )}

            {!isLoggedIn && (
              <div className="pt-4 border-t border-gray-50 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Link href="/login" onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center py-3 bg-gray-50 text-gray-700 text-sm font-bold rounded-xl border border-gray-100 transition active:scale-[0.98]">
                    Customer Login
                  </Link>
                  <Link href="/signup" onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center py-3 bg-green-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-green-100 transition active:scale-[0.98]">
                    Customer Sign Up
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <Link href="/provider/login" onClick={() => setMobileMenuOpen(false)}
                    className="text-center py-2.5 text-xs font-bold text-gray-500 hover:text-blue-600 transition">
                    Provider Login
                  </Link>
                  <Link href="/provider/signup" onClick={() => setMobileMenuOpen(false)}
                    className="text-center py-2.5 text-xs font-black text-green-600 bg-green-50/50 rounded-lg transition active:scale-[0.98]">
                    Become a Provider
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Logout Confirm */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Sign out?</h3>
            <p className="text-sm text-gray-500 mb-5">You&apos;ll need to log in again to access your account.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2 border border-gray-200 text-gray-700 font-semibold rounded-xl">
                Cancel
              </button>
              <button onClick={handleLogout}
                className="flex-1 py-2 bg-red-600 text-white font-semibold rounded-xl">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}