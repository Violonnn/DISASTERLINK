import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';

type LoginScopeResponse = {
	isResidentEmail: boolean;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as { email?: string };
	const email = String(payload.email ?? '').trim().toLowerCase();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json<LoginScopeResponse>({ isResidentEmail: false }, { status: 200 });
	}

	// This checks role scope using the server-side admin client so resident login can block LGU emails.
	const supabaseAdmin = getSupabaseAdmin();
	const { data: profile } = await supabaseAdmin
		.from('profiles')
		.select('role')
		.ilike('email', email)
		.maybeSingle();

	return json<LoginScopeResponse>({
		isResidentEmail: String(profile?.role ?? '').toLowerCase() === 'resident'
	});
};
