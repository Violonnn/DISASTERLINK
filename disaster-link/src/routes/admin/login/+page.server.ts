import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_LOGIN_LOCKOUT_MINUTES = 15;
const ADMIN_LOGIN_SESSION_HOURS = 8;

type AttemptRecord = {
	attempts: number;
	lockedUntil: number | null;
};

// This in-memory store tracks admin login failures by client during runtime.
const adminLoginAttempts = new Map<string, AttemptRecord>();

// This helper builds a stable client key to enforce attempt limits reliably.
function getClientKey(clientAddress: string, userAgent: string | null): string {
	return `${clientAddress}|${userAgent ?? 'unknown-agent'}`;
}

// This helper returns a clean record and expires old lockout windows automatically.
function getCurrentAttemptRecord(clientKey: string, now: number): AttemptRecord {
	const existingRecord = adminLoginAttempts.get(clientKey);
	if (!existingRecord) {
		return { attempts: 0, lockedUntil: null };
	}

	if (existingRecord.lockedUntil && existingRecord.lockedUntil <= now) {
		adminLoginAttempts.delete(clientKey);
		return { attempts: 0, lockedUntil: null };
	}

	return existingRecord;
}

export const load: PageServerLoad = async ({ cookies, url }) => {
	// This protects /admin/login so only users who passed /admin can access it.
	if (cookies.get('admin_gate_passed') !== 'true') {
		throw redirect(303, '/admin');
	}

	const isAuthenticated = cookies.get('admin_authenticated') === 'true';
	const justLoggedIn = url.searchParams.get('logged') === '1';

	return {
		isAuthenticated,
		justLoggedIn
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		// This blocks direct POST attempts unless the access-key gate was passed first.
		if (cookies.get('admin_gate_passed') !== 'true') {
			throw redirect(303, '/admin');
		}

		const formData = await request.formData();
		const rawUsername = formData.get('username');
		const rawPassword = formData.get('password');

		const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
		const password = typeof rawPassword === 'string' ? rawPassword : '';

		// This validates required inputs before authentication checks.
		if (!username && !password) {
			return fail(400, { error: 'Username and password required' });
		}
		if (!username) {
			return fail(400, { error: 'Username required' });
		}
		if (!password) {
			return fail(400, { error: 'Password required' });
		}

		// This reads credentials from server-only environment variables.
		const configuredUsername = env.ADMIN_USERNAME ?? env.ADMIN_LOGIN_USERNAME;
		const configuredPassword = env.ADMIN_PASSWORD ?? env.ADMIN_LOGIN_PASSWORD;

		if (!configuredUsername || !configuredPassword) {
			return fail(400, {
				error:
					'Admin login credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in your .env and restart the server.'
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

		// This checks submitted credentials against configured admin credentials.
		if (username !== configuredUsername || password !== configuredPassword) {
			const nextAttempts = currentRecord.attempts + 1;
			const reachedLimit = nextAttempts >= ADMIN_LOGIN_MAX_ATTEMPTS;
			const lockUntil = reachedLimit
				? now + ADMIN_LOGIN_LOCKOUT_MINUTES * 60 * 1000
				: null;

			adminLoginAttempts.set(clientKey, {
				attempts: reachedLimit ? ADMIN_LOGIN_MAX_ATTEMPTS : nextAttempts,
				lockedUntil: lockUntil
			});

			const attemptsLeft = Math.max(ADMIN_LOGIN_MAX_ATTEMPTS - nextAttempts, 0);
			const errorMessage = reachedLimit
				? `403 Forbidden. Too many failed attempts. Access is locked for ${ADMIN_LOGIN_LOCKOUT_MINUTES} minutes.`
				: `403 Forbidden. Invalid admin credentials. ${attemptsLeft} attempt(s) remaining.`;

			return fail(403, { error: errorMessage });
		}

		// This clears failures and creates a secure admin login session cookie.
		adminLoginAttempts.delete(clientKey);
		cookies.set('admin_authenticated', 'true', {
			httpOnly: true,
			secure: !dev,
			sameSite: 'strict',
			path: '/',
			maxAge: ADMIN_LOGIN_SESSION_HOURS * 60 * 60
		});

		throw redirect(303, '/admin/dashboard');
	}
};
