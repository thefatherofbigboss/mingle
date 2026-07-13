import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseClient';

// Simple in-memory rate limiting (max 3 submissions per IP per hour)
const hostAppCache = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const MAX_SUBMISSIONS_PER_IP = 3;

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const submissions = hostAppCache.get(ip) || [];
    const recent = submissions.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recent.length >= MAX_SUBMISSIONS_PER_IP) {
        return true;
    }
    
    recent.push(now);
    hostAppCache.set(ip, recent);
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
        if (isRateLimited(clientIP)) {
            return NextResponse.json(
                { error: 'Too many applications submitted. Please try again later.' },
                { status: 429 }
            );
        }

        const body = await request.json();
        
        // Extract fields
        const {
            full_name,
            age,
            city,
            phone,
            email,
            occupation,
            member_since,
            events_attended,
            why_host,
            event_formats,
            availability,
            has_prior_experience,
            prior_experience_detail,
            safety_understanding,
            agree_to_terms,
            agree_to_safety,
            agree_to_zero_harassment
        } = body;

        // Basic validation
        if (!full_name || !email || !phone || !city) {
            return NextResponse.json(
                { error: 'Full name, email, phone, and city are required fields' },
                { status: 400 }
            );
        }

        if (!agree_to_terms || !agree_to_safety || !agree_to_zero_harassment) {
            return NextResponse.json(
                { error: 'You must agree to safety and zero-harassment policies' },
                { status: 400 }
            );
        }

        // Sanitizer
        const sanitize = (str: string | null | undefined): string => {
            if (!str) return '';
            return str
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/\//g, '&#x2F;')
                .trim()
                .substring(0, 5000);
        };

        const sanitizeArray = (arr: any): string[] => {
            if (!Array.isArray(arr)) return [];
            return arr.map(item => sanitize(String(item)));
        };

        const supabase = createServerClient();

        const insertData = {
            full_name: sanitize(full_name),
            age: age ? Number(age) : null,
            city: sanitize(city),
            phone: sanitize(phone),
            email: email.toLowerCase().trim(),
            occupation: sanitize(occupation),
            member_since: sanitize(member_since),
            events_attended: sanitize(events_attended),
            why_host: sanitize(why_host),
            event_formats: sanitizeArray(event_formats),
            availability: sanitizeArray(availability),
            has_prior_experience: sanitize(has_prior_experience),
            prior_experience_detail: sanitize(prior_experience_detail),
            safety_understanding: sanitize(safety_understanding),
            agree_to_terms: !!agree_to_terms,
            agree_to_safety: !!agree_to_safety,
            agree_to_zero_harassment: !!agree_to_zero_harassment,
        };

        const { data, error } = await supabase
            .from('host_applications')
            .insert([insertData])
            .select()
            .single();

        if (error) {
            console.error('Error inserting host application:', error);
            return NextResponse.json(
                { error: 'Failed to submit application. Please try again later.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Application submitted successfully!',
            id: data.id
        }, { status: 201 });

    } catch (error: any) {
        console.error('Error in host application API:', error);
        return NextResponse.json(
            { error: 'Internal server error. Please try again later.' },
            { status: 500 }
        );
    }
}
