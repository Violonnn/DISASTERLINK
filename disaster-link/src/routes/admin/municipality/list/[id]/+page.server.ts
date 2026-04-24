import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	createMdrrmoInvitation,
	listMdrrmoInvitationsByMunicipality,
	revokeMdrrmoInvitation
} from '$lib/server/lgu-access-links';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';

type RoleBucketKey = 'mdrrmo_admin' | 'mayor' | 'mdrrmo_staff' | 'bdrrmo' | 'resident';

function resolveRoleBucket(role: string | null): RoleBucketKey {
	const normalized = (role ?? '').toLowerCase();
	if (normalized === 'mayor') return 'mayor';
	if (normalized === 'municipal_responder' || normalized === 'mdrrmo_admin') return 'mdrrmo_admin';
	if (normalized === 'mdrrmo_staff') return 'mdrrmo_staff';
	if (normalized === 'barangay_responder' || normalized === 'lgu_responder' || normalized === 'bdrrmo')
		return 'bdrrmo';
	return 'resident';
}

function resolveDisplayRole(role: string | null): string {
	const normalized = (role ?? '').toLowerCase();
	if (normalized === 'mayor') return 'Mayor';
	if (normalized === 'municipal_responder' || normalized === 'mdrrmo_admin') return 'MDRRMO Admin';
	if (normalized === 'mdrrmo_staff') return 'MDRMMO Staff';
	if (normalized === 'barangay_responder' || normalized === 'lgu_responder' || normalized === 'bdrrmo')
		return 'BDRMMO';
	if (normalized === 'resident') return 'Resident';
	return role?.replaceAll('_', ' ') ?? 'Resident';
}

function maskEmail(email: string | null): string {
	if (!email || !email.includes('@')) return 'N/A';
	const [local, domain] = email.split('@');
	if (!local || !domain) return 'N/A';
	const safeLocal =
		local.length <= 2
			? `${local[0] ?? '*'}*`
			: `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}`;
	return `${safeLocal}@${domain}`;
}

function maskPhone(phone: string | null): string {
	if (!phone) return 'N/A';
	const digits = phone.replace(/\D/g, '');
	if (digits.length < 4) return '*'.repeat(Math.max(digits.length, 1));
	const visibleTail = digits.slice(-4);
	return `${'*'.repeat(Math.max(digits.length - 4, 4))}${visibleTail}`;
}

function getResidentStatus(emailConfirmedAt: string | null): string {
	return emailConfirmedAt ? 'Verified' : 'Pending Verification';
}

const LGU_ROLE_PRIORITY: Record<RoleBucketKey, number> = {
	mdrrmo_admin: 0,
	mayor: 1,
	mdrrmo_staff: 2,
	bdrrmo: 3,
	resident: 4
};

const MUNICIPALITY_PAGE_DEPENDS = 'admin-municipality-detail';
const PROFILE_IN_CHUNK = 120;

function isRetriableSupabaseError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const e = err as { message?: string; code?: string; details?: string };
	const m = String(e.message ?? e.details ?? '').toLowerCase();
	if (
		m.includes('fetch') ||
		m.includes('network') ||
		m.includes('timeout') ||
		m.includes('econnreset') ||
		m.includes('socket')
	) {
		return true;
	}
	const c = String(e.code ?? '');
	return c === 'PGRST301' || c === '503' || c === '502';
}

async function supabaseQueryWithRetry<T>(
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

type ProfileRow = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string | null;
	phone: string | null;
	role: string | null;
	municipality_id: string | null;
	barangay_id: string | null;
	created_at: string | null;
};

// This fetches all direct municipality profiles with retry support for transient Supabase failures.
async function fetchProfilesByMunicipalityId(
	supabaseAdmin: SupabaseClient,
	municipalityId: string
): Promise<{ data: ProfileRow[]; error: unknown }> {
	const { data, error } = await supabaseAdmin
		.from('profiles')
		.select('id, first_name, last_name, email, phone, role, municipality_id, barangay_id, created_at')
		.eq('municipality_id', municipalityId)
		.order('last_name');

	return {
		data: (data ?? []) as ProfileRow[],
		error
	};
}

async function fetchResidentsByBarangayIds(
	supabaseAdmin: SupabaseClient,
	barangayIds: string[]
): Promise<{ data: ProfileRow[]; error: unknown }> {
	if (barangayIds.length === 0) return { data: [], error: null };
	const merged: ProfileRow[] = [];
	for (let i = 0; i < barangayIds.length; i += PROFILE_IN_CHUNK) {
		const chunk = barangayIds.slice(i, i + PROFILE_IN_CHUNK);
		const { data, error } = await supabaseAdmin
			.from('profiles')
			.select('id, first_name, last_name, email, phone, role, municipality_id, barangay_id, created_at')
			.eq('role', 'resident')
			.in('barangay_id', chunk)
			.order('last_name');
		if (error) return { data: [], error };
		if (data?.length) merged.push(...(data as ProfileRow[]));
	}
	merged.sort((a, b) => {
		const ln = String(a.last_name ?? '').localeCompare(String(b.last_name ?? ''));
		if (ln !== 0) return ln;
		return String(a.first_name ?? '').localeCompare(String(b.first_name ?? ''));
	});
	return { data: merged, error: null };
}

async function fetchBarangayRowsByIds(
	supabaseAdmin: SupabaseClient,
	barangayIds: string[]
): Promise<{ data: { id: string; name: string | null }[]; error: unknown }> {
	if (barangayIds.length === 0) return { data: [], error: null };
	const merged: { id: string; name: string | null }[] = [];
	for (let i = 0; i < barangayIds.length; i += PROFILE_IN_CHUNK) {
		const chunk = barangayIds.slice(i, i + PROFILE_IN_CHUNK);
		const { data, error } = await supabaseAdmin.from('barangays').select('id, name').in('id', chunk);
		if (error) return { data: [], error };
		if (data?.length) merged.push(...data);
	}
	return { data: merged, error: null };
}

export const load: PageServerLoad = async ({ cookies, params, url, depends }) => {
	if (
		cookies.get('admin_gate_passed') !== 'true' ||
		cookies.get('admin_authenticated') !== 'true'
	) {
		throw redirect(303, '/admin');
	}

	const municipalityId = params.id;
	depends(`${MUNICIPALITY_PAGE_DEPENDS}:${municipalityId}`);
	const supabaseAdmin = getSupabaseAdmin();
	const { data: municipality, error: municipalityError } = await supabaseAdmin
		.from('municipalities')
		.select('id, name')
		.eq('id', municipalityId)
		.single();

	if (municipalityError || !municipality) {
		throw error(404, 'Municipality not found.');
	}

	// This loads municipality accounts with retry so brief network/db hiccups do not cause immediate 500 errors.
	const { data: profiles, error: profilesError } = await supabaseQueryWithRetry(() =>
		fetchProfilesByMunicipalityId(supabaseAdmin, municipality.id)
	);

	if (profilesError) {
		console.error('[admin municipality load] municipality profiles', profilesError);
		throw error(500, 'Unable to load municipality accounts.');
	}

	const { data: municipalityBarangays, error: municipalityBarangaysError } = await supabaseQueryWithRetry(
		() =>
			supabaseAdmin.from('barangays').select('id').eq('municipality_id', municipality.id)
	);
	if (municipalityBarangaysError) {
		console.error('[admin municipality load] municipality barangays', municipalityBarangaysError);
		throw error(500, 'Unable to load municipality barangays.');
	}

	const municipalityBarangayIds = (municipalityBarangays ?? []).map((row) => row.id);
	let residentProfilesByBarangay: typeof profiles = [];
	if (municipalityBarangayIds.length > 0) {
		const { data: residentRows, error: residentRowsError } = await supabaseQueryWithRetry(() =>
			fetchResidentsByBarangayIds(supabaseAdmin, municipalityBarangayIds)
		);
		if (residentRowsError) {
			console.error('[admin municipality load] residents by barangay', residentRowsError);
			throw error(500, 'Unable to load resident accounts by barangay.');
		}
		residentProfilesByBarangay = (residentRows ?? []) as typeof profiles;
	}

	const profileById = new Map<string, (typeof profiles)[number]>();
	for (const profile of profiles ?? []) {
		profileById.set(profile.id, profile);
	}
	for (const resident of residentProfilesByBarangay ?? []) {
		profileById.set(resident.id, resident);
	}
	const allProfiles = Array.from(profileById.values());

	const barangayIds = Array.from(
		new Set(
			allProfiles
				.map((profile) => profile.barangay_id)
				.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
		)
	);

	const barangayNameById = new Map<string, string>();
	if (barangayIds.length > 0) {
		const { data: barangays, error: barangaysError } = await supabaseQueryWithRetry(() =>
			fetchBarangayRowsByIds(supabaseAdmin, barangayIds)
		);
		if (barangaysError) {
			console.error('[admin municipality load] barangay names', barangaysError);
			throw error(500, 'Unable to load barangay details for residents.');
		}
		for (const barangay of barangays ?? []) {
			barangayNameById.set(barangay.id, barangay.name ?? 'N/A');
		}
	}

	const invitationRows = await listMdrrmoInvitationsByMunicipality(municipality.id);
	const residents = allProfiles.filter((profile) => resolveRoleBucket(profile.role) === 'resident');
	const lgus = allProfiles.filter((profile) => resolveRoleBucket(profile.role) !== 'resident');

	const residentStatusById = new Map<string, string>();
	const AUTH_STATUS_CHUNK = 5;
	for (let i = 0; i < residents.length; i += AUTH_STATUS_CHUNK) {
		const slice = residents.slice(i, i + AUTH_STATUS_CHUNK);
		await Promise.all(
			slice.map(async (resident) => {
				try {
					const authResult = await supabaseAdmin.auth.admin.getUserById(resident.id);
					if (authResult.error) {
						residentStatusById.set(resident.id, 'Unknown');
						return;
					}
					const emailConfirmedAt = authResult.data.user?.email_confirmed_at ?? null;
					residentStatusById.set(resident.id, getResidentStatus(emailConfirmedAt));
				} catch (authErr) {
					console.error('[admin municipality load] getUserById', resident.id, authErr);
					residentStatusById.set(resident.id, 'Unknown');
				}
			})
		);
	}

	const lguAccounts = lgus
		.map((profile) => ({
			id: profile.id,
			roleBucket: resolveRoleBucket(profile.role),
			displayRole: resolveDisplayRole(profile.role),
			fullName: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'No name',
			email: profile.email ?? 'No email',
			phone: profile.phone ?? 'N/A',
			createdAt: profile.created_at ?? ''
		}))
		.sort((a, b) => {
			const roleDelta = LGU_ROLE_PRIORITY[a.roleBucket] - LGU_ROLE_PRIORITY[b.roleBucket];
			if (roleDelta !== 0) return roleDelta;
			return a.fullName.localeCompare(b.fullName);
		});

	const residentAccounts = residents
		.map((profile) => ({
			id: profile.id,
			accountId: profile.id,
			maskedEmail: maskEmail(profile.email ?? null),
			maskedPhone: maskPhone(profile.phone ?? null),
			email: profile.email ?? '',
			phone: profile.phone ?? '',
			barangayName: barangayNameById.get(profile.barangay_id ?? '') ?? 'N/A',
			status: residentStatusById.get(profile.id) ?? 'Unknown',
			createdAt: profile.created_at ?? ''
		}))
		.sort((a, b) => a.accountId.localeCompare(b.accountId));

	const municipalityDisplayName = toDisplayMunicipalityName(municipality.name ?? '');

	return {
		pageTitle: `The Municipality of ${municipalityDisplayName}`,
		pageDescription: '',
		municipalityId: municipality.id,
		municipalityName: municipalityDisplayName,
		generatedInviteUrl: url.searchParams.get('invite') ?? '',
		lguAccounts,
		residentAccounts,
		mdrrmoInvitations: invitationRows.map((item) => ({
			id: item.id,
			url: `${url.origin}/invite/mdrrmo/${item.token}`,
			expiresAt: item.expiresAt,
			isRevoked: item.isRevoked,
			createdAt: item.createdAt
		}))
	};
};

export const actions: Actions = {
	createMdrrmoInviteLink: async ({ cookies, params, url }) => {
		if (
			cookies.get('admin_gate_passed') !== 'true' ||
			cookies.get('admin_authenticated') !== 'true'
		) {
			throw redirect(303, '/admin');
		}

		const municipalityId = params.id;
		const supabaseAdmin = getSupabaseAdmin();
		const { data: municipality, error: municipalityError } = await supabaseAdmin
			.from('municipalities')
			.select('id, name')
			.eq('id', municipalityId)
			.single();

		if (municipalityError || !municipality) {
			return fail(400, { error: 'Selected municipality does not exist.' });
		}

		try {
			const invitation = await createMdrrmoInvitation({
				municipalityId: municipality.id,
				municipalityName: toDisplayMunicipalityName(municipality.name ?? ''),
				role: 'mdrrmo_admin',
				validityHours: 24
			});
			const inviteUrl = `${url.origin}/invite/mdrrmo/${invitation.token}`;
			// Return JSON so the client can update without a full redirect (avoids modal flicker and URL jumps).
			return { createInviteOk: true as const, inviteUrl };
		} catch (caught) {
			return fail(400, {
				error: caught instanceof Error ? caught.message : 'Unable to generate invitation link.'
			});
		}
	},
	revokeMdrrmoInviteLink: async ({ request, cookies, params }) => {
		if (
			cookies.get('admin_gate_passed') !== 'true' ||
			cookies.get('admin_authenticated') !== 'true'
		) {
			throw redirect(303, '/admin');
		}

		const formData = await request.formData();
		const invitationId = String(formData.get('invitationId') ?? '').trim();
		if (!invitationId) {
			return fail(400, { error: 'Invitation id is required.' });
		}

		try {
			await revokeMdrrmoInvitation(invitationId);
			return { revokeOk: true as const };
		} catch (caught) {
			return fail(400, {
				error: caught instanceof Error ? caught.message : 'Unable to revoke invitation.'
			});
		}
	}
};
