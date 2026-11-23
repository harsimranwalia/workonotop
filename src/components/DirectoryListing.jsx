'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const PAGE_SIZE = 48;

export default function DirectoryListing({ initialItems = null }) {
  const [items, setItems] = useState(Array.isArray(initialItems) ? initialItems : []);
  const [loading, setLoading] = useState(!Array.isArray(initialItems) || initialItems.length === 0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (Array.isArray(initialItems) && initialItems.length > 0) {
      setItems(initialItems);
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const res = await fetch('/api/directory');
        const data = await res.json();
        if (data.success) {
          setItems(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching directory data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [initialItems]);

  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
  const currentItems = items.slice(startIndex, endIndex);

  // Pagination Logic
  const getPages = () => {
    const pages = [];
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(totalPages, page + 2);

    if (page <= 3) {
      endPage = Math.min(totalPages, 5);
    }
    if (page >= totalPages - 2) {
      startPage = Math.max(1, totalPages - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  };

  return (
    <div className="w-full">
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="w-12 h-12 border-4 border-[#16A34A]/20 border-t-[#16A34A] rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          {totalItems > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 mb-10 text-left">
                {currentItems.map((item, idx) => {
                  const title = `${item.service_name} in ${item.location_name}`;
                  const slugUrl = `/services/${item.full_slug || `${item.service_slug}-in-${item.location_slug}`}`;
                  
                  return (
                    <Link 
                      key={`${item.service_slug}-${item.location_slug}-${idx}`}
                      href={slugUrl}
                      className="group block py-1"
                      title={title}
                    >
                      <h3 className="text-ink-soft text-sm font-medium group-hover:text-brand-700 group-hover:underline underline-offset-2 truncate text-left">
                        {title}
                      </h3>
                    </Link>
                  );
                })}
              </div>

              <div className="flex flex-col md:flex-row items-center justify-between border-t border-line pt-8">
                <div className="text-slate-500 text-sm mb-6 md:mb-0">
                  Showing <span className="font-bold text-slate-900">{startIndex + 1}</span> to <span className="font-bold text-slate-900">{endIndex}</span> of <span className="font-bold text-slate-900">{totalItems}</span> services
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1 transition-all ${
                      page === 1 
                        ? 'text-slate-400 cursor-not-allowed' 
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                  </button>

                  <div className="flex gap-1">
                    {getPages().map(p => (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-8 h-8 rounded-lg text-sm font-bold transition-all flex items-center justify-center ${
                          page === p
                            ? 'bg-ink text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1 transition-all ${
                      page === totalPages 
                        ? 'text-slate-400 cursor-not-allowed' 
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Next
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-slate-500">There are currently no active local trades or services.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
