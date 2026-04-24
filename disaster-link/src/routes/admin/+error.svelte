<script lang="ts">
	import { page } from '$app/stores';

	// This reads the HTTP status and error details for the current failed route.
	let { status, error } = $props();

	// This keeps the title aligned with the current admin section when possible.
	const currentSection = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/admin/dashboard')) return 'Admin Dashboard';
		if (path.startsWith('/admin/users')) return 'All Users';
		if (path.startsWith('/admin/reports')) return 'Total Reports';
		if (path.startsWith('/admin/municipality')) return 'Municipality';
		return 'Admin Panel';
	});

	// This enforces the required 500-page message while keeping fallback text for other statuses.
	const displayMessage = $derived(
		status === 500 ? 'Please Restart the Page.' : error?.message || 'An unexpected error occurred.'
	);
</script>

<!-- This wraps the error state in the existing admin visual theme. -->
<div class="rounded-2xl border border-white/10 bg-[#0C212F]/65 p-6 backdrop-blur-md shadow-2xl sm:p-7">
	<p class="text-[11px] font-semibold tracking-[0.2em] text-[#dce7ef]">{currentSection}</p>
	<h2 class="mt-2 text-2xl font-semibold text-white">{status === 500 ? '500 Internal Error' : `${status} Error`}</h2>
	<p class="mt-2 text-sm text-[#d1dde7]">{displayMessage}</p>

	<!-- This gives users an immediate recovery action without leaving the admin area. -->
	<div class="mt-5">
		<button
			type="button"
			class="cursor-pointer rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
			onclick={() => window.location.reload()}
		>
			Restart Page
		</button>
	</div>
</div>
