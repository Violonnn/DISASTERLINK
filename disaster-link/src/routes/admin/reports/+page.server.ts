import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	if (
		cookies.get('admin_gate_passed') !== 'true' ||
		cookies.get('admin_authenticated') !== 'true'
	) {
		throw redirect(303, '/admin');
	}
	return {
		pageTitle: 'Total Reports',
		pageDescription: ''
	};
};
