import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function debugQuery() {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, booking_items(*, ticket_tiers(*)), events(*, locations(*))')
    .eq('id', '1a4a6469-2ef5-4055-9714-a3008bef7218')
    .maybeSingle();

  if (error) {
    console.log('Error Code:', error.code);
    console.log('Error Message:', error.message);
    console.log('Error Hint:', error.hint);
    console.log('Error Details:', error.details);
  } else {
    console.log('Query successful');
    console.log(JSON.stringify(data[0], null, 2));
  }
}

debugQuery();
