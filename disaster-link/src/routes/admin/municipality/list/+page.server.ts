import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { listLguAccessLinks } from '$lib/server/lgu-access-links';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';

function normalizeNameKey(value: string): string {
	return value.trim().toLowerCase();
}

type MunicipalitySortOption = 'alphabetical' | 'latest' | 'oldest';
type MunicipalityRow = { id: string; name: string; created_at: string | null };

function resolveSortOption(input: string | null): MunicipalitySortOption {
	if (input === 'latest' || input === 'oldest') return input;
	return 'alphabetical';
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (
		cookies.get('admin_gate_passed') !== 'true' ||
		cookies.get('admin_authenticated') !== 'true'
	) {
		throw redirect(303, '/admin');
	}

	const supabaseAdmin = getSupabaseAdmin();
	const urlManagedMunicipalities = await listLguAccessLinks();

	const { data: existingMunicipalities, error: existingMunicipalitiesError } = await supabaseAdmin
		.from('municipalities')
		.select('id, name, created_at');
	if (existingMunicipalitiesError) {
		console.error('Municipality list load error (existingMunicipalities):', existingMunicipalitiesError);
	}

	// This groups same-name municipality rows so we can select a stable canonical id for each name.
	const municipalityRowsByNameKey = new Map<string, MunicipalityRow[]>();
	for (const municipality of existingMunicipalities ?? []) {
		if (municipality.id && municipality.name) {
			const key = normalizeNameKey(municipality.name);
			const rows = municipalityRowsByNameKey.get(key) ?? [];
			rows.push({
				id: municipality.id,
				name: municipality.name,
				created_at: municipality.created_at ?? null
			});
			municipalityRowsByNameKey.set(key, rows);
		}
	}

	const missingMunicipalityNames = Array.from(
		new Set(
			urlManagedMunicipalities
				.map((item) => item.municipalityName)
				.filter((name) => !municipalityRowsByNameKey.has(normalizeNameKey(name)))
		)
	);

	if (missingMunicipalityNames.length > 0 || municipalityRowsByNameKey.size === 0) {
		const { error: insertMissingError } = await supabaseAdmin
			.from('municipalities')
			.insert(missingMunicipalityNames.map((name) => ({ name })));
		if (insertMissingError) {
			console.error('Municipality list load error (insertMissingMunicipalities):', insertMissingError);
		}

		const { data: refreshedMunicipalities, error: refreshedMunicipalitiesError } = await supabaseAdmin
			.from('municipalities')
			.select('id, name, created_at');
		if (refreshedMunicipalitiesError) {
			console.error(
				'Municipality list load error (refreshMunicipalitiesAfterSync):',
				refreshedMunicipalitiesError
			);
		}
		municipalityRowsByNameKey.clear();
		for (const municipality of refreshedMunicipalities ?? []) {
			if (municipality.id && municipality.name) {
				const key = normalizeNameKey(municipality.name);
				const rows = municipalityRowsByNameKey.get(key) ?? [];
				rows.push({
					id: municipality.id,
					name: municipality.name,
					created_at: municipality.created_at ?? null
				});
				municipalityRowsByNameKey.set(key, rows);
			}
		}
	}

	// This builds data-aware scores so duplicate municipality names map to the row that actually has accounts.
	const allMunicipalityIds = Array.from(
		new Set(Array.from(municipalityRowsByNameKey.values()).flat().map((row) => row.id))
	);
	const { data: municipalityBarangays, error: municipalityBarangaysError } = await supabaseAdmin
		.from('barangays')
		.select('id, municipality_id')
		.in('municipality_id', allMunicipalityIds);
	if (municipalityBarangaysError) {
		console.error(
			'Municipality list load error (canonicalBarangaysForDuplicateNames):',
			municipalityBarangaysError
		);
	}
	const { data: municipalityProfiles, error: municipalityProfilesError } = await supabaseAdmin
		.from('profiles')
		.select('id, municipality_id')
		.in('municipality_id', allMunicipalityIds);
	if (municipalityProfilesError) {
		console.error(
			'Municipality list load error (canonicalProfilesForDuplicateNames):',
			municipalityProfilesError
		);
	}

	const barangayCountByMunicipality = new Map<string, number>();
	for (const row of municipalityBarangays ?? []) {
		if (!row.municipality_id) continue;
		barangayCountByMunicipality.set(
			row.municipality_id,
			(barangayCountByMunicipality.get(row.municipality_id) ?? 0) + 1
		);
	}
	const directProfileCountByMunicipality = new Map<string, number>();
	for (const row of municipalityProfiles ?? []) {
		if (!row.municipality_id) continue;
		directProfileCountByMunicipality.set(
			row.municipality_id,
			(directProfileCountByMunicipality.get(row.municipality_id) ?? 0) + 1
		);
	}

	const municipalityIdByNameKey = new Map<string, string>();
	for (const [nameKey, rows] of municipalityRowsByNameKey.entries()) {
		const sortedRows = [...rows].sort((a, b) => {
			const aBarangays = barangayCountByMunicipality.get(a.id) ?? 0;
			const bBarangays = barangayCountByMunicipality.get(b.id) ?? 0;
			if (aBarangays !== bBarangays) return bBarangays - aBarangays;

			const aProfiles = directProfileCountByMunicipality.get(a.id) ?? 0;
			const bProfiles = directProfileCountByMunicipality.get(b.id) ?? 0;
			if (aProfiles !== bProfiles) return bProfiles - aProfiles;

			const aCreatedAt = Date.parse(a.created_at ?? '');
			const bCreatedAt = Date.parse(b.created_at ?? '');
			const safeACreatedAt = Number.isFinite(aCreatedAt) ? aCreatedAt : Number.MAX_SAFE_INTEGER;
			const safeBCreatedAt = Number.isFinite(bCreatedAt) ? bCreatedAt : Number.MAX_SAFE_INTEGER;
			return safeACreatedAt - safeBCreatedAt;
		});
		municipalityIdByNameKey.set(nameKey, sortedRows[0].id);
	}

	const municipalityEntries: Array<{ id: string; name: string; createdAt: string }> = [];
	for (const linkMunicipality of urlManagedMunicipalities) {
		const id = municipalityIdByNameKey.get(normalizeNameKey(linkMunicipality.municipalityName));
		if (!id) {
			continue;
		}
		municipalityEntries.push({
			id,
			name: toDisplayMunicipalityName(linkMunicipality.municipalityName),
			createdAt: linkMunicipality.createdAt
		});
	}

	// This parses and sanitizes filter/sort values from the URL query params.
	const searchTerm = (url.searchParams.get('search') ?? '').trim();
	const normalizedSearchTerm = searchTerm.toLowerCase();
	const sortOption = resolveSortOption(url.searchParams.get('sort'));
	const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);

	// This filters the municipality list by name using a case-insensitive search.
	const filteredMunicipalityEntries = municipalityEntries.filter((item) =>
		item.name.toLowerCase().includes(normalizedSearchTerm)
	);

	// This sorts municipality rows by the selected option.
	const sortedMunicipalityEntries = [...filteredMunicipalityEntries].sort((a, b) => {
		if (sortOption === 'latest' || sortOption === 'oldest') {
			const aTime = Date.parse(a.createdAt);
			const bTime = Date.parse(b.createdAt);
			const safeATime = Number.isFinite(aTime) ? aTime : 0;
			const safeBTime = Number.isFinite(bTime) ? bTime : 0;
			return sortOption === 'latest' ? safeBTime - safeATime : safeATime - safeBTime;
		}
		return a.name.localeCompare(b.name);
	});

	const PAGE_SIZE = 5;
	const totalMunicipalities = sortedMunicipalityEntries.length;
	const totalPages = Math.max(1, Math.ceil(totalMunicipalities / PAGE_SIZE));
	const currentPage =
		Number.isFinite(requestedPage) && requestedPage > 0
			? Math.min(requestedPage, totalPages)
			: 1;
	const startIndex = (currentPage - 1) * PAGE_SIZE;
	const pagedMunicipalityEntries = sortedMunicipalityEntries.slice(startIndex, startIndex + PAGE_SIZE);
	const municipalityIds = pagedMunicipalityEntries.map((item) => item.id);

	if (pagedMunicipalityEntries.length === 0) {
		return {
			pageTitle: 'List of Municipalities',
			pageDescription: 'Select a municipality to open its dedicated management page.',
			municipalitySummaries: [],
			pagination: {
				pageSize: PAGE_SIZE,
				currentPage,
				totalPages,
				totalMunicipalities
			},
			filters: {
				search: searchTerm,
				sort: sortOption
			}
		};
	}

	// Load only barangays belonging to URL-managed municipalities to reduce query cost.
	const { data: barangays, error: barangaysError } = await supabaseAdmin
		.from('barangays')
		.select('id, municipality_id')
		.in('municipality_id', municipalityIds);
	if (barangaysError) {
		console.error('Municipality list load error (barangays):', barangaysError);
	}

	const barangayIds = (barangays ?? [])
		.map((item) => item.id)
		.filter((value): value is string => typeof value === 'string' && value.trim() !== '');

	// Query related data in parallel so the page resolves faster.
	const [profilesByMunicipalityResult, profilesByBarangayResult, reportsResult] = await Promise.all([
		supabaseAdmin
			.from('profiles')
			.select('id, municipality_id, barangay_id')
			.in('municipality_id', municipalityIds),
		barangayIds.length > 0
			? supabaseAdmin
					.from('profiles')
					.select('id, municipality_id, barangay_id')
					.in('barangay_id', barangayIds)
			: Promise.resolve({ data: [], error: null }),
		barangayIds.length > 0
			? supabaseAdmin.from('reports').select('id, barangay_id').in('barangay_id', barangayIds)
			: Promise.resolve({ data: [], error: null })
	]);

	if (profilesByMunicipalityResult.error || profilesByBarangayResult.error) {
		console.error(
			'Municipality list load error (profiles):',
			profilesByMunicipalityResult.error ?? profilesByBarangayResult.error
		);
	}
	if (reportsResult.error) {
		console.error('Municipality list load error (reports):', reportsResult.error);
	}

	const profileById = new Map<
		string,
		{ id: string; municipality_id: string | null; barangay_id: string | null }
	>();
	for (const profile of profilesByMunicipalityResult.data ?? []) {
		if (profile.id) profileById.set(profile.id, profile);
	}
	for (const profile of profilesByBarangayResult.data ?? []) {
		if (profile.id) profileById.set(profile.id, profile);
	}
	const profiles = Array.from(profileById.values());
	const reports = reportsResult.data ?? [];

	const barangayToMunicipality = new Map<string, string>();
	const totalBarangaysByMunicipality = new Map<string, number>();
	for (const municipalityId of municipalityIds) {
		totalBarangaysByMunicipality.set(municipalityId, 0);
	}
	for (const barangay of barangays ?? []) {
		if (barangay.id && barangay.municipality_id) {
			barangayToMunicipality.set(barangay.id, barangay.municipality_id);
			totalBarangaysByMunicipality.set(
				barangay.municipality_id,
				(totalBarangaysByMunicipality.get(barangay.municipality_id) ?? 0) + 1
			);
		}
	}

	const usersByMunicipality = new Map<string, Set<string>>();
	for (const municipality of pagedMunicipalityEntries) {
		usersByMunicipality.set(municipality.id, new Set<string>());
	}
	for (const profile of profiles) {
		if (!profile.id) continue;
		if (profile.municipality_id && usersByMunicipality.has(profile.municipality_id)) {
			usersByMunicipality.get(profile.municipality_id)?.add(profile.id);
			continue;
		}
		if (profile.barangay_id) {
			const municipalityId = barangayToMunicipality.get(profile.barangay_id);
			if (municipalityId && usersByMunicipality.has(municipalityId)) {
				usersByMunicipality.get(municipalityId)?.add(profile.id);
			}
		}
	}

	const reportsByMunicipality = new Map<string, number>();
	for (const municipality of pagedMunicipalityEntries) {
		reportsByMunicipality.set(municipality.id, 0);
	}
	for (const report of reports) {
		const municipalityId = report.barangay_id
			? barangayToMunicipality.get(report.barangay_id)
			: undefined;
		if (!municipalityId) continue;
		reportsByMunicipality.set(
			municipalityId,
			(reportsByMunicipality.get(municipalityId) ?? 0) + 1
		);
	}

	return {
		pageTitle: 'List of Municipalities',
		pageDescription: 'Select a municipality to open its dedicated management page.',
		municipalitySummaries: pagedMunicipalityEntries
			.map((municipality) => ({
				id: municipality.id,
				name: municipality.name,
				totalBarangays: totalBarangaysByMunicipality.get(municipality.id) ?? 0,
				totalUsers: usersByMunicipality.get(municipality.id)?.size ?? 0,
				totalReports: reportsByMunicipality.get(municipality.id) ?? 0
			})),
		pagination: {
			pageSize: PAGE_SIZE,
			currentPage,
			totalPages,
			totalMunicipalities
		},
		filters: {
			search: searchTerm,
			sort: sortOption
		}
	};
};

export const actions: Actions = {
	deleteMunicipality: async ({ cookies, request }) => {
		if (
			cookies.get('admin_gate_passed') !== 'true' ||
			cookies.get('admin_authenticated') !== 'true'
		) {
			throw redirect(303, '/admin');
		}

		const formData = await request.formData();
		const municipalityId = String(formData.get('municipalityId') ?? '').trim();
		const municipalityName = String(formData.get('municipalityName') ?? '').trim();
		const confirmationText = String(formData.get('confirmationText') ?? '').trim();

		if (!municipalityId || !municipalityName) {
			return fail(400, { deleteError: 'Municipality details are missing.' });
		}

		if (confirmationText !== municipalityName.toLowerCase()) {
			return fail(400, {
				deleteError: 'Type the municipality name in lowercase to confirm deletion.'
			});
		}

		const supabaseAdmin = getSupabaseAdmin();

		const { data: municipality, error: municipalityError } = await supabaseAdmin
			.from('municipalities')
			.select('id, name')
			.eq('id', municipalityId)
			.maybeSingle();

		if (municipalityError || !municipality) {
			return fail(404, { deleteError: 'Municipality record was not found.' });
		}

		const { data: municipalityProfiles, error: municipalityProfilesError } = await supabaseAdmin
			.from('profiles')
			.select('id, role')
			.eq('municipality_id', municipalityId);
		if (municipalityProfilesError) {
			return fail(500, { deleteError: 'Unable to load municipality users for deletion.' });
		}

		const allowedLguRoles = new Set(['mdrrmo_admin', 'mdrrmo_staff', 'bdrrmo']);
		const lguProfileIds = Array.from(
			new Set(
				(municipalityProfiles ?? [])
					.filter((row) => allowedLguRoles.has(String(row.role ?? '').toLowerCase()))
					.map((row) => row.id)
			)
		);

		if (lguProfileIds.length > 0) {
			const { error: deleteProfilesError } = await supabaseAdmin
				.from('profiles')
				.delete()
				.in('id', lguProfileIds);
			if (deleteProfilesError) {
				return fail(500, { deleteError: 'Unable to delete LGU user profiles.' });
			}

			for (const profileId of lguProfileIds) {
				const authDeleteResult = await supabaseAdmin.auth.admin.deleteUser(profileId);
				if (authDeleteResult.error) {
					console.error('[admin municipality delete] delete auth user failed', profileId, authDeleteResult.error);
				}
			}
		}

		const { error: deleteMunicipalityError } = await supabaseAdmin
			.from('municipalities')
			.delete()
			.eq('id', municipalityId);
		if (deleteMunicipalityError) {
			return fail(500, { deleteError: 'Unable to delete municipality record.' });
		}

		const { error: deleteAccessLinkError } = await supabaseAdmin
			.from('lgu_access_links')
			.delete()
			.ilike('municipality_name', municipality.name);
		if (deleteAccessLinkError) {
			console.error('[admin municipality delete] delete access link failed', deleteAccessLinkError);
		}

		return {
			deleteSuccess: `Municipality "${toDisplayMunicipalityName(municipality.name)}" and related LGU accounts were deleted.`
		};
	},
	logoutAdmin: async ({ cookies }) => {
		cookies.delete('admin_authenticated', { path: '/' });
		cookies.delete('admin_gate_passed', { path: '/' });
		throw redirect(303, '/admin');
	}
};
