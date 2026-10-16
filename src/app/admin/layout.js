// app/admin/layout.js
'use client'

import Sidebar from '@/components/Sidebar'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, createContext, useContext } from 'react'

const AdminThemeContext = createContext()

export const useAdminTheme = () => {
  const context = useContext(AdminThemeContext)
  if (!context) throw new Error('useAdminTheme must be used within AdminThemeProvider')
  return context
}

function getPageTitle(pathname) {
  const map = {
    '/admin': 'Dashboard',
    '/admin/jobs': 'Job Requests',
    '/admin/book': 'Book for a customer',
    '/admin/logs': 'Activity Logs',
    '/admin/users': 'Users',
    '/admin/providers': 'Providers',
    '/admin/categories': 'Categories',
    '/admin/services': 'Services',
    '/admin/skills': 'Skills',
    '/admin/states': 'States',
    '/admin/districts': 'Districts',
    '/admin/cities': 'Cities',
    '/admin/reviews': 'Reviews',
    '/admin/testimonials': 'Testimonials',
    '/admin/analytics': 'Analytics',
    '/admin/earnings': 'Earnings',
    '/admin/payouts': 'Earnings & Payouts',
    '/admin/disputes': 'Disputes',
    '/admin/deletion-requests': 'Deletion Requests',
    '/admin/blogs': 'Blogs',
    '/admin/seo': 'SEO Settings',
    '/admin/service-locations': 'Service Locations (SEO)',
    '/admin/settings': 'Settings',
  }
  return map[pathname] || 'Admin'
}

export default function AdminLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isAuthed, setIsAuthed] = useState(false) // ✅ auth state

  // ✅ FIX: /api/admin/me se verify karo, isAuthed set karo
  useEffect(() => {
    if (pathname === '/admin/login') return
    fetch('/api/admin/me')
      .then(res => {
        if (!res.ok) router.push('/admin/login')
        else setIsAuthed(true)
      })
      .catch(() => router.push('/admin/login'))
  }, [pathname, router])

  useEffect(() => {
    setIsMounted(true)
    const savedTheme = localStorage.getItem('adminTheme')
    setIsDarkMode(savedTheme === 'dark')
    const savedCollapsed = localStorage.getItem('sidebarCollapsed')
    setIsCollapsed(savedCollapsed === 'true')
    const checkMobile = () => setIsMobile(window.innerWidth < 1024)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const toggleTheme = () => {
    const newTheme = !isDarkMode
    setIsDarkMode(newTheme)
    localStorage.setItem('adminTheme', newTheme ? 'dark' : 'light')
  }

  useEffect(() => {
    const handleSidebarChange = () => {
      const savedCollapsed = localStorage.getItem('sidebarCollapsed')
      setIsCollapsed(savedCollapsed === 'true')
    }
    window.addEventListener('storage', handleSidebarChange)
    window.addEventListener('sidebarCollapsed', handleSidebarChange)
    return () => {
      window.removeEventListener('storage', handleSidebarChange)
      window.removeEventListener('sidebarCollapsed', handleSidebarChange)
    }
  }, [])

  // Login page pe sidebar nahi chahiye
  if (pathname === '/admin/login') return children

  // ✅ FIX: mount hone tak AUR auth verify hone tak spinner dikhao
  if (!isMounted || !isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <AdminThemeContext.Provider value={{ isDarkMode, toggleTheme }}>
      <div className="flex min-h-screen w-full relative">
        <Sidebar />
        <main
          className="flex-1 transition-all duration-300 ease-in-out w-full"
          style={{
            marginLeft: isMobile ? '0' : (isCollapsed ? '80px' : '256px'),
            width: isMobile ? '100%' : (isCollapsed ? 'calc(100% - 80px)' : 'calc(100% - 256px)')
          }}
        >
          <div className="min-h-screen w-full overflow-x-hidden"
            style={{ backgroundColor: isDarkMode ? '#020617' : '#f8fafc' }}>
            <header className="sticky top-0 z-40 w-full backdrop-blur-xl border-b"
              style={{
                backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                borderColor: isDarkMode ? '#1e293b' : '#e2e8f0'
              }}>
              <div className="flex items-center justify-between px-4 sm:px-6 h-14 sm:h-16">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => window.dispatchEvent(new Event('toggleMobileSidebar'))}
                    className="lg:hidden p-2 -ml-2 rounded-lg transition-colors"
                    style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <h1 className={`text-base sm:text-lg font-semibold truncate ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                    {getPageTitle(pathname)}
                  </h1>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  <button onClick={toggleTheme} className="p-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                      color: isDarkMode ? '#fbbf24' : '#64748b'
                    }}
                    title={isDarkMode ? 'Light mode' : 'Dark mode'}>
                    {isDarkMode ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </button>
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold"
                    style={{ background: 'linear-gradient(135deg, #15843E, #06b6d4)', color: '#ffffff' }}>
                    A
                  </div>
                </div>
              </div>
            </header>

            <div className="px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </AdminThemeContext.Provider>
  )
}

