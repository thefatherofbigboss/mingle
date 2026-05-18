import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { razorpay } from '@/lib/razorpay';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const secret = searchParams.get('secret');
        
        // Security check: Only allow sync if secret matches Razorpay Key Secret
        const expectedSecret = process.env.RAZORPAY_KEY_SECRET;
        if (!expectedSecret || secret !== expectedSecret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        console.log('🔄 STARTING SUBSCRIPTION SYNC & SELF-HEALING ROUTE');
        const supabase = createAdminClient();
        
        // Fetch all subscriptions from the database
        const { data: dbSubscriptions, error: dbError } = await supabase
            .from('user_subscriptions')
            .select('*');
            
        if (dbError) {
            console.error('❌ Failed to fetch subscriptions:', dbError);
            return NextResponse.json({ error: 'Database error', details: dbError.message }, { status: 500 });
        }
        
        if (!dbSubscriptions || dbSubscriptions.length === 0) {
            return NextResponse.json({ message: 'No subscriptions found in DB' });
        }
        
        let processedCount = 0;
        let mismatchCount = 0;
        let fixedCount = 0;
        const report: any[] = [];
        
        for (const dbSub of dbSubscriptions) {
            const subId = dbSub.razorpay_subscription_id;
            if (!subId) continue;
            
            processedCount++;
            
            // Add a small 250ms delay between requests to respect Razorpay API rate limits
            await new Promise(resolve => setTimeout(resolve, 250));
            
            try {
                // Fetch status from Razorpay
                const rzpSub = await razorpay.subscriptions.fetch(subId);
                
                const dbStatus = dbSub.status;
                const rzpStatus = rzpSub.status;
                
                const dbCancelAtEnd = !!dbSub.cancel_at_period_end;
                const rzpCancelAtEnd = !!(rzpSub as any).cancel_at_cycle_end;
                
                const dbExpiry = dbSub.current_period_end ? new Date(dbSub.current_period_end).getTime() : null;
                const rzpExpiry = rzpSub.current_end ? rzpSub.current_end * 1000 : null;
                
                const statusMismatch = dbStatus !== rzpStatus;
                const cancelMismatch = dbCancelAtEnd !== rzpCancelAtEnd;
                let expiryMismatch = false;
                
                if (rzpExpiry && dbExpiry) {
                    expiryMismatch = Math.abs(dbExpiry - rzpExpiry) > 5000;
                } else if (rzpExpiry !== dbExpiry) {
                    expiryMismatch = true;
                }
                
                const hasMismatch = statusMismatch || cancelMismatch || expiryMismatch;
                
                if (hasMismatch) {
                    mismatchCount++;
                    
                    const updatePayload: any = {
                        updated_at: new Date().toISOString()
                    };
                    
                    if (statusMismatch) updatePayload.status = rzpStatus;
                    if (cancelMismatch) {
                        updatePayload.cancel_at_period_end = rzpCancelAtEnd;
                        if (rzpCancelAtEnd && !dbSub.cancel_reason) {
                            updatePayload.cancel_reason = 'Cancelled via subscription management sync';
                        }
                    }
                    if (expiryMismatch && rzpExpiry) {
                        updatePayload.current_period_end = new Date(rzpExpiry).toISOString();
                    }
                    
                    // Update main table
                    const { error: updateError } = await supabase
                        .from('user_subscriptions')
                        .update(updatePayload)
                        .eq('id', dbSub.id);
                        
                    if (!updateError) {
                        fixedCount++;
                        
                        // Also update legacy subscriptions table
                        try {
                            await supabase
                                .from('subscriptions')
                                .update({
                                    status: rzpStatus,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('razorpay_subscription_id', subId);
                        } catch (_e) {}
                    }
                    
                    report.push({
                        name: dbSub.customer_name || 'N/A',
                        email: dbSub.customer_email || 'N/A',
                        id: subId,
                        mismatches: [
                            statusMismatch ? `Status (${dbStatus} ➔ ${rzpStatus})` : null,
                            cancelMismatch ? `CancelAtEnd (${dbCancelAtEnd} ➔ ${rzpCancelAtEnd})` : null,
                            expiryMismatch ? 'Expiry Synced' : null
                        ].filter(Boolean).join(', '),
                        repaired: 'YES'
                    });
                } else {
                    report.push({
                        name: dbSub.customer_name || 'N/A',
                        email: dbSub.customer_email || 'N/A',
                        id: subId,
                        mismatches: 'None',
                        repaired: 'NO'
                    });
                }
            } catch (err: any) {
                console.error(`Error verifying ${subId}:`, err);
                const errorMessage = err.description || err.error?.description || err.message || JSON.stringify(err);
                report.push({
                    name: dbSub.customer_name || 'N/A',
                    email: dbSub.customer_email || 'N/A',
                    id: subId,
                    mismatches: `ERROR: ${errorMessage}`,
                    repaired: 'NO'
                });
            }
        }
        
        return NextResponse.json({
            success: true,
            summary: {
                total_in_db: dbSubscriptions.length,
                processed: processedCount,
                mismatches_found: mismatchCount,
                repaired: fixedCount
            },
            details: report
        });
        
    } catch (error: any) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
    }
}
