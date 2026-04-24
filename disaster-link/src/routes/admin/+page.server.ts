import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const ADMIN_GATE_MAX_ATTEMPTS = 5;
const ADMIN_GATE_LOCKOUT_MINUTES = 15;
const ADMIN_GATE_SESSION_MINUTES = 10;

type AttemptRecord = {
	attempts: number;
	lockedUntil: number | null;
};

// This in-memory store tracks failed attempts by client key during runtime.
const adminGateAttempts = new Map<string, AttemptRecord>();

// This helper creates a stable key so one browser cannot bypass lockout by reloading.
function getClientKey(clientAddress: string, userAgent: string | null): string {
	return `${clientAddress}|${userAgent ?? 'unknown-agent'}`;
}

// This helper reads current lock status for a client and clears expired lockouts.
function getCurrentAttemptRecord(clientKey: string, now: number): AttemptRecord {
	const existingRecord = adminGateAttempts.get(clientKey);
	if (!existingRecord) {
		return { attempts: 0, lockedUntil: null };
	}

	if (existingRecord.lockedUntil && existingRecord.lockedUntil <= now) {
		adminGateAttempts.delete(clientKey);
		return { attempts: 0, lockedUntil: null };
	}

	return existingRecord;
}

export const load: PageServerLoad = async ({ cookies }) => {
	// This route always shows the access key form.
	// Successful submissions still redirect to /admin/login via the action.
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const formData = await request.formData();
		const rawAccessKey = formData.get('accessKey');
		const accessKey = typeof rawAccessKey === 'string' ? rawAccessKey.trim() : '';

		// This validates input on the server so empty payloads are rejected safely.
		if (!accessKey) {
			return fail(400, { error: 'Access key is required.' });
		}

		// This reads the configured admin key and supports two environment variable names.
		const configuredAdminAccessKey = env.ADMIN_ACCESS_KEY ?? env.ADMIN_ACCESS_PASSWORD;
		if (!configuredAdminAccessKey) {
			return fail(400, {
				error:
					'Admin access key is not configured. Set ADMIN_ACCESS_KEY (or ADMIN_ACCESS_PASSWORD) in your .env, then restart the dev server.'
			});
		}

		const clientAddress = getClientAddress();
		const userAgent = request.headers.get('user-agent');
		const clientKey = getClientKey(clientAddress, userAgent);
		const now = Date.now();

		const currentRecord = getCurrentAttemptRecord(clientKey, now);
		if (currentRecord.lockedUntil && currentRecord.lockedUntil > now) {
			const minutesRemaining = Math.ceil((currentRecord.lockedUntil - now) / (1000 * 60));
			return fail(403, {
				error: `403 Forbidden. Too many failed attempts. Try again in ${minutesRemaining} minute(s).`
			});
		}

		// This verifies the submitted key against the server-only environment secret.
		if (accessKey !== configuredAdminAccessKey) {
			const nextAttempts = currentRecord.attempts + 1;
			const reachedLimit = nextAttempts >= ADMIN_GATE_MAX_ATTEMPTS;
			const lockUntil = reachedLimit
				? now + ADMIN_GATE_LOCKOUT_MINUTES * 60 * 1000
				: null;

			adminGateAttempts.set(clientKey, {
				attempts: reachedLimit ? ADMIN_GATE_MAX_ATTEMPTS : nextAttempts,
				lockedUntil: lockUntil
			});

			const attemptsLeft = Math.max(ADMIN_GATE_MAX_ATTEMPTS - nextAttempts, 0);
			const errorMessage = reachedLimit
				? `403 Forbidden. Too many failed attempts. Access is locked for ${ADMIN_GATE_LOCKOUT_MINUTES} minutes.`
				: `403 Forbidden. Wrong access key. ${attemptsLeft} attempt(s) remaining.`;

			return fail(403, { error: errorMessage });
		}

		// This clears failed attempts and grants a short-lived admin gate session.
		adminGateAttempts.delete(clientKey);
		// This enforces a fresh admin credential login after each successful access-key entry.
		cookies.delete('admin_authenticated', { path: '/' });
		cookies.set('admin_gate_passed', 'true', {
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			path: '/',
			maxAge: ADMIN_GATE_SESSION_MINUTES * 60
		});

		throw redirect(303, '/admin/login');
	}
};
