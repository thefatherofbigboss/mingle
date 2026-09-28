import { redis } from './src/lib/redis';

async function test() {
  try {
    console.log('Connecting to Redis...');
    await redis.set('test_key', 'it_works');
    const val = await redis.get('test_key');
    console.log('Redis response:', val);
    
    const keys = await redis.keys('online_member:*');
    console.log('Current online members in Redis:', keys);
    process.exit(0);
  } catch (err) {
    console.error('Redis error:', err);
    process.exit(1);
  }
}

test();
