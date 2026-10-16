'use client';

// "Job link" on an admin's booking page (ENG-015): what the provider's panel shows, with the check-ins (and whether each was at the address) and the recent
// activity on the link. The work is in src/components/job/JobLinkManager.jsx; this says which routes to ask and which look to wear.
import JobLinkManager from '@/components/job/JobLinkManager';

export default function JobLinkAdminPanel({ bookingId, isDarkMode }) {
  return (
    <JobLinkManager key={bookingId} path={`/api/admin/bookings/${encodeURIComponent(bookingId)}/job-link`} kind="admin" look={isDarkMode ? 'dark' : 'light'} title="Job link" />
  );
}
