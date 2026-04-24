import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	buildLguUrl,
	createLguAccessLink,
	importLegacyLguLinksToDatabase,
	listLguAccessLinks
} from '$lib/server/lgu-access-links';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';

async function ensureMunicipalityExists(municipalityName: string): Promise<void> {
	const normalizedMunicipalityName = toDisplayMunicipalityName(municipalityName);
	const supabaseAdmin = getSupabaseAdmin();

	// This checks case-insensitively and avoids single-row assumptions when legacy duplicates exist.
	const { data: existingMunicipalities, error: existingError } = await supabaseAdmin
		.from('municipalities')
		.select('id, name')
		.ilike('name', normalizedMunicipalityName)
		.limit(10);
	if (existingError) {
		throw new Error('Unable to validate municipality existence.');
	}

	if ((existingMunicipalities?.length ?? 0) > 0) {
		// Any case-insensitive match means the municipality record is already present.
		return;
	}

	const { error: insertError } = await supabaseAdmin
		.from('municipalities')
		.insert({ name: normalizedMunicipalityName });
	if (insertError) {
		// This handles concurrent inserts: if another request inserted first, treat as success.
		const { data: afterInsertCheck, error: afterInsertError } = await supabaseAdmin
			.from('municipalities')
			.select('id')
			.ilike('name', normalizedMunicipalityName)
			.limit(1);
		if (afterInsertError || (afterInsertCheck?.length ?? 0) === 0) {
			throw new Error('Unable to create municipality record.');
		}
	}
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (
		cookies.get('admin_gate_passed') !== 'true' ||
		cookies.get('admin_authenticated') !== 'true'
	) {
		throw redirect(303, '/admin');
	}

	const links = await listLguAccessLinks();

	return {
		pageTitle: 'Create Municipal URL',
		pageDescription: 'Create a password-protected municipality URL for LGU access.',
		createdMunicipalityUrls: links.map((item) => ({
			id: item.id,
			municipalityName: item.municipalityName,
			url: buildLguUrl(url.origin, item.slug),
			createdAt: item.createdAt
		}))
	};
};

export const actions: Actions = {
	createMunicipalityUrl: async ({ request, cookies, url }) => {
		if (
			cookies.get('admin_gate_passed') !== 'true' ||
			cookies.get('admin_authenticated') !== 'true'
		) {
			throw redirect(303, '/admin');
		}

		const formData = await request.formData();
		const municipalityName = String(formData.get('municipalityName') ?? '').trim();
		const password = String(formData.get('password') ?? '');

		try {
			const created = await createLguAccessLink({ municipalityName, password });

			// This keeps the municipality table in sync without blocking URL creation on DB-side schema issues.
			try {
				await ensureMunicipalityExists(created.municipalityName);
			} catch (syncError) {
				console.error('Municipality sync warning (createMunicipalityUrl):', syncError);
			}

			return {
				success: `Created LGU URL for ${created.municipalityName}.`,
				createdUrl: buildLguUrl(url.origin, created.slug),
				municipalityName: ''
			};
		} catch (caught) {
			return fail(400, {
				error: caught instanceof Error ? caught.message : 'Unable to create municipality URL.',
				municipalityName
			});
		}
	},
	importLegacyMunicipalityUrls: async ({ cookies }) => {
		if (
			cookies.get('admin_gate_passed') !== 'true' ||
			cookies.get('admin_authenticated') !== 'true'
		) {
			throw redirect(303, '/admin');
		}

		try {
			const report = await importLegacyLguLinksToDatabase();
			return {
				migrateSuccess:
					`Legacy import completed. Found ${report.foundLegacyItems} JSON row(s), ` +
					`valid ${report.validLegacyRows}, inserted ${report.newlyInserted}, updated ${report.updatedExisting}.`
			};
		} catch (caught) {
			return fail(400, {
				migrateError:
					caught instanceof Error
						? caught.message
						: 'Unable to import legacy municipality URLs into database.'
			});
		}
	},
	logoutAdmin: async ({ cookies }) => {
		cookies.delete('admin_authenticated', { path: '/' });
		cookies.delete('admin_gate_passed', { path: '/' });
		throw redirect(303, '/admin');
	}
};
