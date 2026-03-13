import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * Server-only Supabase admin client.
 * Uses the service role key so it can create users with email_confirm: true.
 * Lazy init so missing key returns a clear error from the action instead of crashing.
 *
 * NEVER expose this client or the service role key to the browser.
 */
export function getSupabaseAdmin(): SupabaseClient {
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey || serviceRoleKey === 'your_service_role_key_here') {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set or still placeholder. Add it in .env and restart the dev server.');
    }
    return createClient(PUBLIC_SUPABASE_URL, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}
