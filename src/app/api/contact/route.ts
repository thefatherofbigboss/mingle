import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseClient';

// Rate limiting helper (simple in-memory cache)
const submissionsCache = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_SUBMISSIONS_PER_IP = 5;

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const submissions = submissionsCache.get(ip) || [];
    
    // Remove old submissions outside the window
    const recentSubmissions = submissions.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentSubmissions.length >= MAX_SUBMISSIONS_PER_IP) {
        return true;
    }
    
    // Add current submission
    recentSubmissions.push(now);
    submissionsCache.set(ip, recentSubmissions);
    
    return false;
}

function getClientIP(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIP = request.headers.get('x-real-ip');
    return forwarded?.split(',')[0] || realIP || 'unknown';
}

export async function POST(request: NextRequest) {
    try {
        const clientIP = getClientIP(request);
        
        // Rate limiting check
        if (isRateLimited(clientIP)) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { name, email, phone, message, submission_type = 'contact', source = 'contact_page' } = body;

        // Validate required fields
        if (!name || !email) {
            return NextResponse.json(
                { error: 'Name and email are required' },
                { status: 400 }
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { error: 'Invalid email format' },
                { status: 400 }
            );
        }

        // Validate submission_type
        if (submission_type !== 'contact' && submission_type !== 'newsletter') {
            return NextResponse.json(
                { error: 'Invalid submission type' },
                { status: 400 }
            );
        }

        // Sanitize inputs (basic HTML escaping)
        const sanitize = (str: string | null | undefined): string => {
            if (!str) return '';
            return str
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/\//g, '&#x2F;')
                .trim()
                .substring(0, 5000); // Limit length
        };

        const supabase = createServerClient();
        
        const { data, error } = await supabase
            .from('contact_submissions')
            .insert({
                name: sanitize(name),
                email: email.toLowerCase().trim(),
                phone: phone ? sanitize(phone) : null,
                message: message ? sanitize(message) : null,
                submission_type,
                source: sanitize(source),
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating contact submission:', error);
            return NextResponse.json(
                { error: 'Failed to submit. Please try again later.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: submission_type === 'newsletter' 
                ? 'Successfully subscribed to newsletter!' 
                : 'Thank you for contacting us. We\'ll get back to you soon.',
            id: data.id
        }, { status: 201 });

    } catch (error: unknown) {
        console.error('Error in contact API:', error);
        return NextResponse.json(
            { error: 'Internal server error. Please try again later.' },
            { status: 500 }
        );
    }
}
