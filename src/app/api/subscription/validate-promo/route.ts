import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { code: rawCode, planId, email: rawEmail, amount: rawAmount } = body;

        const code = rawCode?.trim().toUpperCase();
        const email = rawEmail?.trim().toLowerCase();
        const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(rawAmount || '0');

        if (!code) {
            return NextResponse.json({ valid: false, error: 'Promo code is required' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 1. Fetch promo code
        const { data: promo, error: fetchError } = await supabase
            .from('subscription_discount_codes')
            .select('*')
            .eq('code', code)
            .maybeSingle();

        if (fetchError || !promo) {
            return NextResponse.json({ valid: false, error: 'Invalid discount code' }, { status: 404 });
        }

        // 2. Check active flag
        if (!promo.is_active) {
            return NextResponse.json({ valid: false, error: 'This discount code is no longer active' }, { status: 400 });
        }

        const now = new Date();

        // 3. Check start date
        if (promo.valid_from && new Date(promo.valid_from) > now) {
            return NextResponse.json({ valid: false, error: 'This discount code is not active yet' }, { status: 400 });
        }

        // 4. Check expiry date
        if (promo.valid_until && new Date(promo.valid_until) < now) {
            return NextResponse.json({ valid: false, error: 'This discount code has expired' }, { status: 400 });
        }

        // 5. Check global max uses
        if (promo.max_uses !== null && promo.max_uses !== undefined && (promo.used_count || 0) >= promo.max_uses) {
            return NextResponse.json({ valid: false, error: 'This discount code has reached its maximum usage limit' }, { status: 400 });
        }

        // 6. Check plan restrictions
        if (promo.applicable_plan_ids && promo.applicable_plan_ids.length > 0 && planId) {
            const PLAN_YEARLY = process.env.RAZORPAY_PLAN_YEARLY || process.env.NEXT_PUBLIC_RAZORPAY_PLAN_YEARLY || '';
            const PLAN_MONTHLY = process.env.RAZORPAY_PLAN_MONTHLY || process.env.NEXT_PUBLIC_RAZORPAY_PLAN_MONTHLY || '';
            
            const isYearlyTarget = planId === PLAN_YEARLY || planId === 'yearly' || planId === 'plan_yearly';
            const isMonthlyTarget = planId === PLAN_MONTHLY || planId === 'monthly' || planId === 'plan_monthly';

            const matchesDirectly = promo.applicable_plan_ids.includes(planId);
            const matchesYearly = isYearlyTarget && promo.applicable_plan_ids.some((id: string) => id === PLAN_YEARLY || id === 'yearly' || id === 'plan_yearly');
            const matchesMonthly = isMonthlyTarget && promo.applicable_plan_ids.some((id: string) => id === PLAN_MONTHLY || id === 'monthly' || id === 'plan_monthly');

            if (!matchesDirectly && !matchesYearly && !matchesMonthly) {
                return NextResponse.json({ valid: false, error: 'This discount code is not applicable to the selected plan' }, { status: 400 });
            }
        }

        // 7. Check minimum order amount
        if (promo.min_order_amount && amount < promo.min_order_amount) {
            return NextResponse.json({
                valid: false,
                error: `Minimum plan amount of ₹${promo.min_order_amount} required to use this code`
            }, { status: 400 });
        }

        // 8. Check per-user limit if email is provided
        if (email && promo.uses_per_user) {
            // Check usage in subscription_discount_code_uses via user_subscriptions
            const { data: userUsages, error: usageError } = await supabase
                .from('subscription_discount_code_uses')
                .select('id, user_subscriptions!inner(customer_email)')
                .eq('discount_code_id', promo.id)
                .eq('user_subscriptions.customer_email', email);

            if (!usageError && userUsages && userUsages.length >= promo.uses_per_user) {
                return NextResponse.json({
                    valid: false,
                    error: `You have already used this discount code the maximum allowed times (${promo.uses_per_user})`
                }, { status: 400 });
            }
        }

        // 9. Calculate discount
        let discountAmount = 0;
        const discountValue = Number(promo.discount_value) || 0;

        if (promo.discount_type === 'percentage') {
            discountAmount = (amount * discountValue) / 100;
            if (promo.max_discount_amount !== null && promo.max_discount_amount !== undefined) {
                const maxCap = Number(promo.max_discount_amount);
                if (maxCap > 0) {
                    discountAmount = Math.min(discountAmount, maxCap);
                }
            }
        } else if (promo.discount_type === 'fixed_amount') {
            discountAmount = Math.min(discountValue, amount);
        }

        discountAmount = Math.round(discountAmount * 100) / 100;
        const finalAmount = Math.max(0, Math.round((amount - discountAmount) * 100) / 100);

        return NextResponse.json({
            valid: true,
            discountCode: {
                id: promo.id,
                code: promo.code,
                description: promo.description,
                discount_type: promo.discount_type,
                discount_value: promo.discount_value,
                duration_type: promo.duration_type,
                duration_in_cycles: promo.duration_in_cycles,
                razorpay_offer_id: promo.razorpay_offer_id,
            },
            discountAmount,
            finalAmount,
        });

    } catch (error: any) {
        console.error('[Validate Promo Error]:', error);
        return NextResponse.json({
            valid: false,
            error: error?.message || 'Failed to validate discount code'
        }, { status: 500 });
    }
}
