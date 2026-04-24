<script lang="ts">
	import { navigating } from '$app/stores';

	let { data, form } = $props();
	let deleteTarget: { id: string; name: string } | null = $state(null);
	let confirmationText = $state('');

	const visibleMunicipalities = $derived(data.municipalitySummaries);
	const pageNumbers = $derived.by(() =>
		Array.from({ length: data.pagination.totalPages }, (_, index) => index + 1)
	);
	const isLoadingList = $derived.by(() => {
		const targetPath = $navigating?.to?.url?.pathname ?? '';
		return targetPath === '/admin/municipality/list';
	});

	// This builds pagination links while preserving current search and sort query params.
	function buildPageHref(pageNumber: number): string {
		const params = new URLSearchParams();
		params.set('page', String(pageNumber));
		if (data.filters.search) {
			params.set('search', data.filters.search);
		}
		if (data.filters.sort && data.filters.sort !== 'alphabetical') {
			params.set('sort', data.filters.sort);
		}
		return `/admin/municipality/list?${params.toString()}`;
	}
</script>

<div class="rounded-2xl border border-white/10 bg-[#0C212F]/65 p-5 backdrop-blur-md shadow-2xl sm:p-6">
	{#if form?.deleteError}
		<p class="mb-3 rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{form.deleteError}</p>
	{/if}
	{#if form?.deleteSuccess}
		<p class="mb-3 rounded-lg border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{form.deleteSuccess}</p>
	{/if}
	{#if isLoadingList}
		<div class="rounded-lg border border-white/15 bg-white/5 px-4 py-8 text-center">
			<p class="text-sm text-white/80">Loading municipalities...</p>
		</div>
	{:else}
		<form method="GET" class="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
			<div class="relative">
				<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/70">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						class="h-3.5 w-3.5"
					>
						<circle cx="11" cy="11" r="7" />
						<path d="m20 20-3.5-3.5" />
					</svg>
				</span>
				<input
					type="text"
					name="search"
					value={data.filters.search}
					placeholder="Search municipality name"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 py-2 pl-9 pr-3 text-xs text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
			</div>
			<label for="sortMunicipalityList" class="text-xs font-semibold text-white/85">Sort by</label>
			<div class="relative rounded-lg border border-[#768391]/55 bg-[#0F2A3B] shadow-[0_0_0_1px_rgba(118,131,145,0.12)]">
				<select
					id="sortMunicipalityList"
					name="sort"
					onchange={(event) => event.currentTarget.form?.requestSubmit()}
					class="w-full min-w-[11rem] appearance-none rounded-lg bg-transparent px-3 py-2 pr-8 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
				>
					<option class="bg-[#0F2A3B] text-white" value="alphabetical" selected={data.filters.sort === 'alphabetical'}
						>A-Z</option
					>
					<option class="bg-[#0F2A3B] text-white" value="latest" selected={data.filters.sort === 'latest'}
						>Latest Created</option
					>
					<option class="bg-[#0F2A3B] text-white" value="oldest" selected={data.filters.sort === 'oldest'}
						>Oldest Created</option
					>
				</select>
				<span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-white/75">
					▼
				</span>
			</div>
		</form>

		<div class="overflow-x-auto rounded-lg border border-white/15">
			<table class="min-w-full text-left text-xs text-white/90">
				<thead class="bg-white/10 text-[11px] text-white/70">
					<tr>
						<th class="px-3 py-2">Municipality Name</th>
						<th class="px-3 py-2">Total Barangay</th>
						<th class="px-3 py-2">Total Users</th>
						<th class="px-3 py-2">Total Reports</th>
						<th class="px-3 py-2 text-right"> </th>
					</tr>
				</thead>
				<tbody>
					{#if visibleMunicipalities.length === 0}
						<tr>
							<td colspan="5" class="px-3 py-4 text-center text-white/70">
								No municipalities found.
							</td>
						</tr>
					{:else}
						{#each visibleMunicipalities as municipality}
							<tr class="border-t border-white/10 hover:bg-white/10">
								<td class="px-3 py-2">
									<a
										href={`/admin/municipality/list/${municipality.id}`}
										class="font-semibold text-white hover:underline"
									>
										{municipality.name}
									</a>
								</td>
								<td class="px-3 py-2">{municipality.totalBarangays}</td>
								<td class="px-3 py-2">{municipality.totalUsers}</td>
								<td class="px-3 py-2">{municipality.totalReports}</td>
								<td class="px-3 py-2 text-right">
									<a
										href={`/admin/municipality/list/${municipality.id}`}
										aria-label={`Open ${municipality.name} details`}
										class="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/25 bg-white/10 text-sm text-white/90 transition hover:bg-white/20"
									>
										...
									</a>
									<button
										type="button"
										aria-label={`Delete ${municipality.name}`}
										class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-red-300/45 bg-red-500/10 text-white/90 transition hover:bg-red-500/20"
										onclick={() => {
											deleteTarget = { id: municipality.id, name: municipality.name };
											confirmationText = '';
										}}
									>
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-3.5 w-3.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2m-7 4v7m4-7v7M6 6l1 14h10l1-14" />
										</svg>
									</button>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>

		{#if data.pagination.totalPages > 1}
			<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
				{#each pageNumbers as pageNumber}
					<a
						href={buildPageHref(pageNumber)}
						class={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
							pageNumber === data.pagination.currentPage
								? 'border-white/35 bg-white/20 text-white'
								: 'border-white/20 bg-white/5 text-white/85 hover:bg-white/10'
						}`}
					>
						{pageNumber}
					</a>
				{/each}
			</div>
		{/if}
	{/if}
</div>

{#if deleteTarget}
	<div class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
		<div class="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0C212F]/95 p-5 shadow-2xl">
			<h3 class="text-lg font-semibold text-white">Delete Municipality</h3>
			<p class="mt-2 text-xs text-[#d1dde7]">
				Deleting <span class="font-semibold text-white">{deleteTarget.name}</span> also deletes all LGU accounts under this municipality.
			</p>
			<p class="mt-2 text-xs text-red-200">
				To confirm, type <span class="font-semibold text-white">{deleteTarget.name.toLowerCase()}</span> exactly.
			</p>
			<form method="POST" action="?/deleteMunicipality" class="mt-4 space-y-3">
				<input type="hidden" name="municipalityId" value={deleteTarget.id} />
				<input type="hidden" name="municipalityName" value={deleteTarget.name} />
				<input
					type="text"
					name="confirmationText"
					bind:value={confirmationText}
					placeholder="Type municipality name in lowercase"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="cursor-pointer rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/15"
						onclick={() => {
							deleteTarget = null;
							confirmationText = '';
						}}
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={confirmationText !== deleteTarget.name.toLowerCase()}
						class="cursor-pointer rounded-lg border border-red-300/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Delete Municipality
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
