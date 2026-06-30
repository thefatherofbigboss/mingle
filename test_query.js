require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log("Testing Supabase Query...");
    try {
        const { data: users, error: uErr } = await supabase.from('users').select('id, email, phone').order('created_at', { ascending: false }).limit(10);
        if (uErr) {
            console.error("User fetch error:", uErr);
            return;
        }
        console.log("Users:", JSON.stringify(users, null, 2));
        
        for (const user of users) {
            let query = supabase.from('bookings').select('id');
            const orConditions = [`user_id.eq.${user.id}`];
            if (user.email) orConditions.push(`attendee_email.eq.${user.email}`);
            
            if (user.phone) {
                const normalizedPhone = user.phone.replace(/\D/g, '');
                if (normalizedPhone.length >= 10) {
                    const last10 = normalizedPhone.slice(-10);
                    orConditions.push(`attendee_phone.like.*${last10}*`);
                } else {
                    orConditions.push(`attendee_phone.eq.${user.phone}`);
                }
            }
            
            console.log(`User ${user.id} OR condition:`, orConditions.join(','));
            const { data, error } = await query.or(orConditions.join(','));
            if (error) {
                console.error(`Query ERROR for user ${user.id}:`, error);
            } else {
                console.log(`Query SUCCESS for user ${user.id}, found ${data.length} bookings.`);
            }
        }
    } catch (e) {
        console.error("Exception:", e);
    }
}
test();
