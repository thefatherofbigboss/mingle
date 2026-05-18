import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local first
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    console.log('----------------------------------------------------');
    console.log('🔄 STARTING SUBSCRIPTION SYNC & SELF-HEALING TOOL');
    console.log('----------------------------------------------------');
    
    // Dynamically import clients to ensure environment variables are loaded
    const { razorpay } = await import('./razorpay');
    const { createAdminClient } = await import('./supabaseClient');
    
    const supabase = createAdminClient();
    
    // Fetch all user_subscriptions from the database
    console.log('📡 Fetching subscriptions from database...');
    const { data: dbSubscriptions, error: dbError } = await supabase
        .from('user_subscriptions')
        .select('*');
        
    if (dbError) {
        console.error('❌ Failed to fetch subscriptions from Supabase:', dbError);
        process.exit(1);
    }
    
    if (!dbSubscriptions || dbSubscriptions.length === 0) {
        console.log('ℹ️ No subscriptions found in the database.');
        return;
    }
    
    console.log(`📊 Found ${dbSubscriptions.length} subscriptions in DB. Checking each against Razorpay...`);
    
    let processedCount = 0;
    let mismatchCount = 0;
    let fixedCount = 0;
    const report: any[] = [];
    
    for (const dbSub of dbSubscriptions) {
        const subId = dbSub.razorpay_subscription_id;
        if (!subId) {
            console.log(`⚠️ Skipping record ${dbSub.id}: No razorpay_subscription_id`);
            continue;
        }
        
        processedCount++;
        console.log(`\n🔍 Checking [${processedCount}/${dbSubscriptions.length}] Sub ID: ${subId} (${dbSub.customer_name || 'No Name'})`);
        
        // Add a small 250ms delay between requests to respect Razorpay API rate limits
        await new Promise(resolve => setTimeout(resolve, 250));
        
        try {
            // Fetch the true state from Razorpay
            const rzpSub = await razorpay.subscriptions.fetch(subId);
            
            const dbStatus = dbSub.status;
            const rzpStatus = rzpSub.status; // active, cancelled, completed, expired, created, authenticated
            
            const dbCancelAtEnd = !!dbSub.cancel_at_period_end;
            const rzpCancelAtEnd = !!(rzpSub as any).cancel_at_cycle_end;
            
            const dbExpiry = dbSub.current_period_end ? new Date(dbSub.current_period_end).getTime() : null;
            const rzpExpiry = rzpSub.current_end ? rzpSub.current_end * 1000 : null;
            
            const statusMismatch = dbStatus !== rzpStatus;
            const cancelMismatch = dbCancelAtEnd !== rzpCancelAtEnd;
            let expiryMismatch = false;
            
            if (rzpExpiry && dbExpiry) {
                // Allow a small tolerance for comparison
                expiryMismatch = Math.abs(dbExpiry - rzpExpiry) > 5000;
            } else if (rzpExpiry !== dbExpiry) {
                expiryMismatch = true;
            }
            
            const hasMismatch = statusMismatch || cancelMismatch || expiryMismatch;
            
            if (hasMismatch) {
                mismatchCount++;
                console.log(`⚠️ Mismatch Detected for ${subId}:`);
                if (statusMismatch) console.log(`   - Status: DB='${dbStatus}', Razorpay='${rzpStatus}'`);
                if (cancelMismatch) console.log(`   - Cancel At Period End: DB=${dbCancelAtEnd}, Razorpay=${rzpCancelAtEnd}`);
                if (expiryMismatch) {
                    console.log(`   - Expiry: DB='${dbSub.current_period_end}', Razorpay='${rzpExpiry ? new Date(rzpExpiry).toISOString() : 'null'}'`);
                }
                
                // Construct the update object
                const updatePayload: any = {
                    updated_at: new Date().toISOString()
                };
                
                if (statusMismatch) {
                    updatePayload.status = rzpStatus;
                }
                
                if (cancelMismatch) {
                    updatePayload.cancel_at_period_end = rzpCancelAtEnd;
                    if (rzpCancelAtEnd && !dbSub.cancel_reason) {
                        updatePayload.cancel_reason = 'Cancelled via subscription management sync';
                    }
                }
                
                if (expiryMismatch && rzpExpiry) {
                    updatePayload.current_period_end = new Date(rzpExpiry).toISOString();
                }
                
                // Update Supabase Database
                console.log(`🛠️ Repairing database record...`);
                const { error: updateError } = await supabase
                    .from('user_subscriptions')
                    .update(updatePayload)
                    .eq('id', dbSub.id);
                    
                if (updateError) {
                    console.error(`❌ Failed to update record for ${subId}:`, updateError);
                } else {
                    fixedCount++;
                    console.log(`✅ Successfully updated database!`);
                    
                    // Also update legacy subscriptions table if needed
                    try {
                        const { error: legacyError } = await supabase
                            .from('subscriptions')
                            .update({
                                status: rzpStatus,
                                updated_at: new Date().toISOString()
                            })
                            .eq('razorpay_subscription_id', subId);
                            
                        if (legacyError) {
                            // Suppress error if subscriptions table has different structure or triggers
                            console.log(`ℹ️ Legacy subscriptions table update result: ${legacyError.message}`);
                        } else {
                            console.log(`✅ Successfully updated legacy subscriptions table!`);
                        }
                    } catch (_e) {
                        // Ignore
                    }
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
                console.log(`🟢 Synchronized: DB is in perfect sync with Razorpay.`);
                report.push({
                    name: dbSub.customer_name || 'N/A',
                    email: dbSub.customer_email || 'N/A',
                    id: subId,
                    mismatches: 'None',
                    repaired: 'NO'
                });
            }
            
        } catch (err: any) {
            const errorMessage = err.description || err.error?.description || err.message || JSON.stringify(err);
            console.error(`❌ Error verifying subscription ${subId} from Razorpay:`, errorMessage);
            report.push({
                name: dbSub.customer_name || 'N/A',
                email: dbSub.customer_email || 'N/A',
                id: subId,
                mismatches: `ERROR: ${errorMessage}`,
                repaired: 'NO'
            });
        }
    }
    
    console.log('\n----------------------------------------------------');
    console.log('📊 FINAL EXECUTION REPORT SUMMARY');
    console.log('----------------------------------------------------');
    console.log(`✅ Processed:   ${processedCount} subscriptions`);
    console.log(`⚠️ Mismatches:  ${mismatchCount} subscriptions`);
    console.log(`🛠️ Repaired:    ${fixedCount} subscriptions`);
    console.log('----------------------------------------------------');
    
    console.table(report);
}

main().catch(err => {
    console.error('Unhandled script error:', err);
});
