import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const token = searchParams.get('token');

        if (!token) {
            return NextResponse.json({ error: 'Token is required' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 1. Find subscription by token
        const { data: subscription, error: fetchError } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('verification_token', token)
            .maybeSingle();

        if (fetchError || !subscription) {
            console.error('[VerifyEmail] Invalid token or fetch error:', fetchError);
            return NextResponse.json({ error: 'Invalid or expired verification link' }, { status: 404 });
        }

        if (subscription.is_verified) {
            return NextResponse.json({ 
                success: true, 
                message: 'Email already verified' 
            });
        }

        // 2. Mark as verified
        const { error: updateError } = await supabase
            .from('user_subscriptions')
            .update({ 
                is_verified: true,
                email_verified_at: new Date().toISOString(),
                status: 'active' // Ensure it's active
            })
            .eq('verification_token', token);

        if (updateError) {
            console.error('[VerifyEmail] Update error:', updateError);
            return NextResponse.json({ error: 'Failed to verify email' }, { status: 500 });
        }

        console.log(`[VerifyEmail] Successfully verified: ${subscription.customer_email}`);

        return NextResponse.json({ 
            success: true, 
            message: 'Email verified successfully! Your membership is fully activated.' 
        });

    } catch (error: any) {
        console.error('[VerifyEmail] Internal Error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
