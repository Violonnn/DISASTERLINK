<script lang="ts">
	import { page } from '$app/stores';
	import { navigating } from '$app/stores';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { pageTitle?: string; pageDescription?: string }; children: Snippet } =
		$props();

	const isPanelRoute = $derived.by(() => {
		const path = $page.url.pathname;
		return (
			path.startsWith('/admin/dashboard') ||
			path.startsWith('/admin/users') ||
			path.startsWith('/admin/reports') ||
			path.startsWith('/admin/municipality')
		);
	});

	const isMunicipalityRoute = $derived($page.url.pathname.startsWith('/admin/municipality'));

	const headerTitle = $derived.by(() => {
		const fromPage = $page.data.pageTitle as string | undefined;
		if (fromPage) return fromPage;
		const path = $page.url.pathname;
		if (path.startsWith('/admin/dashboard')) return 'Admin Dashboard';
		if (path.startsWith('/admin/users')) return 'All Users';
		if (path.startsWith('/admin/reports')) return 'Total Reports';
		if (path.startsWith('/admin/municipality/create')) return 'Create Municipal URL';
		if (path.startsWith('/admin/municipality/list')) return 'List of Municipalities';
		return 'Admin Panel';
	});

	const headerDescription = $derived.by(() => {
		const fromPage = $page.data.pageDescription;
		if (fromPage !== undefined) return String(fromPage);
		const path = $page.url.pathname;
		if (path.startsWith('/admin/dashboard')) return 'Monitor users, municipalities, and reports in one place.';
		if (path.startsWith('/admin/users')) return 'Filter and review user records across the platform.';
		if (path.startsWith('/admin/reports')) return '';
		if (path.startsWith('/admin/municipality/create'))
			return 'Create a password-protected municipality URL for LGU access.';
		if (path.startsWith('/admin/municipality/list'))
			return 'Select a municipality to open its dedicated management page.';
		return 'Manage platform administration features.';
	});

	const showRouteLoading = $derived.by(() => {
		const target = $navigating?.to?.url?.pathname ?? '';
		return target.startsWith('/admin');
	});
</script>

{#if !isPanelRoute}
	{@render children()}
{:else}
	<div class="min-h-screen bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] p-4 sm:p-6">
		{#if showRouteLoading}
			<div class="fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-white/10">
				<div class="h-full w-1/3 animate-[adminRouteLoad_1s_ease-in-out_infinite] bg-[#dce7ef]"></div>
			</div>
		{/if}
		<div class="mx-auto flex w-full max-w-7xl gap-4 lg:h-[calc(100vh-3rem)]">
			<aside class="hidden w-60 shrink-0 rounded-2xl border border-white/10 bg-[#0C212F]/65 p-4 backdrop-blur-md shadow-2xl lg:block lg:h-full lg:overflow-hidden">
				<p class="text-[11px] tracking-[0.2em] text-[#dce7ef] font-semibold">DISASTERLINK</p>
				<p class="mt-3 text-xs font-semibold text-white/70">ADMIN NAVIGATION</p>
				<nav class="mt-3 space-y-1.5 text-sm">
					<a
						href="/admin/dashboard"
						class={`block rounded-lg px-3 py-2 transition ${
							$page.url.pathname.startsWith('/admin/dashboard')
								? 'bg-white/15 text-white'
								: 'text-white/80 hover:bg-white/10'
						}`}
					>
						Dashboard
					</a>

					<details class="rounded-lg px-1 py-1 text-white/80 transition open:bg-white/10" open={isMunicipalityRoute}>
						<summary class="list-none">
							<div class="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 hover:bg-white/10">
								<span>Municipality</span>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
								</svg>
							</div>
						</summary>
						<div class="mt-1 space-y-1 pl-2">
							<a
								href="/admin/municipality/create"
								class={`block rounded-lg px-2 py-1.5 text-xs transition ${
									$page.url.pathname === '/admin/municipality/create'
										? 'bg-white/15 text-white'
										: 'text-white/80 hover:bg-white/10'
								}`}
							>
								Create Municipal URL
							</a>
							<a
								href="/admin/municipality/list"
								class={`block rounded-lg px-2 py-1.5 text-xs transition ${
									$page.url.pathname.startsWith('/admin/municipality/list')
										? 'bg-white/15 text-white'
										: 'text-white/80 hover:bg-white/10'
								}`}
							>
								List of Municipalities
							</a>
						</div>
					</details>

					<a
						href="/admin/users"
						class={`block rounded-lg px-3 py-2 transition ${
							$page.url.pathname.startsWith('/admin/users')
								? 'bg-white/15 text-white'
								: 'text-white/80 hover:bg-white/10'
						}`}
					>
						Users
					</a>
					<a
						href="/admin/reports"
						class={`block rounded-lg px-3 py-2 transition ${
							$page.url.pathname.startsWith('/admin/reports')
								? 'bg-white/15 text-white'
								: 'text-white/80 hover:bg-white/10'
						}`}
					>
						Reports
					</a>
				</nav>

				<form method="POST" action="/admin/dashboard?/logoutAdmin" class="mt-6">
					<button
						type="submit"
						class="w-full cursor-pointer rounded-lg border border-white/25 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
					>
						Log out
					</button>
				</form>
			</aside>

			<main class="min-w-0 flex-1 space-y-4 lg:h-full lg:overflow-y-auto">
				<div class="rounded-2xl border border-white/10 bg-[#0C212F]/65 p-4 backdrop-blur-md shadow-2xl sm:p-5">
					<h1 class="text-2xl font-semibold text-white">{headerTitle}</h1>
					{#if headerDescription}
						<p class="mt-1 text-sm text-[#d1dde7]">{headerDescription}</p>
					{/if}
				</div>
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<style>
	@keyframes adminRouteLoad {
		0% {
			transform: translateX(-120%);
		}
		100% {
			transform: translateX(420%);
		}
	}
</style>
