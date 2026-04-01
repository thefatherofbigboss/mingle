import Razorpay from 'razorpay';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

console.log('Testing Razorpay connectivity...');
console.log('Key ID:', key_id ? 'PROVIDED' : 'MISSING');
console.log('Key Secret:', key_secret ? 'PROVIDED' : 'MISSING');

if (!key_id || !key_secret) {
    console.error('Missing Razorpay credentials in .env.local');
    process.exit(1);
}

const razorpay = new Razorpay({
    key_id,
    key_secret,
});

async function test() {
    try {
        // Try to fetch orders to verify authentication
        const orders = await razorpay.orders.all({ count: 1 });
        console.log('SUCCESS: Razorpay authentication verified.');
        console.log('Latest orders count:', orders.items.length);
    } catch (error: unknown) {
        console.error('FAILURE: Razorpay authentication failed.');
        const errorDetails = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
        console.error('Error Details:', errorDetails);
        process.exit(1);
    }
}

test();
