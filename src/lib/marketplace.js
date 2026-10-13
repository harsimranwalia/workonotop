// One rule for what a provider may see and take: a job is on the marketplace when it has no provider, an admin has pushed it, and its status is pending or matching.
import { execute } from '@/lib/db'
import { notifyUser } from '@/lib/push'

// The rule as a WHERE fragment over a bookings row aliased `b`.
export const OPEN_ON_MARKETPLACE = `(b.provider_id IS NULL AND b.marketplace_pushed_at IS NOT NULL AND b.status IN ('pending', 'matching'))`

const WAITING_STATUSES = ['pending', 'matching']

// The claim decision on a row read FOR UPDATE: 'open' on the marketplace, 'mine' assigned to the caller and not yet accepted, 'taken' held by another provider, 'not_offered' otherwise.
export function offerOf(job, providerId) {
  if (job.provider_id !== null) {
    if (Number(job.provider_id) !== Number(providerId)) return 'taken'
    return WAITING_STATUSES.includes(job.status) ? 'mine' : 'not_offered'
  }
  return WAITING_STATUSES.includes(job.status) && job.marketplace_pushed_at ? 'open' : 'not_offered'
}

// Where a booking stands in the admin job queue: waiting for a provider, on the marketplace, assigned and not yet accepted, accepted, or closed.
export function queueStateOf(booking) {
  if (booking.status === 'completed' || booking.status === 'cancelled') return 'closed'
  const waiting = WAITING_STATUSES.includes(booking.status)
  if (booking.provider_id === null) return waiting && booking.marketplace_pushed_at ? 'on_marketplace' : 'waiting'
  return waiting ? 'assigned' : 'accepted'
}

// Tells active providers whose area and skills match the job that it is on the marketplace; the push calls it once per job.
export async function notifyMatchingProviders(booking) {
  try {
    const { id: bookingId, service_id, service_name, city, cluster: jobCluster, job_date, job_time_slot } = booking
    const basePrice = parseFloat(booking.service_price || 0)
    const standardDuration = booking.standard_duration_minutes || 60

    let serviceSkills = []
    if (service_id) {
      const serviceRows = await execute('SELECT skills FROM services WHERE id = ?', [service_id])
      if (serviceRows.length > 0) {
        const rawSkills = serviceRows[0].skills
        try {
          serviceSkills = typeof rawSkills === 'string' ? JSON.parse(rawSkills) : (rawSkills || [])
        } catch {
          console.error(`[Marketplace] Service ${service_id} has unreadable skills; matching on its name`)
        }
      }
    }

    const providers = await execute(
      `SELECT id, service_areas, skills FROM service_providers WHERE status = 'active'`
    )

    // Match providers
    const matchedProviders = providers.filter(p => {
      // Check if provider works in this cluster
      let areas = []
      try {
        areas = typeof p.service_areas === 'string' ? JSON.parse(p.service_areas) : p.service_areas
      } catch {
        console.error(`[Marketplace] Provider ${p.id} has unreadable service areas`)
      }
      if (!areas || !Array.isArray(areas) || !areas.includes(jobCluster)) return false

      // Check if provider has matching skill
      let pSkills = []
      try {
        pSkills = typeof p.skills === 'string' ? JSON.parse(p.skills) : p.skills
      } catch {
        console.error(`[Marketplace] Provider ${p.id} has unreadable skills`)
      }
      if (!pSkills || !Array.isArray(pSkills) || pSkills.length === 0) return false

      if (serviceSkills && serviceSkills.length > 0) {
        // Intersection: provider must have at least one skill required by the service
        return pSkills.some(ps => serviceSkills.includes(ps))
      } else {
        // Fallback for services that don't have skills assigned yet
        const serviceNameLower = (service_name || '').toLowerCase()
        return pSkills.some(skill => serviceNameLower.includes(skill.toLowerCase()) || skill.toLowerCase().includes(serviceNameLower))
      }
    })

    console.log(`[Marketplace] Blasting to ${matchedProviders.length} providers for cluster ${jobCluster}`)

    const earningsAmount = (basePrice * 0.65).toFixed(2)
    const displayDate = new Date(job_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    matchedProviders.forEach(p => {
      // Send Push Notification
      notifyUser(p.id, 'New Job Available!', `Tap to view details for ${service_name} in ${city || jobCluster}`, {
        bookingId,
        type: 'job_blast',
        service_name,
        estimated_hours: standardDuration / 60,
        area: city || jobCluster,
        date_time: `${displayDate} • ${job_time_slot}`,
        earnings: earningsAmount
      }, execute, 'provider').catch(err => console.error('[Push] Notification Error:', err))
    })
  } catch (err) {
    console.error('[Marketplace] Failed to blast providers in background:', err)
  }
}
