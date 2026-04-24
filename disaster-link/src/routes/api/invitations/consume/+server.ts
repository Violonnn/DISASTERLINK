import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consumeMdrrmoInvitationByToken } from '$lib/server/lgu-access-links';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| {
				token?: string;
				userId?: string;
				expectedRole?: 'mdrrmo_admin' | 'mdrrmo_staff' | 'bdrrmo';
		  }
		| null;

	const token = body?.token?.trim() ?? '';
	const userId = body?.userId?.trim() ?? '';
	const expectedRole = body?.expectedRole;

	if (!token || !userId) {
		return json({ error: 'Invitation token and user id are required.' }, { status: 400 });
	}

	try {
		await consumeMdrrmoInvitationByToken({ token, userId, expectedRole });
		return json({ ok: true });
	} catch (caught) {
		return json(
			{ error: caught instanceof Error ? caught.message : 'Unable to consume invitation.' },
			{ status: 400 }
		);
	}
};
