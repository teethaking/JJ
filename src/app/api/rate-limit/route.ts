import { NextRequest, NextResponse } from 'next/server'

// In-memory rate limiting storage
// In production, consider using Redis for distributed rate limiting
interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Configuration
const WINDOW_MS = 60 * 1000 // 1 minute window
const MAX_REQUESTS = 30 // max requests per window

function cleanExpiredEntries() {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key)
    }
  }
}

// Run cleanup periodically
setInterval(cleanExpiredEntries, 60000)

export async function GET(request: NextRequest) {
  // Use IP address as identifier, fallback to a default for server-side calls
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || 'default'
  
  const now = Date.now()
  const entry = rateLimitStore.get(ip)
  
  if (!entry || entry.resetTime < now) {
    // New window - allow request
    rateLimitStore.set(ip, {
      count: 1,
      resetTime: now + WINDOW_MS
    })
    
    return NextResponse.json({
      allowed: true,
      remaining: MAX_REQUESTS - 1,
      resetIn: Math.ceil(WINDOW_MS / 1000)
    })
  }
  
  if (entry.count >= MAX_REQUESTS) {
    // Rate limited
    const resetIn = Math.ceil((entry.resetTime - now) / 1000)
    
    return NextResponse.json({
      allowed: false,
      remaining: 0,
      resetIn
    }, { status: 429 })
  }
  
  // Increment count
  entry.count++
  
  return NextResponse.json({
    allowed: true,
    remaining: MAX_REQUESTS - entry.count,
    resetIn: Math.ceil((entry.resetTime - now) / 1000)
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body
    
    // Use IP address as identifier
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'default'
    
    const now = Date.now()
    const entry = rateLimitStore.get(ip)
    
    if (!entry || entry.resetTime < now) {
      // New window - allow request
      rateLimitStore.set(ip, {
        count: 1,
        resetTime: now + WINDOW_MS
      })
      
      return NextResponse.json({
        allowed: true,
        remaining: MAX_REQUESTS - 1,
        resetIn: Math.ceil(WINDOW_MS / 1000)
      })
    }
    
    if (entry.count >= MAX_REQUESTS) {
      // Rate limited
      const resetIn = Math.ceil((entry.resetTime - now) / 1000)
      
      return NextResponse.json({
        allowed: false,
        remaining: 0,
        resetIn
      }, { status: 429 })
    }
    
    // Increment count
    entry.count++
    
    return NextResponse.json({
      allowed: true,
      remaining: MAX_REQUESTS - entry.count,
      resetIn: Math.ceil((entry.resetTime - now) / 1000)
    })
  } catch (error) {
    return NextResponse.json({
      allowed: true,
      remaining: MAX_REQUESTS,
      resetIn: Math.ceil(WINDOW_MS / 1000)
    })
  }
}