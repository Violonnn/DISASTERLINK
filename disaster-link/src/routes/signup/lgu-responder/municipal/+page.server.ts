import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getValidMdrrmoInvitationByToken, listLguAccessLinks } from '$lib/server/lgu-access-links';

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
	if (invitation.role !== 'mdrrmo_admin' && invitation.role !== 'mdrrmo_staff') {
		throw error(403, 'This invitation is not valid for municipal registration.');
	}

	if (municipalityIdFromQuery && municipalityIdFromQuery !== invitation.municipalityId) {
		throw error(403, 'Invitation municipality mismatch.');
	}

	// This resolves the municipality slug so email confirmation returns to municipality-scoped login.
	const links = await listLguAccessLinks();
	const matchedLink = links.find(
		(link) =>
			link.municipalityName.trim().toLowerCase() ===
			invitation.municipalityName.trim().toLowerCase()
	);

	return {
		inviteToken,
		invitedMunicipalityId: invitation.municipalityId,
		invitedMunicipalityName: invitation.municipalityName,
		invitedMunicipalitySlug: matchedLink?.slug ?? '',
		invitedRole: invitation.role,
		invitedRoleLabel: invitation.role === 'mdrrmo_admin' ? 'MDRMMO Admin' : 'MDRMMO Staff'
	};
};
