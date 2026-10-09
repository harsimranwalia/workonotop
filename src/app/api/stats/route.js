import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
    const auth = await requireCaller(request, ['admin']);
    if (!auth.ok) return auth.response;
    try {
        // Total bookings/jobs
        const [totalBookingsResult] = await query('SELECT COUNT(*) as total FROM bookings')

        // Bookings by status
        const [pendingBookingsResult] = await query("SELECT COUNT(*) as total FROM bookings WHERE status = 'pending'")
        const [confirmedBookingsResult] = await query("SELECT COUNT(*) as total FROM bookings WHERE status = 'confirmed'")
        const [inProgressBookingsResult] = await query("SELECT COUNT(*) as total FROM bookings WHERE status = 'in_progress'")
        const [completedBookingsResult] = await query("SELECT COUNT(*) as total FROM bookings WHERE status = 'completed'")
        const [cancelledBookingsResult] = await query("SELECT COUNT(*) as total FROM bookings WHERE status = 'cancelled'")

        // Total customers (users with role 'user')
        const [totalCustomersResult] = await query("SELECT COUNT(*) as total FROM users WHERE role = 'user'")

        // Verified customers (assuming 'user' role is the filter)
        const [verifiedCustomersResult] = await query("SELECT COUNT(*) as total FROM users WHERE role = 'user'")

        // Total service providers (tradespeople)
        const [totalProvidersResult] = await query('SELECT COUNT(*) as total FROM service_providers')

        // Providers by status
        const [activeProvidersResult] = await query("SELECT COUNT(*) as total FROM service_providers WHERE status = 'active'")
        const [inactiveProvidersResult] = await query("SELECT COUNT(*) as total FROM service_providers WHERE status = 'inactive'")
        const [suspendedProvidersResult] = await query("SELECT COUNT(*) as total FROM service_providers WHERE status = 'suspended'")

        // Total reviews (from provider_reviews table)
        const [totalReviewsResult] = await query('SELECT COUNT(*) as total FROM provider_reviews')

        // Average rating
        const [averageRatingResult] = await query('SELECT COALESCE(AVG(rating), 0) as avg FROM provider_reviews')

        // Ratings distribution
        const [fiveStarResult] = await query("SELECT COUNT(*) as total FROM provider_reviews WHERE rating = 5")
        const [fourStarResult] = await query("SELECT COUNT(*) as total FROM provider_reviews WHERE rating = 4")
        const [threeStarResult] = await query("SELECT COUNT(*) as total FROM provider_reviews WHERE rating = 3")
        const [twoStarResult] = await query("SELECT COUNT(*) as total FROM provider_reviews WHERE rating = 2")
        const [oneStarResult] = await query("SELECT COUNT(*) as total FROM provider_reviews WHERE rating = 1")

        // Total revenue
        const [totalRevenueResult] = await query('SELECT COALESCE(SUM(service_price), 0) as total FROM bookings WHERE payment_status = "paid"')

        // Jobs this week (last 7 days)
        const [jobsThisWeekResult] = await query('SELECT COUNT(*) as total FROM bookings WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)')

        // New customers this week
        const [newCustomersResult] = await query("SELECT COUNT(*) as total FROM users WHERE role = 'user' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)")

        // New tradespeople this week
        const [newTradespeopleResult] = await query('SELECT COUNT(*) as total FROM service_providers WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)')

        // Total services
        const [totalServicesResult] = await query('SELECT COUNT(*) as total FROM services WHERE is_active = TRUE')

        // Total categories
        const [totalCategoriesResult] = await query('SELECT COUNT(*) as total FROM service_categories WHERE is_active = TRUE')

        // Calculate completion rate
        const totalCompleted = parseInt(completedBookingsResult?.total || 0)
        const totalBookings = parseInt(totalBookingsResult?.total || 0)
        const completionRate = totalBookings > 0 ? ((totalCompleted / totalBookings) * 100).toFixed(1) : 0

        return NextResponse.json({
            success: true,
            data: {
                // Job statistics
                totalJobs: parseInt(totalBookingsResult?.total || 0),
                pendingJobs: parseInt(pendingBookingsResult?.total || 0),
                confirmedJobs: parseInt(confirmedBookingsResult?.total || 0),
                inProgressJobs: parseInt(inProgressBookingsResult?.total || 0),
                completedJobs: parseInt(completedBookingsResult?.total || 0),
                cancelledJobs: parseInt(cancelledBookingsResult?.total || 0),

                // Customer statistics
                totalCustomers: parseInt(totalCustomersResult?.total || 0),
                verifiedCustomers: parseInt(verifiedCustomersResult?.total || 0),
                newCustomers: parseInt(newCustomersResult?.total || 0),

                // Tradespeople statistics
                totalTradespeople: parseInt(totalProvidersResult?.total || 0),
                activeTradespeople: parseInt(activeProvidersResult?.total || 0),
                inactiveTradespeople: parseInt(inactiveProvidersResult?.total || 0),
                suspendedTradespeople: parseInt(suspendedProvidersResult?.total || 0),
                newTradespeople: parseInt(newTradespeopleResult?.total || 0),

                // Review statistics
                totalReviews: parseInt(totalReviewsResult?.total || 0),
                averageRating: parseFloat(averageRatingResult?.avg || 0).toFixed(1),
                fiveStarReviews: parseInt(fiveStarResult?.total || 0),
                fourStarReviews: parseInt(fourStarResult?.total || 0),
                threeStarReviews: parseInt(threeStarResult?.total || 0),
                twoStarReviews: parseInt(twoStarResult?.total || 0),
                oneStarReviews: parseInt(oneStarResult?.total || 0),

                // Service statistics
                totalServices: parseInt(totalServicesResult?.total || 0),
                totalCategories: parseInt(totalCategoriesResult?.total || 0),

                // Financial statistics
                totalRevenue: parseFloat(totalRevenueResult?.total || 0).toFixed(2),

                // Weekly statistics
                jobsThisWeek: parseInt(jobsThisWeekResult?.total || 0),
                completionRate: parseFloat(completionRate)
            }
        })
    } catch (error) {
        console.error('Error fetching stats:', error)
        return NextResponse.json({
            success: false,
            message: 'Failed to fetch statistics',
            data: {
                totalJobs: 0,
                pendingJobs: 0,
                confirmedJobs: 0,
                inProgressJobs: 0,
                completedJobs: 0,
                cancelledJobs: 0,
                totalCustomers: 0,
                verifiedCustomers: 0,
                newCustomers: 0,
                totalTradespeople: 0,
                activeTradespeople: 0,
                inactiveTradespeople: 0,
                suspendedTradespeople: 0,
                newTradespeople: 0,
                totalReviews: 0,
                averageRating: '0.0',
                fiveStarReviews: 0,
                fourStarReviews: 0,
                threeStarReviews: 0,
                twoStarReviews: 0,
                oneStarReviews: 0,
                totalServices: 0,
                totalCategories: 0,
                totalRevenue: '0.00',
                jobsThisWeek: 0,
                completionRate: 0
            }
        }, { status: 200 })
    }
}