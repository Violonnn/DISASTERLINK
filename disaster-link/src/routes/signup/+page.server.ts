import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// /signup is now the resident signup — redirect immediately
export const load: PageServerLoad = () => {
    throw redirect(308, '/signup/resident');
};
