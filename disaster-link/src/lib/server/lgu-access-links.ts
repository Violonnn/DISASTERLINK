import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toDisplayMunicipalityName } from '$lib/utils/municipality-name';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';

export type LguAccessLink = {
	id: string;
	municipalityName: string;
	slug: string;
	passwordHash: string;
	passwordSalt: string;
	createdAt: string;
	updatedAt: string;
};

export type MdrrmoInvitation = {
	id: string;
	municipalityId: string;
	municipalityName: string;
	token: string;
	role: 'mdrrmo_admin' | 'mdrrmo_staff' | 'bdrrmo';
	createdAt: string;
	expiresAt: string;
	isRevoked: boolean;
	usedAt?: string | null;
	usedByUserId?: string | null;
};

type LguAccessLinkStore = {
	items: LguAccessLink[];
	invitations?: MdrrmoInvitation[];
};

const LGU_ACCESS_STORE_PATH = join(process.cwd(), 'data', 'lgu-access-links.json');
const ALT_LGU_ACCESS_STORE_PATH = join(process.cwd(), 'disaster-link', 'data', 'lgu-access-links.json');
const MUNICIPALITY_NAME_PATTERN = /^[A-Za-z][A-Za-z\s-]{1,79}$/;

let writeQueue: Promise<void> = Promise.resolve();
let legacyImportPromise: Promise<void> | null = null;

export type LegacyLguImportReport = {
	foundLegacyItems: number;
	validLegacyRows: number;
	alreadyInDatabase: number;
	newlyInserted: number;
	updatedExisting: number;
};

// This validates municipality names so links stay clean and predictable.
export function validateMunicipalityName(input: string): string {
	const normalized = input.trim().replace(/\s+/g, ' ');
	if (!MUNICIPALITY_NAME_PATTERN.test(normalized)) {
		throw new Error(
			'Municipality name must start with a letter and use only letters, spaces, and hyphens.'
		);
	}
	// This normalizes to title case per word for display consistency.
	return toDisplayMunicipalityName(normalized);
}

// This validates passwords for basic security requirements.
export function validateLguPassword(input: string): string {
	if (!input || input.trim().length < 4) {
		throw new Error('Password must be at least 4 characters.');
	}
	if (input.length > 128) {
		throw new Error('Password is too long.');
	}
	return input;
}

// This converts a municipality name into a URL-safe slug.
export function slugifyMunicipalityName(municipalityName: string): string {
	return municipalityName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function hashPassword(password: string, salt: string): string {
	return scryptSync(password, salt, 64).toString('hex');
}

function normalizeMunicipalityNameKey(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function timingSafeCompare(a: string, b: string): boolean {
	const aBuffer = Buffer.from(a);
	const bBuffer = Buffer.from(b);
	if (aBuffer.length !== bBuffer.length) return false;
	return timingSafeEqual(aBuffer, bBuffer);
}

async function ensureStoreFileExists(): Promise<void> {
	await mkdir(dirname(LGU_ACCESS_STORE_PATH), { recursive: true });
	try {
		await readFile(LGU_ACCESS_STORE_PATH, 'utf-8');
	} catch {
		const initialStore: LguAccessLinkStore = { items: [] };
		await writeFile(LGU_ACCESS_STORE_PATH, JSON.stringify(initialStore, null, 2), 'utf-8');
	}
}

function emptyStore(): LguAccessLinkStore {
	return { items: [], invitations: [] };
}

async function readStore(): Promise<LguAccessLinkStore> {
	await ensureStoreFileExists();
	const maxAttempts = 5;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const raw = await readFile(LGU_ACCESS_STORE_PATH, 'utf-8');
			const parsed = JSON.parse(raw) as LguAccessLinkStore;
			return {
				items: Array.isArray(parsed.items) ? parsed.items : [],
				invitations: Array.isArray(parsed.invitations) ? parsed.invitations : []
			};
		} catch {
			// Concurrent writes (e.g. invite create during page reload) can yield partial reads; retry briefly.
			if (attempt === maxAttempts - 1) return emptyStore();
			await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
		}
	}
	return emptyStore();
}

async function writeStore(store: LguAccessLinkStore): Promise<void> {
	await ensureStoreFileExists();
	const payload = JSON.stringify(store, null, 2);
	const tmpPath = `${LGU_ACCESS_STORE_PATH}.${randomBytes(8).toString('hex')}.tmp`;
	await writeFile(tmpPath, payload, 'utf-8');
	try {
		await rename(tmpPath, LGU_ACCESS_STORE_PATH);
	} catch {
		// Windows often rejects rename when the target exists; replace then clean up temp.
		try {
			await unlink(LGU_ACCESS_STORE_PATH);
		} catch {
			// ignore if missing
		}
		await rename(tmpPath, LGU_ACCESS_STORE_PATH);
	}
}

async function withStoreWriteLock<T>(operation: () => Promise<T>): Promise<T> {
	const previousQueue = writeQueue;
	let releaseQueue: () => void = () => {};
	writeQueue = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});

	await previousQueue;
	try {
		return await operation();
	} finally {
		releaseQueue();
	}
}

export function buildLguUrl(origin: string, slug: string): string {
	return `${origin}/lgu/${slug}`;
}

type LguAccessLinkRow = {
	id: string;
	municipality_name: string;
	slug: string;
	password_hash: string;
	password_salt: string;
	created_at: string;
	updated_at: string;
};

function mapRowToAccessLink(row: LguAccessLinkRow): LguAccessLink {
	return {
		id: row.id,
		municipalityName: row.municipality_name,
		slug: row.slug,
		passwordHash: row.password_hash,
		passwordSalt: row.password_salt,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

async function readLegacyStoreItemsFromPath(path: string): Promise<LguAccessLink[]> {
	try {
		const raw = await readFile(path, 'utf-8');
		const parsed = JSON.parse(raw) as LguAccessLinkStore;
		return Array.isArray(parsed.items) ? parsed.items : [];
	} catch {
		return [];
	}
}

// This gathers legacy links from common project paths so migration works across different run directories.
async function readLegacyStoreItemsForMigration(): Promise<LguAccessLink[]> {
	const [primaryItems, alternateItems] = await Promise.all([
		readLegacyStoreItemsFromPath(LGU_ACCESS_STORE_PATH),
		readLegacyStoreItemsFromPath(ALT_LGU_ACCESS_STORE_PATH)
	]);
	const merged = [...primaryItems, ...alternateItems];
	const bySlug = new Map<string, LguAccessLink>();
	for (const item of merged) {
		if (!item?.slug) continue;
		bySlug.set(item.slug, item);
	}
	return Array.from(bySlug.values());
}

// This imports legacy JSON links into Supabase once so old data is preserved after migration.
export async function importLegacyLguLinksToDatabase(): Promise<LegacyLguImportReport> {
	const legacyItems = await readLegacyStoreItemsForMigration();
	const legacyRows = legacyItems
		.filter((item) => item.slug && item.passwordHash && item.passwordSalt && item.municipalityName)
		.map((item) => ({
			municipality_name: toDisplayMunicipalityName(item.municipalityName),
			slug: item.slug,
			password_hash: item.passwordHash,
			password_salt: item.passwordSalt,
			created_at: item.createdAt,
			updated_at: item.updatedAt
		}));

	if (legacyRows.length === 0) {
		return {
			foundLegacyItems: legacyItems.length,
			validLegacyRows: 0,
			alreadyInDatabase: 0,
			newlyInserted: 0,
			updatedExisting: 0
		};
	}

	const supabaseAdmin = getSupabaseAdmin();
	const slugs = legacyRows.map((row) => row.slug);
	const { data: existingRows, error: existingRowsError } = await supabaseAdmin
		.from('lgu_access_links')
		.select('slug')
		.in('slug', slugs);
	if (existingRowsError) {
		throw new Error('Unable to check existing LGU links before import.');
	}
	const existingSlugSet = new Set((existingRows ?? []).map((row) => String(row.slug)));

	const { error: upsertError } = await supabaseAdmin.from('lgu_access_links').upsert(legacyRows, {
		onConflict: 'slug'
	});
	if (upsertError) {
		throw new Error(
			`Unable to import legacy LGU links into database. ${upsertError.message ?? ''}`.trim()
		);
	}

	return {
		foundLegacyItems: legacyItems.length,
		validLegacyRows: legacyRows.length,
		alreadyInDatabase: existingSlugSet.size,
		newlyInserted: Math.max(legacyRows.length - existingSlugSet.size, 0),
		updatedExisting: Math.min(existingSlugSet.size, legacyRows.length)
	};
}

async function ensureLegacyLinksImported(): Promise<void> {
	if (!legacyImportPromise) {
		legacyImportPromise = (async () => {
			try {
				await importLegacyLguLinksToDatabase();
			} catch (error) {
				console.error('LGU access link legacy import error:', error);
			}
		})();
	}
	await legacyImportPromise;
}

export async function listLguAccessLinks(): Promise<LguAccessLink[]> {
	await ensureLegacyLinksImported();
	const supabaseAdmin = getSupabaseAdmin();
	const { data, error } = await supabaseAdmin
		.from('lgu_access_links')
		.select(
			'id, municipality_name, slug, password_hash, password_salt, created_at, updated_at'
		)
		.order('updated_at', { ascending: false });
	if (error) {
		throw new Error('Unable to load LGU access links.');
	}
	return (data ?? []).map((row) => mapRowToAccessLink(row as LguAccessLinkRow));
}

export async function listMdrrmoInvitationsByMunicipality(
	municipalityId: string
): Promise<MdrrmoInvitation[]> {
	const store = await readStore();
	const nowIso = new Date().toISOString();
	return (store.invitations ?? [])
		.filter(
			(item) =>
				item.municipalityId === municipalityId &&
				!item.isRevoked &&
				!item.usedAt &&
				item.expiresAt >= nowIso
		)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLguAccessLinkBySlug(slug: string): Promise<LguAccessLink | null> {
	await ensureLegacyLinksImported();
	const supabaseAdmin = getSupabaseAdmin();
	const { data, error } = await supabaseAdmin
		.from('lgu_access_links')
		.select(
			'id, municipality_name, slug, password_hash, password_salt, created_at, updated_at'
		)
		.eq('slug', slug)
		.maybeSingle();
	if (error) {
		throw new Error('Unable to load LGU municipality link.');
	}
	return data ? mapRowToAccessLink(data as LguAccessLinkRow) : null;
}

export async function createLguAccessLink(params: {
	municipalityName: string;
	password: string;
}): Promise<LguAccessLink> {
	await ensureLegacyLinksImported();
	const safeMunicipalityName = validateMunicipalityName(params.municipalityName);
	const safePassword = validateLguPassword(params.password);
	const slug = slugifyMunicipalityName(safeMunicipalityName);
	if (!slug) {
		throw new Error('Unable to generate municipality slug from the provided name.');
	}

	const supabaseAdmin = getSupabaseAdmin();
	const { data: duplicateRows, error: duplicateError } = await supabaseAdmin
		.from('lgu_access_links')
		.select('id, slug, municipality_name')
		.or(`slug.eq.${slug},municipality_name.ilike.${safeMunicipalityName}`);
	if (duplicateError) {
		throw new Error('Unable to validate municipality URL uniqueness.');
	}
	const municipalityNameKey = normalizeMunicipalityNameKey(safeMunicipalityName);
	const hasDuplicate = (duplicateRows ?? []).some((row) => {
		const typedRow = row as { slug: string; municipality_name: string };
		return (
			typedRow.slug === slug ||
			normalizeMunicipalityNameKey(typedRow.municipality_name) === municipalityNameKey
		);
	});
	if (hasDuplicate) {
		throw new Error('A municipality URL for this name already exists.');
	}

	const passwordSalt = randomBytes(16).toString('hex');
	const passwordHash = hashPassword(safePassword, passwordSalt);
	const { data: insertedRow, error: insertError } = await supabaseAdmin
		.from('lgu_access_links')
		.insert({
			municipality_name: safeMunicipalityName,
			slug,
			password_hash: passwordHash,
			password_salt: passwordSalt
		})
		.select(
			'id, municipality_name, slug, password_hash, password_salt, created_at, updated_at'
		)
		.single();
	if (insertError || !insertedRow) {
		throw new Error('Unable to create municipality URL.');
	}
	return mapRowToAccessLink(insertedRow as LguAccessLinkRow);
}

export async function updateLguAccessLink(params: {
	id: string;
	municipalityName: string;
	password?: string;
}): Promise<LguAccessLink> {
	await ensureLegacyLinksImported();
	const safeMunicipalityName = validateMunicipalityName(params.municipalityName);
	const nextSlug = slugifyMunicipalityName(safeMunicipalityName);
	if (!nextSlug) {
		throw new Error('Unable to generate municipality slug from the provided name.');
	}

	const supabaseAdmin = getSupabaseAdmin();
	const { data: currentRow, error: currentError } = await supabaseAdmin
		.from('lgu_access_links')
		.select('id')
		.eq('id', params.id)
		.maybeSingle();
	if (currentError) {
		throw new Error('Unable to load municipality URL.');
	}
	if (!currentRow) {
		throw new Error('Municipality URL record not found.');
	}

	const { data: duplicateRows, error: duplicateError } = await supabaseAdmin
		.from('lgu_access_links')
		.select('id, slug, municipality_name')
		.neq('id', params.id)
		.or(`slug.eq.${nextSlug},municipality_name.ilike.${safeMunicipalityName}`);
	if (duplicateError) {
		throw new Error('Unable to validate municipality URL uniqueness.');
	}
	const municipalityNameKey = normalizeMunicipalityNameKey(safeMunicipalityName);
	const hasDuplicate = (duplicateRows ?? []).some((row) => {
		const typedRow = row as { slug: string; municipality_name: string };
		return (
			typedRow.slug === nextSlug ||
			normalizeMunicipalityNameKey(typedRow.municipality_name) === municipalityNameKey
		);
	});
	if (hasDuplicate) {
		throw new Error('Another municipality URL already exists for this name.');
	}

	const updatePayload: {
		municipality_name: string;
		slug: string;
		password_hash?: string;
		password_salt?: string;
	} = {
		municipality_name: safeMunicipalityName,
		slug: nextSlug
	};
	if (params.password && params.password.trim() !== '') {
		const safePassword = validateLguPassword(params.password);
		const nextSalt = randomBytes(16).toString('hex');
		updatePayload.password_salt = nextSalt;
		updatePayload.password_hash = hashPassword(safePassword, nextSalt);
	}

	const { data: updatedRow, error: updateError } = await supabaseAdmin
		.from('lgu_access_links')
		.update(updatePayload)
		.eq('id', params.id)
		.select(
			'id, municipality_name, slug, password_hash, password_salt, created_at, updated_at'
		)
		.single();
	if (updateError || !updatedRow) {
		throw new Error('Unable to update municipality URL.');
	}
	return mapRowToAccessLink(updatedRow as LguAccessLinkRow);
}

export async function deleteLguAccessLink(id: string): Promise<void> {
	await ensureLegacyLinksImported();
	const supabaseAdmin = getSupabaseAdmin();
	const { error } = await supabaseAdmin.from('lgu_access_links').delete().eq('id', id);
	if (error) {
		throw new Error('Unable to delete municipality URL.');
	}
}

export async function verifyLguAccessPassword(
	slug: string,
	password: string
): Promise<{ ok: true; municipalityName: string } | { ok: false }> {
	const target = await getLguAccessLinkBySlug(slug);
	if (!target) return { ok: false };

	const computedHash = hashPassword(password, target.passwordSalt);
	const matches = timingSafeCompare(computedHash, target.passwordHash);
	if (!matches) return { ok: false };

	return { ok: true, municipalityName: target.municipalityName };
}

export async function createMdrrmoInvitation(params: {
	municipalityId: string;
	municipalityName: string;
	role?: 'mdrrmo_admin' | 'mdrrmo_staff' | 'bdrrmo';
	validityHours?: number;
}): Promise<MdrrmoInvitation> {
	return withStoreWriteLock(async () => {
		const now = new Date();
		const validityHours = Math.max(1, Math.min(params.validityHours ?? 24, 168));
		const store = await readStore();

		const invitation: MdrrmoInvitation = {
			id: randomBytes(12).toString('hex'),
			municipalityId: params.municipalityId,
			municipalityName: toDisplayMunicipalityName(params.municipalityName),
			token: randomBytes(24).toString('hex'),
			role: params.role ?? 'mdrrmo_admin',
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + validityHours * 60 * 60 * 1000).toISOString(),
			isRevoked: false,
			usedAt: null,
			usedByUserId: null
		};

		const invitations = store.invitations ?? [];
		invitations.push(invitation);
		store.invitations = invitations;
		await writeStore(store);
		return invitation;
	});
}

export async function revokeMdrrmoInvitation(invitationId: string): Promise<void> {
	await withStoreWriteLock(async () => {
		const store = await readStore();
		const invitations = store.invitations ?? [];
		const targetIndex = invitations.findIndex((item) => item.id === invitationId);
		if (targetIndex === -1) {
			throw new Error('Invitation not found.');
		}

		invitations[targetIndex] = {
			...invitations[targetIndex],
			isRevoked: true
		};

		store.invitations = invitations;
		await writeStore(store);
	});
}

export async function getValidMdrrmoInvitationByToken(
	token: string
): Promise<MdrrmoInvitation | null> {
	const store = await readStore();
	const nowIso = new Date().toISOString();
	const target =
		(store.invitations ?? []).find((item) => item.token === token && !item.isRevoked) ?? null;
	if (!target) return null;
	if (target.usedAt) return null;
	if (target.expiresAt < nowIso) return null;
	return target;
}

export async function consumeMdrrmoInvitationByToken(params: {
	token: string;
	userId: string;
	expectedRole?: 'mdrrmo_admin' | 'mdrrmo_staff' | 'bdrrmo';
}): Promise<MdrrmoInvitation> {
	return withStoreWriteLock(async () => {
		const store = await readStore();
		const nowIso = new Date().toISOString();
		const invitations = store.invitations ?? [];
		const targetIndex = invitations.findIndex((item) => item.token === params.token);
		if (targetIndex === -1) {
			throw new Error('Invitation link is invalid.');
		}

		const target = invitations[targetIndex];
		if (target.isRevoked) {
			throw new Error('Invitation link has been revoked.');
		}
		if (target.usedAt) {
			throw new Error('Invitation link has already been used.');
		}
		if (target.expiresAt < nowIso) {
			throw new Error('Invitation link has expired.');
		}
		if (params.expectedRole && target.role !== params.expectedRole) {
			throw new Error('Invitation role mismatch.');
		}

		const updated: MdrrmoInvitation = {
			...target,
			usedAt: nowIso,
			usedByUserId: params.userId
		};
		invitations[targetIndex] = updated;
		store.invitations = invitations;
		await writeStore(store);
		return updated;
	});
}
