<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let municipalityName = $state('');
	let municipalityPassword = $state('');
	let createErrorMessage = $state('');
	let isCreatingUrl = $state(false);
	let showCreatedUrlModal = $state(false);
	let copiedRecentUrlId = $state<string | null>(null);
	let copiedFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
	let copiedCreatedUrl = $state(false);
	let copiedCreatedUrlTimeout: ReturnType<typeof setTimeout> | null = null;

	// This validates only when submit is clicked (no live validation while typing).
	function getCreateFormError(): string {
		if (!municipalityName.trim() && !municipalityPassword) return 'Municipality and password required';
		if (!municipalityName.trim()) return 'Municipality required';
		if (!municipalityPassword) return 'Password required';
		if (municipalityPassword.trim().length < 4) return 'Password must be at least 4 characters.';
		if (municipalityPassword.length > 128) return 'Password is too long.';
		return '';
	}

	// This keeps the list fixed to the 5 most recently created municipality URLs.
	const recentCreatedUrls = $derived.by(() => {
		const sortedUrls = [...data.createdMunicipalityUrls].sort((a, b) => {
			const aTime = Date.parse(a.createdAt);
			const bTime = Date.parse(b.createdAt);
			return bTime - aTime;
		});
		return sortedUrls.slice(0, 5);
	});

	$effect(() => {
		if (form?.createdUrl) {
			showCreatedUrlModal = true;
		}
	});

	// This synchronizes submit state after server action responses.
	$effect(() => {
		if (form?.error) {
			isCreatingUrl = false;
			municipalityName = form.municipalityName ?? municipalityName;
			createErrorMessage = form.error;
		}
		if (form?.success) {
			isCreatingUrl = false;
			municipalityPassword = '';
			municipalityName = '';
			createErrorMessage = '';
		}
	});

	function onCreateSubmit(event: SubmitEvent): void {
		const nextError = getCreateFormError();
		createErrorMessage = nextError;
		if (nextError) {
			isCreatingUrl = false;
			event.preventDefault();
			return;
		}
		isCreatingUrl = true;
	}

	// This keeps the button in loading state while the action request is running.
	function enhanceCreateMunicipalityUrl() {
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			isCreatingUrl = false;
		};
	}

	function copyText(value: string): void {
		navigator.clipboard.writeText(value);
	}

	// This shows short feedback after copying a URL from the recent list.
	function copyRecentUrl(url: string, urlId: string): void {
		copyText(url);
		copiedRecentUrlId = urlId;
		if (copiedFeedbackTimeout) {
			clearTimeout(copiedFeedbackTimeout);
		}
		copiedFeedbackTimeout = setTimeout(() => {
			copiedRecentUrlId = null;
		}, 1800);
	}

	// This shows confirmation text when the modal URL copy button is clicked.
	function copyCreatedUrl(url: string): void {
		copyText(url);
		copiedCreatedUrl = true;
		if (copiedCreatedUrlTimeout) {
			clearTimeout(copiedCreatedUrlTimeout);
		}
		copiedCreatedUrlTimeout = setTimeout(() => {
			copiedCreatedUrl = false;
		}, 1800);
	}
</script>

<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
	<div class="rounded-2xl border border-white/10 bg-[#0C212F]/65 p-5 backdrop-blur-md shadow-2xl sm:p-6">
		<h2 class="text-lg font-semibold text-white">Municipal URL Form</h2>
		<p class="mt-1 text-xs text-[#d1dde7]">Enter municipality details to generate a protected LGU URL.</p>

		{#if form?.success}
			<p class="mt-3 text-xs text-emerald-300">{form.success}</p>
		{/if}
		<form
			method="POST"
			action="?/createMunicipalityUrl"
			class="mt-4 space-y-3"
			use:enhance={enhanceCreateMunicipalityUrl}
			onsubmit={onCreateSubmit}
		>
			<div>
				<label for="municipalityName" class="block text-xs text-[#d1dde7] mb-1.5">Municipality name</label>
				<input
					id="municipalityName"
					name="municipalityName"
					type="text"
					bind:value={municipalityName}
					placeholder="e.g. Minglanilla"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
			</div>
			<div>
				<label for="municipalityPassword" class="block text-xs text-[#d1dde7] mb-1.5">URL password</label>
				<input
					id="municipalityPassword"
					name="password"
					type="password"
					bind:value={municipalityPassword}
					placeholder="Set LGU access password"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
				{#if createErrorMessage}
					<p class="mt-1.5 text-xs text-red-300">{createErrorMessage}</p>
				{/if}
			</div>
			<button
				type="submit"
				class="w-full cursor-pointer rounded-lg border border-white/30 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
				disabled={isCreatingUrl}
			>
				{isCreatingUrl ? 'Generating URL...' : 'Generate URL'}
			</button>
		</form>
	</div>

	<div class="rounded-2xl border border-white/10 bg-[#0C212F]/65 p-5 backdrop-blur-md shadow-2xl sm:p-6">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-lg font-semibold text-white">Recently Created URL</h2>
		</div>

		<div class="mt-3 space-y-1.5">
			{#if recentCreatedUrls.length === 0}
				<p class="text-xs text-white/70">No created municipality URLs found.</p>
			{:else}
				{#each recentCreatedUrls as item}
					<div class="rounded-lg border border-white/15 bg-white/5 px-2 py-1">
						<p class="text-[11px] font-semibold text-white">{item.municipalityName}</p>
						<p class="mt-px break-all text-[10px] leading-tight text-white/75">{item.url}</p>
						<div class="mt-0.5 flex items-center justify-between">
							<p class="text-[10px] text-white/60">{new Date(item.createdAt).toLocaleString()}</p>
							<button
								type="button"
								class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 text-white transition hover:bg-white/20"
								aria-label="Copy URL link"
								title="Copy URL link"
								onclick={() => copyRecentUrl(item.url, item.id)}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.7"
									class="h-3.5 w-3.5"
								>
									<rect x="9" y="9" width="10" height="10" rx="2" />
									<path d="M5 15V7a2 2 0 0 1 2-2h8" />
								</svg>
							</button>
						</div>
						{#if copiedRecentUrlId === item.id}
							<p class="mt-1 text-right text-[10px] font-medium text-emerald-300">URL Link Copied</p>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

{#if showCreatedUrlModal && form?.createdUrl}
	<div class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
		<div class="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0C212F]/95 p-5 shadow-2xl">
			<h3 class="text-lg font-semibold text-white">Municipal URL Created</h3>
			<p class="mt-1 text-xs text-[#d1dde7]">Copy and share this URL with authorized LGU users.</p>
			<div class="mt-3 rounded-lg border border-white/15 bg-white/5 p-3">
				<p class="break-all text-xs text-white">{form.createdUrl}</p>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="cursor-pointer rounded-lg border border-white/25 bg-white/5 px-3 py-1.5 text-xs text-white transition hover:bg-white/10"
					onclick={() => {
						showCreatedUrlModal = false;
						copiedCreatedUrl = false;
					}}
				>
					Close
				</button>
				<button
					type="button"
					class="cursor-pointer rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/15"
					onclick={() => copyCreatedUrl(form.createdUrl)}
				>
					Copy URL
				</button>
			</div>
			{#if copiedCreatedUrl}
				<p class="mt-2 text-right text-xs font-medium text-emerald-300">URL Link Copied</p>
			{/if}
		</div>
	</div>
{/if}
