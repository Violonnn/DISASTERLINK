import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getValidMdrrmoInvitationByToken } from '$lib/server/lgu-access-links';

export const load: PageServerLoad = async ({ params }) => {
	const invitation = await getValidMdrrmoInvitationByToken(params.token);
	if (!invitation) {
		throw redirect(303, '/admin/login');
	}
	if (invitation.role !== 'mdrrmo_admin' && invitation.role !== 'mdrrmo_staff') {
		throw redirect(303, '/admin/login');
	}

	const target = `/signup/lgu-responder/municipal?invite=${encodeURIComponent(
		params.token
	)}&municipality=${encodeURIComponent(invitation.municipalityId)}`;
	throw redirect(303, target);
};
