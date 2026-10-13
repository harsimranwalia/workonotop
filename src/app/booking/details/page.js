'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Bookmarks and open tabs of this address land on the booking flow's last step, or on the services page when no booking is in progress.
export default function BookingDetailsPage() {
  const router = useRouter();

  useEffect(() => {
    let serviceId = null;
    try {
      const flow = JSON.parse(sessionStorage.getItem('bookingFlow') || 'null');
      serviceId = flow && flow.service_id ? flow.service_id : null;
    } catch (error) {
      console.error('The stored booking flow could not be read:', error);
    }
    router.replace(serviceId ? `/booking/schedule?service=${encodeURIComponent(serviceId)}&step=4` : '/services');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="motion-safe:animate-spin rounded-full h-16 w-16 border-4 border-green-500 border-t-transparent"></div>
    </div>
  );
}
