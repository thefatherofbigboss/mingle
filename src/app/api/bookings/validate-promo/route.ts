import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseClient'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { eventId, code, amount } = body

        if (!eventId || !code || amount === undefined) {
            return NextResponse.json(
                { success: false, error: 'Missing required parameters: eventId, code, or amount' },
                { status: 400 }
            )
        }

        const supabase = createAdminClient()

        // 1. Fetch the promo code
        const { data: promo, error: promoError } = await supabase
            .from('promo_codes')
            .select('*')
            .eq('code', code.trim().toUpperCase())
            .single()

        if (promoError || !promo) {
            return NextResponse.json(
                { success: false, error: 'Invalid or missing promo code.' },
                { status: 404 }
            )
        }

        // 2. Validate Event
        if (promo.event_id !== eventId) {
            return NextResponse.json(
                { success: false, error: 'This promo code is not valid for this event.' },
                { status: 400 }
            )
        }

        // 3. Validate Active Status
        if (!promo.is_active) {
            return NextResponse.json(
                { success: false, error: 'This promo code is no longer active.' },
                { status: 400 }
            )
        }

        // 4. Validate Dates
        const now = new Date()
        if (promo.valid_from && new Date(promo.valid_from) > now) {
            return NextResponse.json(
                { success: false, error: 'This promo code is not active yet.' },
                { status: 400 }
            )
        }
        if (promo.valid_until && new Date(promo.valid_until) < now) {
            return NextResponse.json(
                { success: false, error: 'This promo code has expired.' },
                { status: 400 }
            )
        }

        // 5. Validate Usage Limits
        if (promo.max_uses !== null && (promo.used_count || 0) >= promo.max_uses) {
            return NextResponse.json(
                { success: false, error: 'This promo code has reached its maximum usage limit.' },
                { status: 400 }
            )
        }

        // 6. Calculate Discount
        let discountAmount = 0
        if (promo.discount_type === 'percentage') {
            discountAmount = (amount * promo.discount_value) / 100
        } else if (promo.discount_type === 'fixed_amount') {
            discountAmount = promo.discount_value
        }

        // Cap discount at total amount
        if (discountAmount > amount) {
            discountAmount = amount
        }

        return NextResponse.json({
            success: true,
            promoId: promo.id,
            discountAmount: Math.round(discountAmount * 100) / 100, // Round to 2 decimal places
            finalAmount: Math.max(0, amount - discountAmount),
            code: promo.code
        })

    } catch (error: any) {
        console.error('Error validating ticket promo code:', error)
        return NextResponse.json(
            { success: false, error: 'Internal Server Error' },
            { status: 500 }
        )
    }
}
