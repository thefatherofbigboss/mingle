import { NextRequest, NextResponse } from 'next/server';
import { razorpay } from '@/lib/razorpay';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        console.log(`[Backend API] POST /api/subscription received`);
        const body = await req.json();
        const { planId, name, email, phone } = body;

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
        // Determine total count based on plan: Monthly (120 cycles = 10 years) vs Yearly (10 cycles = 10 years)
        const PLAN_YEARLY = process.env.RAZORPAY_PLAN_YEARLY;
        const PLAN_MONTHLY = process.env.RAZORPAY_PLAN_MONTHLY;
        
        const isYearly = planId === PLAN_YEARLY;
        const totalCount = isYearly ? 10 : 120; // 10 years for both (1 year/cycle vs 1 month/cycle)

        console.log(`[Subscription] Creating ${isYearly ? 'YEARLY' : 'MONTHLY'} subscription with total_count: ${totalCount}`);

        const subscriptionArgs: any = {
            plan_id: planId,
            customer_id: customer.id,
            total_count: totalCount, 
            customer_notify: 1, 
            notes: {
                name,
                email,
                phone,
                plan_id: planId,
                plan_type: isYearly ? 'yearly' : 'monthly'
            }
        };

        const subscription = await razorpay.subscriptions.create(subscriptionArgs);

        const supabase = createAdminClient();

        // 3. Save pending subscription in user_subscriptions table
        const { error: dbError } = await supabase.from('user_subscriptions').insert({
            razorpay_subscription_id: subscription.id,
            razorpay_customer_id: customer.id,
            razorpay_plan_id: planId,
            customer_name: name,
            customer_email: email,
            customer_phone: phone,
            status: 'created', // pending payment
            notes: {
                plan_type: isYearly ? 'yearly' : 'monthly'
            }
        });

        if (dbError) {
             console.error('Initial user_subscription insertion error:', dbError);
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
