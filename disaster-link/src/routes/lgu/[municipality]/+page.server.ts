import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getLguAccessLinkBySlug, verifyLguAccessPassword } from '$lib/server/lgu-access-links';

const LGU_GATE_MAX_ATTEMPTS = 5;
const LGU_GATE_LOCKOUT_MINUTES = 15;
const LGU_GATE_SESSION_MINUTES = 30;

type AttemptRecord = {
	attempts: number;
	lockedUntil: number | null;
};

// This tracks failed attempts per slug and client combination.
const lguGateAttempts = new Map<string, AttemptRecord>();

function getAttemptKey(slug: string, clientAddress: string, userAgent: string | null): string {
	return `${slug}|${clientAddress}|${userAgent ?? 'unknown-agent'}`;
}

function getCurrentAttemptRecord(attemptKey: string, now: number): AttemptRecord {
	const existingRecord = lguGateAttempts.get(attemptKey);
	if (!existingRecord) {
		return { attempts: 0, lockedUntil: null };
	}
	if (existingRecord.lockedUntil && existingRecord.lockedUntil <= now) {
		lguGateAttempts.delete(attemptKey);
		return { attempts: 0, lockedUntil: null };
	}
	return existingRecord;
}

function getCookieKey(slug: string): string {
	return `lgu_gate_${slug}`;
}

export const load: PageServerLoad = async ({ params, cookies }) => {
	const municipalitySlug = params.municipality;
	const lguRecord = await getLguAccessLinkBySlug(municipalitySlug);
	if (!lguRecord) {
		throw redirect(303, '/');
	}

	const gateUnlocked = cookies.get(getCookieKey(municipalitySlug)) === 'true';

	return {
		municipalityName: lguRecord.municipalityName,
		municipalitySlug,
		/** Set after a successful gate password; avoids auto-redirect so /lgu/[slug] always loads visibly first. */
		gateUnlocked
	};
};

export const actions: Actions = {
	default: async ({ params, request, cookies, getClientAddress }) => {
		const municipalitySlug = params.municipality;
		const lguRecord = await getLguAccessLinkBySlug(municipalitySlug);
		if (!lguRecord) {
			throw redirect(303, '/');
		}

		const formData = await request.formData();
		const rawPassword = formData.get('password');
		const password = typeof rawPassword === 'string' ? rawPassword : '';

		if (!password) {
			return fail(400, { error: 'Password required' });
		}

		const now = Date.now();
		const attemptKey = getAttemptKey(
			municipalitySlug,
			getClientAddress(),
			request.headers.get('user-agent')
		);
		const currentRecord = getCurrentAttemptRecord(attemptKey, now);
		if (currentRecord.lockedUntil && currentRecord.lockedUntil > now) {
			const minutesRemaining = Math.ceil((currentRecord.lockedUntil - now) / (1000 * 60));
			return fail(403, {
				error: `403 Forbidden. Too many failed attempts. Try again in ${minutesRemaining} minute(s).`
			});
		}

		const verification = await verifyLguAccessPassword(municipalitySlug, password);
		if (!verification.ok) {
			const nextAttempts = currentRecord.attempts + 1;
			const reachedLimit = nextAttempts >= LGU_GATE_MAX_ATTEMPTS;
			const lockUntil = reachedLimit ? now + LGU_GATE_LOCKOUT_MINUTES * 60 * 1000 : null;

			lguGateAttempts.set(attemptKey, {
				attempts: reachedLimit ? LGU_GATE_MAX_ATTEMPTS : nextAttempts,
				lockedUntil: lockUntil
			});

			const attemptsLeft = Math.max(LGU_GATE_MAX_ATTEMPTS - nextAttempts, 0);
			const error = reachedLimit
				? `403 Forbidden. Too many failed attempts. Access is locked for ${LGU_GATE_LOCKOUT_MINUTES} minutes.`
				: `403 Forbidden. Invalid password. ${attemptsLeft} attempt(s) remaining.`;
			return fail(403, { error });
		}

		lguGateAttempts.delete(attemptKey);
		cookies.set(getCookieKey(municipalitySlug), 'true', {
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			path: '/',
			maxAge: LGU_GATE_SESSION_MINUTES * 60
		});

		throw redirect(303, `/lgu/${municipalitySlug}/login`);
	}
};
