import { NextRequest, NextResponse } from 'next/server';
import { razorpay } from '@/lib/razorpay';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        console.log(`[Backend API] POST /api/subscription received`);
        const body = await req.json();
        const { planId, name: rawName, email: rawEmail, phone: rawPhone, discountCode: rawDiscountCode, amount: rawAmount } = body;

        const name = rawName?.trim();
        const email = rawEmail?.trim().toLowerCase();
        const phone = rawPhone?.trim();
        const discountCode = rawDiscountCode?.trim().toUpperCase();

        if (!planId || !name || !email || !phone) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const PLAN_YEARLY = process.env.RAZORPAY_PLAN_YEARLY || process.env.NEXT_PUBLIC_RAZORPAY_PLAN_YEARLY || '';
        const isYearly = planId === PLAN_YEARLY || planId === 'yearly';
        const defaultBasePrice = isYearly ? 1999 : 499;
        const originalAmount = typeof rawAmount === 'number' && rawAmount > 0 ? rawAmount : defaultBasePrice;

        const supabase = createAdminClient();

        // Optional: Process Discount Code
        let appliedPromo: any = null;
        let calculatedDiscount = 0;
        let finalAmount = originalAmount;

        if (discountCode) {
            const { data: promo, error: promoError } = await supabase
                .from('subscription_discount_codes')
                .select('*')
                .eq('code', discountCode)
                .maybeSingle();

            if (promoError || !promo || !promo.is_active) {
                return NextResponse.json({ error: 'Invalid or inactive discount code' }, { status: 400 });
            }

            const now = new Date();
            if (promo.valid_from && new Date(promo.valid_from) > now) {
                return NextResponse.json({ error: 'Discount code is not active yet' }, { status: 400 });
            }
            if (promo.valid_until && new Date(promo.valid_until) < now) {
                return NextResponse.json({ error: 'Discount code has expired' }, { status: 400 });
            }
            if (promo.max_uses !== null && promo.max_uses !== undefined && (promo.used_count || 0) >= promo.max_uses) {
                return NextResponse.json({ error: 'Discount code usage limit reached' }, { status: 400 });
            }
            if (promo.applicable_plan_ids && promo.applicable_plan_ids.length > 0 && planId) {
                const PLAN_MONTHLY = process.env.RAZORPAY_PLAN_MONTHLY || process.env.NEXT_PUBLIC_RAZORPAY_PLAN_MONTHLY || '';
                const isMonthlyTarget = planId === PLAN_MONTHLY || planId === 'monthly' || planId === 'plan_monthly';

                const matchesDirectly = promo.applicable_plan_ids.includes(planId);
                const matchesYearly = isYearly && promo.applicable_plan_ids.some((id: string) => id === PLAN_YEARLY || id === 'yearly' || id === 'plan_yearly');
                const matchesMonthly = isMonthlyTarget && promo.applicable_plan_ids.some((id: string) => id === PLAN_MONTHLY || id === 'monthly' || id === 'plan_monthly');

                if (!matchesDirectly && !matchesYearly && !matchesMonthly) {
                    return NextResponse.json({ error: 'Discount code is not applicable to the selected plan' }, { status: 400 });
                }
            }

            const discountVal = Number(promo.discount_value) || 0;
            if (promo.discount_type === 'percentage') {
                calculatedDiscount = (originalAmount * discountVal) / 100;
                if (promo.max_discount_amount) {
                    calculatedDiscount = Math.min(calculatedDiscount, Number(promo.max_discount_amount));
                }
            } else {
                calculatedDiscount = Math.min(discountVal, originalAmount);
            }
            calculatedDiscount = Math.round(calculatedDiscount * 100) / 100;
            finalAmount = Math.max(0, Math.round((originalAmount - calculatedDiscount) * 100) / 100);
            appliedPromo = promo;
        }

        const amountInPaise = Math.round(finalAmount * 100);

        console.log(`[Subscription Order] Creating ${isYearly ? 'YEARLY' : 'MONTHLY'} order: original=₹${originalAmount}, discount=₹${calculatedDiscount}, final=₹${finalAmount} (${amountInPaise} paise)`);

        // Create standard Razorpay Order
        const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: `sub_${Date.now().toString().slice(-8)}`,
            notes: {
                name,
                email,
                phone,
                plan_type: isYearly ? 'yearly' : 'monthly',
                plan_id: planId,
                payment_type: 'subscription_membership',
                ...(appliedPromo && {
                    discount_code: appliedPromo.code,
                    discount_amount: calculatedDiscount.toString(),
                    discount_type: appliedPromo.discount_type
                })
            }
        });

        // Save pending subscription record in user_subscriptions table
        const { error: dbError } = await supabase.from('user_subscriptions').insert({
            razorpay_order_id: order.id,
            razorpay_plan_id: planId,
            plan_type: isYearly ? 'yearly' : 'monthly',
            customer_name: name,
            customer_email: email,
            customer_phone: phone,
            status: 'created', // pending payment
            discount_code_id: appliedPromo?.id || null,
            discount_amount: calculatedDiscount,
            original_amount: originalAmount,
            notes: {
                plan_type: isYearly ? 'yearly' : 'monthly',
                order_id: order.id,
                ...(appliedPromo && {
                    discount_code: appliedPromo.code,
                    discount_type: appliedPromo.discount_type,
                    discount_value: appliedPromo.discount_value,
                    final_amount: finalAmount
                })
            }
        });

        if (dbError) {
            console.error('Initial user_subscription insertion error:', dbError);
            return NextResponse.json(
                { success: false, error: 'Failed to save subscription record. Please try again.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            customerName: name,
            customerEmail: email,
            customerPhone: phone,
            keyId: process.env.RAZORPAY_KEY_ID
        });

    } catch (error: any) {
        console.error('Subscription Creation Error:', error);
        return NextResponse.json({
            success: false,
            error: error?.description || error?.message || 'Failed to create subscription order'
        }, { status: 500 });
    }
}
