import { randomBytes } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '$lib/supabase-admin.server';

/** Shared inbox identity for anonymous map reports (must match a real auth user + profile). */
const GUEST_REPORTER_EMAIL = 'guest-reporter@disasterlink.internal';

type GuestReportPayload = {
	barangayId?: unknown;
	title?: unknown;
	description?: unknown;
	gpsLat?: unknown;
	gpsLng?: unknown;
	photoUrls?: unknown;
	videoUrls?: unknown;
};

function asTrimmedString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * Resolves the UUID used as reports.reporter_id for guest submissions.
 * Profiles.id must reference auth.users — we create a dedicated auth user once if missing.
 */
async function resolveGuestReporterProfileId(
	supabaseAdmin: SupabaseClient
): Promise<{ id: string | null; error: string | null }> {
	const { data: existingProfile } = await supabaseAdmin
		.from('profiles')
		.select('id')
		.eq('email', GUEST_REPORTER_EMAIL)
		.maybeSingle();

	if (existingProfile?.id) return { id: existingProfile.id, error: null };

	const randomPassword = `${randomBytes(24).toString('base64url')}Aa1`;

	const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
		email: GUEST_REPORTER_EMAIL,
		password: randomPassword,
		email_confirm: true,
		user_metadata: {
			role: 'resident',
			first_name: 'Guest',
			last_name: 'Reporter'
		}
	});

	if (created?.user?.id) return { id: created.user.id, error: null };

	const msg = (createErr?.message ?? '').toLowerCase();
	const duplicate = msg.includes('already') || msg.includes('registered') || createErr?.status === 422;

	if (duplicate) {
		let page = 1;
		const perPage = 200;
		for (let attempt = 0; attempt < 10; attempt++) {
			const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
			if (listErr) break;
			const users = listData?.users ?? [];
			const match = users.find((u) => (u.email ?? '').toLowerCase() === GUEST_REPORTER_EMAIL.toLowerCase());
			if (match?.id) return { id: match.id, error: null };
			if (users.length < perPage) break;
			page += 1;
		}
	}

	return { id: null, error: createErr?.message ?? 'Could not prepare guest reporter account.' };
}

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => null)) as GuestReportPayload | null;
	if (!payload) {
		return json({ id: null, error: 'Invalid request payload.' }, { status: 400 });
	}

	const barangayId = asTrimmedString(payload.barangayId);
	const title = asTrimmedString(payload.title);
	const description = asTrimmedString(payload.description);
	const gpsLat = asNumber(payload.gpsLat);
	const gpsLng = asNumber(payload.gpsLng);
	const photoUrls = asStringArray(payload.photoUrls);
	const videoUrls = asStringArray(payload.videoUrls);

	if (!barangayId) return json({ id: null, error: 'Missing barangay.' }, { status: 400 });
	if (title.length < 2) return json({ id: null, error: 'Title must be at least 2 characters.' }, { status: 400 });
	if (description.length < 5) return json({ id: null, error: 'Description must be at least 5 characters.' }, { status: 400 });
	if (photoUrls.length + videoUrls.length < 1) {
		return json({ id: null, error: 'Attach at least one photo or video.' }, { status: 400 });
	}
	if (gpsLat == null || gpsLng == null) return json({ id: null, error: 'Location is required.' }, { status: 400 });

	const supabaseAdmin = getSupabaseAdmin();

	const { id: guestReporterId, error: guestIdError } = await resolveGuestReporterProfileId(supabaseAdmin);
	if (!guestReporterId) {
		return json({ id: null, error: guestIdError ?? 'Could not prepare guest reporter.' }, { status: 500 });
	}

	const insertPayload: Record<string, unknown> = {
		reporter_id: guestReporterId,
		barangay_id: barangayId,
		title,
		description,
		gps_lat: gpsLat,
		gps_lng: gpsLng,
		photo_urls: photoUrls,
		video_urls: videoUrls,
		status: 'pending'
	};

	const { data: insertedReport, error: insertError } = await supabaseAdmin
		.from('reports')
		.insert(insertPayload)
		.select('id')
		.single();

	if (insertError || !insertedReport?.id) {
		return json({ id: null, error: 'Could not submit your report right now. Please try again.' }, { status: 500 });
	}

	return json({ id: insertedReport.id, error: null });
};
