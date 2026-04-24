import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// This route is intentionally unavailable to enforce invite-only LGU registration.
	throw error(404, 'Page not found.');
};
