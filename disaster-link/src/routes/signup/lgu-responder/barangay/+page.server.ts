import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getValidMdrrmoInvitationByToken } from '$lib/server/lgu-access-links';

export const load: PageServerLoad = async ({ url }) => {
	const inviteToken = url.searchParams.get('invite') ?? '';
	const municipalityIdFromQuery = url.searchParams.get('municipality') ?? '';

	if (!inviteToken) {
		throw error(403, 'Invitation link is required.');
	}

	const invitation = await getValidMdrrmoInvitationByToken(inviteToken);
	if (!invitation) {
		throw error(403, 'Invitation link is invalid or expired.');
	}
	if (invitation.role !== 'bdrrmo') {
		throw error(403, 'This invitation is not valid for BDRMMO registration.');
	}

	if (municipalityIdFromQuery && municipalityIdFromQuery !== invitation.municipalityId) {
		throw error(403, 'Invitation municipality mismatch.');
	}

	return {
		inviteToken,
		invitedMunicipalityId: invitation.municipalityId,
		invitedMunicipalityName: invitation.municipalityName,
		invitedRoleLabel: 'BDRMMO'
	};
};
