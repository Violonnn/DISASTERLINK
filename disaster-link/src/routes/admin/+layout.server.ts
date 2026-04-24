import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

function isProtectedAdminRoute(pathname: string): boolean {
	return (
		pathname.startsWith('/admin/dashboard') ||
		pathname.startsWith('/admin/users') ||
		pathname.startsWith('/admin/reports') ||
		pathname.startsWith('/admin/municipality')
	);
}

export const load: LayoutServerLoad = async ({ cookies, url, setHeaders }) => {
	// Prevent browser back-cache from displaying protected admin pages after logout.
	setHeaders({
		'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
		Pragma: 'no-cache',
		Expires: '0'
	});

	if (!isProtectedAdminRoute(url.pathname)) {
		return {};
	}

	const hasGateAccess = cookies.get('admin_gate_passed') === 'true';
	const isAuthenticated = cookies.get('admin_authenticated') === 'true';
	if (!hasGateAccess || !isAuthenticated) {
		throw redirect(303, '/admin');
	}

	return {};
};
