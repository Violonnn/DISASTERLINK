<script lang="ts">
	let { data } = $props();

	const pageNumbers = $derived.by(() =>
		Array.from({ length: data.pagination.totalPages }, (_, index) => index + 1)
	);

	function buildPageHref(pageNumber: number): string {
		const params = new URLSearchParams();
		params.set('page', String(pageNumber));
		params.set('status', data.filters.status);
		params.set('users', data.filters.users);
		params.set('sort', data.filters.sort);
		if (data.filters.search) {
			params.set('search', data.filters.search);
		}
		return `/admin/users?${params.toString()}`;
	}
</script>

<div class="space-y-4">
	<div class="rounded-2xl border border-white/15 bg-[#0C212F]/55 p-5 backdrop-blur-md shadow-2xl sm:p-6">
		<form method="GET" class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto] xl:items-center">
			<div class="relative">
				<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/70">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-3.5 w-3.5">
						<circle cx="11" cy="11" r="7" />
						<path d="m20 20-3.5-3.5" />
					</svg>
				</span>
				<input
					type="text"
					name="search"
					value={data.filters.search}
					placeholder="Search by name or email"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 py-2 pl-9 pr-3 text-xs text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
			</div>
			<div class="flex items-center gap-2">
				<label for="usersSort" class="text-xs font-semibold text-white/85">Sort by</label>
				<select
					id="usersSort"
					name="sort"
					onchange={(event) => event.currentTarget.form?.requestSubmit()}
					class="rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
				>
					<option value="a-z" selected={data.filters.sort === 'a-z'}>A-Z</option>
					<option value="latest" selected={data.filters.sort === 'latest'}>Latest Created</option>
					<option value="oldest" selected={data.filters.sort === 'oldest'}>Oldest Created</option>
				</select>
			</div>
			<select
				name="status"
				onchange={(event) => event.currentTarget.form?.requestSubmit()}
				class="rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
			>
				<option value="verified" selected={data.filters.status === 'verified'}>Verified</option>
				<option value="pending" selected={data.filters.status === 'pending'}>Pending</option>
			</select>
			<select
				name="users"
				onchange={(event) => event.currentTarget.form?.requestSubmit()}
				class="rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
			>
				<option value="all" selected={data.filters.users === 'all'}>All Users</option>
				<option value="resident" selected={data.filters.users === 'resident'}>Residents</option>
				<option value="mdrrmo_admin" selected={data.filters.users === 'mdrrmo_admin'}>MDRRMO Admin</option>
				<option value="mdrrmo_staff" selected={data.filters.users === 'mdrrmo_staff'}>MDRRMO Staff</option>
				<option value="mayor" selected={data.filters.users === 'mayor'}>Mayor</option>
				<option value="bdrrmo" selected={data.filters.users === 'bdrrmo'}>BDRRMO</option>
			</select>
		</form>
	</div>

	<div class="rounded-2xl border border-white/15 bg-[#0C212F]/55 p-5 backdrop-blur-md shadow-2xl sm:p-6">
			<div class="overflow-x-auto rounded-lg border border-white/10">
				<table class="min-w-full text-left text-xs text-white/90">
					<thead class="bg-white/10 text-[11px] text-white/70">
						<tr>
							<th class="px-3 py-2">Name</th>
							<th class="px-3 py-2">Email</th>
							<th class="px-3 py-2">Phone</th>
							<th class="px-3 py-2">Role</th>
							<th class="px-3 py-2">Municipality</th>
							<th class="px-3 py-2">Barangay</th>
							<th class="px-3 py-2">Status</th>
							<th class="px-3 py-2">Created</th>
							<th class="px-3 py-2 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#if data.users.length === 0}
							<tr>
								<td colspan="9" class="px-3 py-3 text-white/70">No users matched this filter.</td>
							</tr>
						{:else}
							{#each data.users as user}
								<tr class="border-t border-white/10">
									<td class="px-3 py-2">{user.name}</td>
									<td class="px-3 py-2">{user.email}</td>
									<td class="px-3 py-2">{user.phone}</td>
									<td class="px-3 py-2">{user.role}</td>
									<td class="px-3 py-2">{user.municipalityName}</td>
									<td class="px-3 py-2">{user.barangayName}</td>
									<td class="px-3 py-2">{user.status}</td>
									<td class="px-3 py-2">{user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A'}</td>
									<td class="px-3 py-2 text-right">
										<div class="flex items-center justify-end gap-1.5">
											<button type="button" aria-label={`Open ${user.name} details`} title="User details" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/25 bg-white/10 text-sm text-white/90 transition hover:bg-white/20">
												...
											</button>
											<button type="button" aria-label={`Delete ${user.name}`} title="Delete user" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300/45 bg-red-500/10 text-white/90 transition hover:bg-red-500/20">
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-3.5 w-3.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2m-7 4v7m4-7v7M6 6l1 14h10l1-14" />
												</svg>
											</button>
										</div>
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
	</div>
</div>
