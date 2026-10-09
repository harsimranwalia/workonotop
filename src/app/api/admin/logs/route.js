import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const actorType = searchParams.get('actor_type') // 'customer', 'provider', 'admin', 'system'
    const action = searchParams.get('action')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = (page - 1) * limit
    
    let baseSql = `FROM activity_logs WHERE 1=1`
    const params = []

    if (actorType && actorType !== 'all') {
      baseSql += ` AND actor_type = ?`
      params.push(actorType)
    }

    if (action && action !== 'all') {
      baseSql += ` AND action = ?`
      params.push(action)
    }

    // Get total count
    const [countResult] = await execute(`SELECT COUNT(*) as total ${baseSql}`, params)
    const total = countResult?.total || 0

    // Get paginated data
    const sql = `SELECT * ${baseSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    const logs = await execute(sql, params)
    
    return NextResponse.json({ 
      success: true, 
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('[API Admin Logs] Error fetching logs:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch logs' }, { status: 500 })
  }
}
