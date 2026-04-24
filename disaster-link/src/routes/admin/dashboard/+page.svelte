<script lang="ts">
	let { data } = $props();

	const userTotal = $derived(data.dashboardSummary.totalUsers || 0);
	const pendingPercent = $derived(userTotal > 0 ? (data.dashboardSummary.pendingUsers / userTotal) * 100 : 0);
	const verifiedPercent = $derived(userTotal > 0 ? (data.dashboardSummary.verifiedUsers / userTotal) * 100 : 0);
</script>

<div class="space-y-5">
	<div class="rounded-2xl border border-white/10 bg-[#0C212F]/65 p-6 backdrop-blur-md shadow-2xl sm:p-7">
				<h2 class="text-xl font-semibold text-white">Summary Analytics</h2>
				<p class="mt-1 text-sm text-[#d1dde7]">Quick navigation and live platform metrics across users, municipalities, and reports.</p>

				<div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				<div class="rounded-xl border border-white/15 bg-white/5 p-5 sm:col-span-2 xl:col-span-1">
					<p class="text-xs text-white/65">Total Users</p>
					<div class="mt-3 flex items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-5 w-5 text-white/80">
								<path stroke-linecap="round" stroke-linejoin="round" d="M16 11c1.7 0 3-1.6 3-3.5S17.7 4 16 4s-3 1.6-3 3.5 1.3 3.5 3 3.5zM8 11c1.7 0 3-1.6 3-3.5S9.7 4 8 4 5 5.6 5 7.5 6.3 11 8 11zM3 19c0-2.2 2.2-4 5-4s5 1.8 5 4M13 19c.4-1.8 2.2-3 4.5-3 2.8 0 4.5 1.7 4.5 4" />
							</svg>
							<p class="text-3xl font-semibold text-white">{data.dashboardSummary.totalUsers}</p>
						</div>
						<div class="flex items-end gap-4">
							<a href="/admin/users?status=pending" class="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 transition hover:bg-white/10">
								<span class="text-[10px] font-semibold uppercase tracking-wide text-white/70">Pending</span>
								<div class="flex items-end gap-1.5">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" class="h-4 w-4 text-white/75">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<div class="flex h-14 w-3 items-end rounded-sm bg-white/10">
									<div class="w-full rounded-sm bg-[#768391]" style={`height: ${pendingPercent}%`}></div>
								</div>
								<span class="text-xs font-semibold text-white">{data.dashboardSummary.pendingUsers}</span>
								</div>
							</a>
							<a href="/admin/users?status=verified" class="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 transition hover:bg-white/10">
								<span class="text-[10px] font-semibold uppercase tracking-wide text-white/70">Verified</span>
								<div class="flex items-end gap-1.5">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" class="h-4 w-4 text-white/75">
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
								<div class="flex h-14 w-3 items-end rounded-sm bg-white/10">
									<div class="w-full rounded-sm bg-[#9fb6c7]" style={`height: ${verifiedPercent}%`}></div>
								</div>
								<span class="text-xs font-semibold text-white">{data.dashboardSummary.verifiedUsers}</span>
								</div>
							</a>
						</div>
					</div>
				</div>
				<a
					href="/admin/municipality/list"
					class="rounded-xl border border-white/15 bg-white/5 px-5 py-4 text-left transition hover:bg-white/10"
				>
					<div class="flex items-center gap-2">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4 text-white/75">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V8l5-3v16M14 21V4l5 2v15M8 10h.01M8 13h.01M8 16h.01M17 9h.01M17 12h.01M17 15h.01" />
						</svg>
						<p class="text-xs text-white/65">Total Municipalities</p>
					</div>
					<p class="mt-2 text-2xl font-semibold text-white">{data.dashboardSummary.totalMunicipalities}</p>
				</a>
				<a
					href="/admin/reports"
					class="rounded-xl border border-white/15 bg-white/5 px-5 py-4 transition hover:bg-white/10"
				>
					<div class="flex items-center gap-2">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4 text-white/75">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8M8 11h8M8 15h5M6 3h9l3 3v15H6z" />
						</svg>
						<p class="text-xs text-white/65">Total Reports</p>
					</div>
					<p class="mt-2 text-2xl font-semibold text-white">{data.dashboardSummary.totalReports}</p>
				</a>
				</div>
	</div>

</div>
