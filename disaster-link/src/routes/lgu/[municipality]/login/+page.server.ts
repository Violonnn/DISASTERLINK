import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getLguAccessLinkBySlug } from '$lib/server/lgu-access-links';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';

function getCookieKey(slug: string): string {
	return `lgu_gate_${slug}`;
}

export const load: PageServerLoad = async ({ params, cookies }) => {
	const municipalitySlug = params.municipality;
	const lguRecord = await getLguAccessLinkBySlug(municipalitySlug);
	if (!lguRecord) {
		throw redirect(303, '/');
	}

	// This enforces password gate completion before showing municipality-scoped login.
	const hasGateAccess = cookies.get(getCookieKey(municipalitySlug)) === 'true';
	if (!hasGateAccess) {
		throw redirect(303, `/lgu/${municipalitySlug}`);
	}

	// This resolves all municipality ids that match the slug's municipality name.
	const supabaseAdmin = getSupabaseAdmin();
	const displayName = toDisplayMunicipalityName(lguRecord.municipalityName);
	const { data: municipalityRows } = await supabaseAdmin
		.from('municipalities')
		.select('id, name')
		.ilike('name', displayName)
		.limit(20);

	return {
		municipalitySlug,
		municipalityName: displayName,
		allowedMunicipalityIds: (municipalityRows ?? []).map((row) => row.id)
	};
};
