import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { listLguAccessLinks } from '$lib/server/lgu-access-links';

function isRetriableSupabaseError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const e = err as { message?: string; code?: string; details?: string };
	const message = String(e.message ?? e.details ?? '').toLowerCase();
	if (
		message.includes('fetch') ||
		message.includes('network') ||
		message.includes('timeout') ||
		message.includes('econnreset') ||
		message.includes('socket')
	) {
		return true;
	}
	const code = String(e.code ?? '');
	return code === 'PGRST301' || code === '503' || code === '502';
}

async function queryWithRetry<T>(
	execute: () => Promise<{ data: T | null; error: unknown }>
): Promise<{ data: T | null; error: unknown }> {
	let last = await execute();
	if (!last.error) return last;
	for (let attempt = 0; attempt < 3 && isRetriableSupabaseError(last.error); attempt++) {
		await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
		last = await execute();
		if (!last.error) return last;
	}
	return last;
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	// This route is restricted to authenticated admin sessions.
	if (
		cookies.get('admin_gate_passed') !== 'true' ||
		cookies.get('admin_authenticated') !== 'true'
	) {
		throw redirect(303, '/admin');
	}

	const supabaseAdmin = getSupabaseAdmin();
	const urlManagedMunicipalities = await listLguAccessLinks();

	const { data: profiles, error: profilesError } = await queryWithRetry(() =>
		supabaseAdmin.from('profiles').select('id')
	);

	const { data: reports, error: reportsError } = await queryWithRetry(() =>
		supabaseAdmin.from('reports').select('id, barangay_id')
	);
	if (reportsError) {
		throw error(500, 'Unable to load reports.');
	}

	let verifiedUsers = 0;
	let pendingUsers = 0;
	let totalUsers = (profiles ?? []).length;

	if (profilesError) {
		console.error('[admin dashboard load] profiles query failed', profilesError);
		// Fallback to auth users so dashboard remains accessible.
		const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
			page: 1,
			perPage: 1000
		});
		if (usersError) {
			throw error(500, 'Unable to load user profiles.');
		}
		const users = usersPage?.users ?? [];
		totalUsers = users.length;
		for (const user of users) {
			if (user.email_confirmed_at) verifiedUsers += 1;
			else pendingUsers += 1;
		}
	} else {
		const AUTH_CHUNK = 8;
		for (let i = 0; i < (profiles ?? []).length; i += AUTH_CHUNK) {
			const slice = (profiles ?? []).slice(i, i + AUTH_CHUNK);
			await Promise.all(
				slice.map(async (profile) => {
					try {
						const authUserResult = await supabaseAdmin.auth.admin.getUserById(profile.id);
						if (authUserResult.error) {
							pendingUsers += 1;
							return;
						}
						const isVerified = !!authUserResult.data.user?.email_confirmed_at;
						if (isVerified) verifiedUsers += 1;
						else pendingUsers += 1;
					} catch (caught) {
						console.error('[admin dashboard load] getUserById failed', profile.id, caught);
						pendingUsers += 1;
					}
				})
			);
		}
	}

	return {
		pageTitle: 'Admin Dashboard',
		pageDescription: 'Monitor users, municipalities, and reports in one place.',
		dashboardSummary: {
			totalUsers,
			verifiedUsers,
			pendingUsers,
			totalMunicipalities: urlManagedMunicipalities.length,
			totalReports: (reports ?? []).length
		}
	};
};

export const actions: Actions = {
	logoutAdmin: async ({ cookies }) => {
		// This clears the admin session and returns to the admin login screen.
		cookies.delete('admin_authenticated', { path: '/' });
		cookies.delete('admin_gate_passed', { path: '/' });
		throw redirect(303, '/admin');
	}
};
