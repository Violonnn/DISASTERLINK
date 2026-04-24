import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Actions } from './$types';

const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export const actions: Actions = {
    default: async ({ request, url }) => {
        const form = await request.formData();

        const firstName = (form.get('firstName') as string | null)?.trim() ?? '';
        const lastName = (form.get('lastName') as string | null)?.trim() ?? '';
        const email = (form.get('email') as string | null)?.trim() ?? '';
        const phone = (form.get('phone') as string | null)?.trim() ?? '';
        const password = (form.get('password') as string | null) ?? '';
        const privacyConsent = (form.get('privacyConsent') as string | null) ?? '';

        // Basic server-side validation
        if (!firstName || !lastName || !email || !phone || !password) {
            return fail(400, { error: 'All fields are required.' });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return fail(400, { error: 'Enter a valid email address.' });
        }

        if (!/^(09\d{9}|\+639\d{9})$/.test(phone.replace(/[\s-]/g, ''))) {
            return fail(400, { error: 'Enter a valid PH number (09XXXXXXXXX).' });
        }

        if (password.length < 6) {
            return fail(400, { error: 'Password must be at least 6 characters.' });
        }

        if (privacyConsent !== 'yes') {
            return fail(400, { error: 'You must agree to the Privacy Notice before registering.' });
        }

        // Check phone uniqueness via RPC. If the RPC is missing we show a clear setup error,
        // otherwise we treat unexpected RPC failures as "not taken" so they don't block signup.
        let phoneTaken = false;
        const { data: phoneResult, error: phoneError } = await supabase
            .rpc('is_phone_taken', { check_phone: phone });

        if (phoneError) {
            const msg = (phoneError.message ?? '').toLowerCase();
            if (msg.includes('does not exist') || msg.includes('could not find')) {
                return fail(500, {
                    error: 'Phone check is not set up. Run the Supabase migration that defines public.is_phone_taken(check_phone text), then try again.'
                });
            }
            console.error('is_phone_taken RPC error:', phoneError);
        } else if (typeof phoneResult === 'boolean') {
            phoneTaken = phoneResult;
        }

        if (phoneTaken) {
            return fail(400, { error: 'This phone number is already registered.' });
        }

        // Create the Supabase auth user; this will only run when validation and phone check pass
        const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    first_name: firstName,
                    last_name: lastName,
                    contact_phone: phone,
                    phone,
                    role: 'resident'
                },
                emailRedirectTo: `${url.origin}/login?confirmed=1`
            }
        });

        if (signUpError) {
            const msg = signUpError.message.toLowerCase();
            if (msg.includes('already registered') || msg.includes('already been registered')) {
                return fail(400, { error: 'This email is already registered. Please log in instead.' });
            }
            console.error('Resident signup auth error:', signUpError);
            return fail(500, { error: signUpError.message });
        }

        // Redirect to the verify-email page; this must not be caught as an error
        throw redirect(303, `/signup/verify-email?email=${encodeURIComponent(email)}`);
    }
};
