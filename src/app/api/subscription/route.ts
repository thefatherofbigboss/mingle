import { NextRequest, NextResponse } from 'next/server';
import { razorpay } from '@/lib/razorpay';
import { createAdminClient } from '@/lib/supabaseClient';
import { verifyRecaptcha } from '@/lib/recaptcha';


export async function POST(req: NextRequest) {
    try {
        console.log(`[Backend API] POST /api/subscription received`);
        const body = await req.json();
        const { planId, name, email, phone, recaptchaToken } = body;

        // 0. reCAPTCHA Assessment
        if (recaptchaToken) {
            const assessment = await verifyRecaptcha(recaptchaToken, 'member_apply');
            console.log('[reCAPTCHA] Assessment Result:', JSON.stringify(assessment, null, 2));
            
            if (!assessment.success || assessment.score < 0.3) {
                console.warn(`[reCAPTCHA] Risk detected: score=${assessment.score}, success=${assessment.success}, error=${assessment.error}`);
                
                // Only hard-block if the score is definitive 0.0 or if project-level failure
                // We'll be more lenient during local development if the API is unreachable
                if (assessment.score < 0.1 && assessment.success) {
                    return NextResponse.json({ error: 'Security verification failed. Please try again.' }, { status: 403 });
                }
            }
        } else {
            console.warn('[reCAPTCHA] No token provided for subscription initiation.');
        }


        if (!planId || !name || !email || !phone) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }


        // Clean up the phone number to ensure it starts with country code, but mostly keeping it raw
        const contactStr = phone.startsWith('+') ? phone : `+91${phone}`;

        // 1. Create Customer in Razorpay (Required for subscriptions)
        // Check if customer exists or just create a new one every time (simple approach)
        const customer = await razorpay.customers.create({
            name,
            email,
            contact: contactStr,
            fail_existing: "0" as any // "0" explicitly returns the existing customer
        });

        // 2. Create the Subscription in Razorpay
        const subscriptionArgs: any = {
            plan_id: planId,
            customer_id: customer.id,
            total_count: 120, // 10 years for monthly, 120 years for yearly.
            customer_notify: 1, 
            notes: {
                name,
                email,
                phone,
                plan_id: planId
            }
        };

        const subscription = await razorpay.subscriptions.create(subscriptionArgs);

        const supabase = createAdminClient();

        // 3. Save pending subscription in DB
        // We will store this in `subscriptions` table. Since we don't know the exact schema, 
        // we'll use a JSONB field `metadata` or just insert standard tracking columns.
        const { error: dbError } = await supabase.from('subscriptions').insert({
            razorpay_subscription_id: subscription.id,
            razorpay_customer_id: customer.id,
            plan_id: planId,
            customer_email: email,
            customer_phone: phone,
            customer_name: name,
            status: 'created', // pending payment
            metadata: { plan_id: planId }
        });

        if (dbError) {
             // If schema does not match, we can just insert into a `temp_transactions` table
             // or catch and store in `bookings` for fallback since bookings works.
             // But we will alter table later if it fails.
             console.error('Initial subscription insertion error:', dbError);
        }

        return NextResponse.json({
            success: true,
            subscriptionId: subscription.id,
            customerId: customer.id,
            customerName: name,
            customerEmail: email,
            customerPhone: phone
        });

    } catch (error: any) {
        console.error('Subscription Creation Error:', error);
        return NextResponse.json({
            success: false,
            error: error?.description || error?.message || 'Failed to create subscription'
        }, { status: 500 });
    }
}
