<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { page } from '$app/stores';
	import { goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const municipalityInvalidateKey = $derived(`admin-municipality-detail:${data.municipalityId}`);

	let residentSearch = $state('');
	let residentBarangayFilter = $state('all');
	let residentStatusFilter = $state('all');
	let residentSortOrder = $state('recent');

	let inviteModalOpen = $state(false);
	let floatingToastMessage = $state('');
	let toastHideTimer: ReturnType<typeof setTimeout> | undefined;

	let inviteGenerating = $state(false);
	let revokingInvitationId = $state<string | null>(null);

	function showFloatingToast(message: string): void {
		if (toastHideTimer) clearTimeout(toastHideTimer);
		floatingToastMessage = message;
		toastHideTimer = setTimeout(() => {
			floatingToastMessage = '';
			toastHideTimer = undefined;
		}, 2600);
	}

	const availableBarangays = $derived.by(() => {
		const names = new Set<string>();
		for (const resident of data.residentAccounts) {
			if (resident.barangayName && resident.barangayName !== 'N/A') {
				names.add(resident.barangayName);
			}
		}
		return Array.from(names).sort((a, b) => a.localeCompare(b));
	});

	const filteredResidentAccounts = $derived.by(() => {
		const searchNeedle = residentSearch.trim().toLowerCase();
		const rows = data.residentAccounts.filter((resident) => {
			const matchesBarangay =
				residentBarangayFilter === 'all' || resident.barangayName === residentBarangayFilter;
			const matchesStatus =
				residentStatusFilter === 'all' || resident.status === residentStatusFilter;
			const matchesSearch =
				searchNeedle === '' ||
				resident.email.toLowerCase().includes(searchNeedle) ||
				resident.phone.toLowerCase().includes(searchNeedle);
			return matchesBarangay && matchesStatus && matchesSearch;
		});

		return [...rows].sort((a, b) => {
			const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
			const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
			return residentSortOrder === 'recent' ? bTime - aTime : aTime - bTime;
		});
	});

	async function copyInviteLink(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			showFloatingToast('Invite link copied');
		} catch {
			showFloatingToast('Could not copy — copy manually');
		}
	}

	function openInviteModal(): void {
		floatingToastMessage = '';
		if (toastHideTimer) clearTimeout(toastHideTimer);
		toastHideTimer = undefined;
		inviteModalOpen = true;
	}

	function closeInviteModal(): void {
		inviteModalOpen = false;
		floatingToastMessage = '';
		if (toastHideTimer) clearTimeout(toastHideTimer);
		toastHideTimer = undefined;
	}

	function afterCreateInvite(_input: { cancel: () => void }) {
		inviteGenerating = true;
		return async ({
			result
		}: {
			result: { type: string; data?: Record<string, unknown> };
		}) => {
			try {
				if (
					result.type === 'success' &&
					result.data?.createInviteOk === true &&
					typeof result.data.inviteUrl === 'string'
				) {
					try {
						await navigator.clipboard.writeText(result.data.inviteUrl);
						showFloatingToast('Invite link copied');
					} catch {
						showFloatingToast('Link generated — copy from the list');
					}
					inviteModalOpen = true;
					await invalidate(municipalityInvalidateKey);
				}
			} finally {
				inviteGenerating = false;
			}
		};
	}

	function afterRevokeInvite(invitationId: string) {
		return (opts: { cancel: () => void }) => {
			const ok = confirm(
				'Revoke this invite link? It will stop working immediately and cannot be undone.'
			);
			if (!ok) {
				opts.cancel();
				return;
			}
			revokingInvitationId = invitationId;
			return async ({
				result
			}: {
				result: { type: string; data?: Record<string, unknown> };
			}) => {
				try {
					if (result.type === 'success' && result.data?.revokeOk === true) {
						showFloatingToast('Invite link revoked');
						await invalidate(municipalityInvalidateKey);
					}
				} finally {
					revokingInvitationId = null;
				}
			};
		};
	}

	onMount(() => {
		const inviteFromUrl = $page.url.searchParams.get('invite');
		if (inviteFromUrl) {
			const decoded = decodeURIComponent(inviteFromUrl);
			void navigator.clipboard.writeText(decoded).then(() => {
				showFloatingToast('Invite link copied');
			});
			inviteModalOpen = true;
			void goto(`/admin/municipality/list/${data.municipalityId}`, { replaceState: true, noScroll: true });
		}
	});
</script>

<div class="space-y-6">
	<div class="rounded-2xl border border-white/15 bg-[#0C212F]/55 p-5 backdrop-blur-md shadow-2xl sm:p-6">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h2 class="text-lg font-semibold text-white">LGU Accounts</h2>
				<p class="mt-1 text-xs text-[#d1dde7]">
					All LGU accounts assigned to {data.municipalityName}, ordered by role priority.
				</p>
			</div>
			<div class="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
				{#if form?.error && !inviteModalOpen}
					<p class="max-w-xs text-right text-xs text-red-300">{form.error}</p>
				{/if}
				<button
					type="button"
					class="w-full cursor-pointer rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15 sm:w-auto"
					onclick={openInviteModal}
				>
					MDRRMO Admin Invite Link
				</button>
			</div>
		</div>

		<div class="mt-3 overflow-x-auto rounded-lg border border-white/10">
			<table class="min-w-full text-left text-xs text-white/90">
				<thead class="bg-white/10 text-[11px] text-white/70">
					<tr>
						<th class="px-3 py-2">Role</th>
						<th class="px-3 py-2">Name</th>
						<th class="px-3 py-2">Email</th>
						<th class="px-3 py-2">Phone</th>
						<th class="px-3 py-2">Created</th>
						<th class="px-3 py-2">Action</th>
					</tr>
				</thead>
				<tbody>
					{#if data.lguAccounts.length === 0}
						<tr>
							<td colspan="6" class="px-3 py-3 text-white/70">No LGU accounts in this municipality.</td>
						</tr>
					{:else}
						{#each data.lguAccounts as account}
							<tr class="border-t border-white/10">
								<td class="px-3 py-2">{account.displayRole}</td>
								<td class="px-3 py-2">{account.fullName}</td>
								<td class="px-3 py-2">{account.email}</td>
								<td class="px-3 py-2">{account.phone}</td>
								<td class="px-3 py-2">{account.createdAt ? new Date(account.createdAt).toLocaleString() : 'N/A'}</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-1.5">
										<button type="button" aria-label={`Open ${account.fullName} details`} title="User details" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/25 bg-white/10 text-sm text-white/90 transition hover:bg-white/20">
											...
										</button>
										<button type="button" aria-label={`Delete ${account.fullName}`} title="Delete user" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300/45 bg-red-500/10 text-white/90 transition hover:bg-red-500/20">
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
	</div>

	<div class="rounded-2xl border border-white/15 bg-[#0C212F]/55 p-5 backdrop-blur-md shadow-2xl sm:p-6">
		<h2 class="text-lg font-semibold text-white">Resident Accounts</h2>
		<p class="mt-1 text-xs text-[#d1dde7]">
			Resident records include account id, masked contact details, barangay, and status.
		</p>

		<div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
			<div class="relative">
				<div class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						class="h-3.5 w-3.5 text-white/60"
					>
						<circle cx="11" cy="11" r="7"></circle>
						<path stroke-linecap="round" stroke-linejoin="round" d="M20 20l-3.5-3.5"></path>
					</svg>
				</div>
				<input
					type="text"
					bind:value={residentSearch}
					placeholder="Search email or phone"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
			</div>
			<select
				bind:value={residentBarangayFilter}
				class="rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
			>
				<option value="all">All barangays</option>
				{#each availableBarangays as barangay}
					<option value={barangay}>{barangay}</option>
				{/each}
			</select>
			<select
				bind:value={residentStatusFilter}
				class="rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
			>
				<option value="all">All statuses</option>
				<option value="Verified">Verified</option>
				<option value="Pending Verification">Pending Verification</option>
			</select>
			<select
				bind:value={residentSortOrder}
				class="rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#768391]"
			>
				<option value="recent">Created (recent to oldest)</option>
				<option value="oldest">Created (oldest to recent)</option>
			</select>
		</div>

		<div class="mt-3 overflow-x-auto rounded-lg border border-white/10">
			<table class="min-w-full text-left text-xs text-white/90">
				<thead class="bg-white/10 text-[11px] text-white/70">
					<tr>
						<th class="px-3 py-2">Account ID</th>
						<th class="px-3 py-2">Email</th>
						<th class="px-3 py-2">Phone</th>
						<th class="px-3 py-2">Barangay</th>
						<th class="px-3 py-2">Status</th>
						<th class="px-3 py-2">Created</th>
						<th class="px-3 py-2">Action</th>
					</tr>
				</thead>
				<tbody>
					{#if filteredResidentAccounts.length === 0}
						<tr>
							<td colspan="7" class="px-3 py-3 text-white/70">No resident accounts matched your filters.</td>
						</tr>
					{:else}
						{#each filteredResidentAccounts as resident}
							<tr class="border-t border-white/10">
								<td class="px-3 py-2 font-mono text-[11px]">{resident.accountId}</td>
								<td class="px-3 py-2">{resident.maskedEmail}</td>
								<td class="px-3 py-2">{resident.maskedPhone}</td>
								<td class="px-3 py-2">{resident.barangayName}</td>
								<td class="px-3 py-2">{resident.status}</td>
								<td class="px-3 py-2">{resident.createdAt ? new Date(resident.createdAt).toLocaleString() : 'N/A'}</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-1.5">
										<button type="button" aria-label={`Open ${resident.accountId} details`} title="User details" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/25 bg-white/10 text-sm text-white/90 transition hover:bg-white/20">
											...
										</button>
										<button type="button" aria-label={`Delete ${resident.accountId}`} title="Delete user" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-300/45 bg-red-500/10 text-white/90 transition hover:bg-red-500/20">
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
	</div>
</div>

{#if inviteModalOpen}
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && closeInviteModal()}
		onkeydown={(e) => e.key === 'Escape' && closeInviteModal()}
		tabindex="-1"
	>
		<div
			class="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#0C212F] p-5 shadow-2xl"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="invite-modal-title"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			{#if floatingToastMessage}
				<div
					class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8"
					aria-live="polite"
				>
					<div
						class="max-w-[90%] rounded-xl border border-white/20 bg-[#1B2E3A]/95 px-5 py-3 text-center text-sm font-medium text-white shadow-xl backdrop-blur-sm"
						transition:fade={{ duration: 160 }}
					>
						{floatingToastMessage}
					</div>
				</div>
			{/if}

			<div class="flex items-start justify-between gap-3">
				<h2 id="invite-modal-title" class="text-lg font-semibold text-white">MDRRMO Admin invitations</h2>
				<button
					type="button"
					class="shrink-0 rounded-lg border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
					onclick={closeInviteModal}
				>
					Close
				</button>
			</div>

			{#if form?.error}
				<p class="mt-2 text-xs text-red-300">{form.error}</p>
			{/if}

			<form method="POST" action="?/createMdrrmoInviteLink" class="mt-4" use:enhance={afterCreateInvite}>
				<button
					type="submit"
					disabled={inviteGenerating}
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if inviteGenerating}
						<svg
							class="h-4 w-4 shrink-0 animate-spin text-white/90"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
						<span>Generating…</span>
					{:else}
						<span>Generate MDRRMO Admin Link</span>
					{/if}
				</button>
			</form>

			<p class="mt-3 text-xs text-[#d1dde7]">
				Active links are unused and valid within 24 hours. Revoke a link to cancel it early.
			</p>

			{#if data.mdrrmoInvitations.length === 0}
				<p class="mt-4 text-center text-sm text-white/60">No active invite links.</p>
			{:else}
				<ul class="mt-4 space-y-3">
					{#each data.mdrrmoInvitations as invite}
						<li class="rounded-lg border border-white/15 bg-white/5 p-3">
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
								<input
									readonly
									value={invite.url}
									class="min-w-0 flex-1 rounded border border-white/15 bg-[#0C212F]/60 px-2 py-1.5 text-[11px] text-white"
								/>
								<button
									type="button"
									disabled={revokingInvitationId !== null}
									class="shrink-0 cursor-pointer rounded border border-white/25 bg-white/10 px-2 py-1.5 text-[11px] text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
									onclick={() => copyInviteLink(invite.url)}
								>
									Copy
								</button>
							</div>
							<div class="mt-2 flex items-center justify-between text-[10px] text-white/60">
								<span>Expires: {new Date(invite.expiresAt).toLocaleString()}</span>
								{#if invite.isRevoked}
									<span class="text-red-300">Revoked</span>
								{:else}
									<form method="POST" action="?/revokeMdrrmoInviteLink" use:enhance={afterRevokeInvite(invite.id)}>
										<input type="hidden" name="invitationId" value={invite.id} />
										<button
											type="submit"
											disabled={revokingInvitationId !== null}
											class="flex cursor-pointer items-center gap-1.5 text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
										>
											{#if revokingInvitationId === invite.id}
												<svg
													class="h-3 w-3 shrink-0 animate-spin"
													xmlns="http://www.w3.org/2000/svg"
													fill="none"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<circle
														class="opacity-25"
														cx="12"
														cy="12"
														r="10"
														stroke="currentColor"
														stroke-width="4"
													></circle>
													<path
														class="opacity-75"
														fill="currentColor"
														d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
													></path>
												</svg>
												<span>Revoking…</span>
											{:else}
												<span>Revoke</span>
											{/if}
										</button>
									</form>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
{/if}
