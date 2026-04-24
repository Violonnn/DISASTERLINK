import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';

type UserStatusFilter = 'pending' | 'verified';
type UserRoleFilter = 'all' | 'resident' | 'mdrrmo_admin' | 'mdrrmo_staff' | 'mayor' | 'bdrrmo';
type UserSortFilter = 'a-z' | 'latest' | 'oldest';

const PAGE_SIZE = 5;

function normalizeStatusFilter(raw: string | null): UserStatusFilter {
	return raw === 'pending' ? 'pending' : 'verified';
}

function normalizeRoleFilter(raw: string | null): UserRoleFilter {
	if (
		raw === 'resident' ||
		raw === 'mdrrmo_admin' ||
		raw === 'mdrrmo_staff' ||
		raw === 'mayor' ||
		raw === 'bdrrmo'
	) {
		return raw;
	}
	return 'all';
}

function normalizeSortFilter(raw: string | null): UserSortFilter {
	if (raw === 'latest' || raw === 'oldest') return raw;
	return 'a-z';
}

function normalizeRoleForFilter(role: string | null): UserRoleFilter {
	const normalized = (role ?? '').toLowerCase();
	if (normalized === 'resident') return 'resident';
	if (normalized === 'municipal_responder' || normalized === 'mdrrmo_admin') return 'mdrrmo_admin';
	if (normalized === 'mdrrmo_staff') return 'mdrrmo_staff';
	if (normalized === 'mayor') return 'mayor';
	if (normalized === 'barangay_responder' || normalized === 'lgu_responder' || normalized === 'bdrrmo')
		return 'bdrrmo';
	return 'all';
}

function roleLabelForDisplay(role: string | null): string {
	const normalized = normalizeRoleForFilter(role);
	if (normalized === 'resident') return 'Resident';
	if (normalized === 'mdrrmo_admin') return 'MDRRMO Admin';
	if (normalized === 'mdrrmo_staff') return 'MDRRMO Staff';
	if (normalized === 'mayor') return 'Mayor';
	if (normalized === 'bdrrmo') return 'BDRRMO';
	return 'N/A';
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (
		cookies.get('admin_gate_passed') !== 'true' ||
		cookies.get('admin_authenticated') !== 'true'
	) {
		throw redirect(303, '/admin');
	}

	const statusFilter = normalizeStatusFilter(
		url.searchParams.get('status') ?? url.searchParams.get('filter')
	);
	const roleFilter = normalizeRoleFilter(url.searchParams.get('users'));
	const sortBy = normalizeSortFilter(url.searchParams.get('sort'));
	const search = (url.searchParams.get('search') ?? '').trim();
	const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const supabaseAdmin = getSupabaseAdmin();

	const { data: profiles, error: profilesError } = await supabaseAdmin
		.from('profiles')
		.select('id, first_name, last_name, email, phone, role, municipality_id, barangay_id, created_at')
		.order('created_at', { ascending: false });
	if (profilesError) {
		throw error(500, 'Unable to load users.');
	}

	const municipalityIds = Array.from(
		new Set(
			(profiles ?? [])
				.map((profile) => profile.municipality_id)
				.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
		)
	);
	const barangayIds = Array.from(
		new Set(
			(profiles ?? [])
				.map((profile) => profile.barangay_id)
				.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
		)
	);

	const municipalityNameById = new Map<string, string>();
	if (municipalityIds.length > 0) {
		const { data: municipalities } = await supabaseAdmin
			.from('municipalities')
			.select('id, name')
			.in('id', municipalityIds);
		for (const municipality of municipalities ?? []) {
			municipalityNameById.set(
				municipality.id,
				municipality.name ? toDisplayMunicipalityName(municipality.name) : 'N/A'
			);
		}
	}

	const barangayNameById = new Map<string, string>();
	if (barangayIds.length > 0) {
		const { data: barangays } = await supabaseAdmin
			.from('barangays')
			.select('id, name')
			.in('id', barangayIds);
		for (const barangay of barangays ?? []) {
			barangayNameById.set(barangay.id, barangay.name ?? 'N/A');
		}
	}

	const rows = await Promise.all(
		(profiles ?? []).map(async (profile) => {
			const authUserResult = await supabaseAdmin.auth.admin.getUserById(profile.id);
			const isVerified = !!authUserResult.data.user?.email_confirmed_at;
			const normalizedRole = normalizeRoleForFilter(profile.role);
			return {
				id: profile.id,
				name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'No name',
				email: profile.email ?? 'No email',
				phone: profile.phone ?? 'N/A',
				role: roleLabelForDisplay(profile.role),
				normalizedRole,
				municipalityName: municipalityNameById.get(profile.municipality_id ?? '') ?? 'N/A',
				barangayName: barangayNameById.get(profile.barangay_id ?? '') ?? 'N/A',
				status: isVerified ? 'Verified' : 'Pending Verification',
				createdAt: profile.created_at ?? ''
			};
		})
	);

	const normalizedSearch = search.toLowerCase();
	const statusFilteredRows = rows.filter((row) =>
		statusFilter === 'verified' ? row.status === 'Verified' : row.status === 'Pending Verification'
	);
	const roleFilteredRows = statusFilteredRows.filter((row) =>
		roleFilter === 'all' ? true : row.normalizedRole === roleFilter
	);
	const searchedRows = roleFilteredRows.filter((row) => {
		if (!normalizedSearch) return true;
		return (
			row.name.toLowerCase().includes(normalizedSearch) ||
			row.email.toLowerCase().includes(normalizedSearch)
		);
	});

	const sortedUsers = [...searchedRows].sort((a, b) => {
		if (sortBy === 'latest' || sortBy === 'oldest') {
			const aTime = Date.parse(a.createdAt);
			const bTime = Date.parse(b.createdAt);
			const safeATime = Number.isFinite(aTime) ? aTime : 0;
			const safeBTime = Number.isFinite(bTime) ? bTime : 0;
			return sortBy === 'latest' ? safeBTime - safeATime : safeATime - safeBTime;
		}
		return a.name.localeCompare(b.name);
	});

	const totalUsers = sortedUsers.length;
	const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));
	const currentPage =
		Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
	const startIndex = (currentPage - 1) * PAGE_SIZE;
	const pagedUsers = sortedUsers.slice(startIndex, startIndex + PAGE_SIZE);

	return {
		pageTitle: 'All Users',
		pageDescription: 'Filter and review user records across the platform.',
		users: pagedUsers,
		filters: {
			status: statusFilter,
			users: roleFilter,
			sort: sortBy,
			search
		},
		pagination: {
			pageSize: PAGE_SIZE,
			currentPage,
			totalPages,
			totalUsers
		}
	};
};
