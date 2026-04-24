import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Municipality management now lives under /admin/municipality/list/[id].
export const load: PageServerLoad = async ({ params }) => {
	throw redirect(301, `/admin/municipality/list/${params.id}`);
};
