'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AnimatedSearchBar({ services = [] }) {
  const router = useRouter();
  const [placeholder, setPlaceholder] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);
  const [typingSpeed, setTypingSpeed] = useState(100);
  const [searchTerm, setSearchTerm] = useState('');

  // Typing Effect for Placeholder
  useEffect(() => {
    if (!services.length) return;

    let timer;
    const handleTyping = () => {
      const i = loopNum % services.length;
      const fullText = services[i];
      
      if (!isDeleting) {
        setPlaceholder(fullText.substring(0, placeholder.length + 1));
        setTypingSpeed(80);
      } else {
        setPlaceholder(fullText.substring(0, placeholder.length - 1));
        setTypingSpeed(40);
      }

      if (!isDeleting && placeholder === fullText) {
        setTimeout(() => setIsDeleting(true), 2000);
      } else if (isDeleting && placeholder === '') {
        setIsDeleting(false);
        setLoopNum(loopNum + 1);
        setTypingSpeed(80);
      }
    };

    timer = setTimeout(handleTyping, typingSpeed);
    return () => clearTimeout(timer);
  }, [placeholder, isDeleting, loopNum, typingSpeed, services]);

  const handleSearchClick = () => {
    if (searchTerm.trim()) {
      router.push(`/services?search=${encodeURIComponent(searchTerm)}`);
    } else {
      router.push('/services');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearchClick();
  };

  return (
    <div className="relative w-full max-w-2xl lg:mx-0 mx-auto">
      <div className="flex items-center gap-2 bg-white border border-line rounded-2xl p-1.5 pl-4 shadow-card focus-within:border-ink/40 focus-within:ring-4 focus-within:ring-brand-500/10 transition">
        <svg className="w-5 h-5 shrink-0 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          aria-label="Search services"
          placeholder={placeholder || 'What do you need fixed?'}
          className="min-w-0 w-full bg-transparent border-none outline-none text-ink placeholder:text-ink-muted text-base py-2.5"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={handleSearchClick}
          className="shrink-0 font-semibold px-5 sm:px-6 py-2.5 rounded-xl bg-ink text-white hover:bg-brand-900 transition active:scale-95 text-sm sm:text-base"
        >
          Search
        </button>
      </div>
    </div>
  );
}
