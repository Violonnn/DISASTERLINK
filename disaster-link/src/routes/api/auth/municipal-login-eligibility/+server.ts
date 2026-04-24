import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLguAccessLinkBySlug } from '$lib/server/lgu-access-links';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';

type EligibilityResponse = {
	eligible: boolean;
	reason: 'ok' | 'invalid_email' | 'no_account' | 'wrong_municipality';
};

const LGU_ROLE_SET = new Set([
	'bdrrmo',
	'barangay_responder',
	'lgu_responder',
	'mdrrmo_admin',
	'mdrrmo_staff',
	'mayor',
	'municipal_responder'
]);

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as { email?: string; municipalitySlug?: string };
	const email = String(payload.email ?? '').trim().toLowerCase();
	const municipalitySlug = String(payload.municipalitySlug ?? '').trim();

	if (!email || !municipalitySlug || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json<EligibilityResponse>({ eligible: false, reason: 'invalid_email' }, { status: 200 });
	}

	const lguRecord = await getLguAccessLinkBySlug(municipalitySlug);
	if (!lguRecord) {
		return json<EligibilityResponse>({ eligible: false, reason: 'wrong_municipality' }, { status: 200 });
	}

	const supabaseAdmin = getSupabaseAdmin();
	const municipalityName = toDisplayMunicipalityName(lguRecord.municipalityName);

	const [{ data: profile }, { data: municipalityRows }] = await Promise.all([
		supabaseAdmin
			.from('profiles')
			.select('role, municipality_id')
			.ilike('email', email)
			.maybeSingle(),
		supabaseAdmin.from('municipalities').select('id').ilike('name', municipalityName).limit(20)
	]);

	if (!profile) {
		return json<EligibilityResponse>({ eligible: false, reason: 'no_account' }, { status: 200 });
	}

	const role = String(profile.role ?? '').toLowerCase();
	if (!LGU_ROLE_SET.has(role)) {
		return json<EligibilityResponse>({ eligible: false, reason: 'no_account' }, { status: 200 });
	}

	const allowedMunicipalityIds = new Set((municipalityRows ?? []).map((row) => row.id));
	if (!allowedMunicipalityIds.has(String(profile.municipality_id ?? ''))) {
		return json<EligibilityResponse>({ eligible: false, reason: 'wrong_municipality' }, { status: 200 });
	}

	return json<EligibilityResponse>({ eligible: true, reason: 'ok' }, { status: 200 });
};
