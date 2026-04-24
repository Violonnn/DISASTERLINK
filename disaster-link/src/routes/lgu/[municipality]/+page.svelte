<script lang="ts">
	let { data, form } = $props();

	let password = $state('');
	let localValidationError = $state('');

	function handleSubmit(event: SubmitEvent): void {
		localValidationError = password ? '' : 'Password required';
		if (localValidationError) {
			event.preventDefault();
		}
	}

	const accessError = $derived.by(() => {
		if (localValidationError) return localValidationError;
		return form?.error ?? '';
	});
</script>

<div class="min-h-screen bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] px-4 py-8">
	<!-- This page is strictly the password gate for the municipality URL. -->
	<div class="mx-auto w-full max-w-md rounded-2xl border border-white/15 bg-[#0C212F]/55 p-6 backdrop-blur-md shadow-2xl sm:p-7">
		<p class="text-center text-[11px] tracking-[0.2em] text-[#dce7ef] mb-4 font-semibold">
			DISASTERLINK
		</p>

		<div class="text-center mb-5">
			<h1 class="text-2xl font-semibold text-white">{data.municipalityName} LGU Access</h1>
			{#if data.gateUnlocked}
				<p class="mt-2 text-sm text-[#d1dde7]">
					This browser already unlocked this municipality link. Continue to municipal sign-in, or enter the
					password again below if you need to refresh access.
				</p>
			{:else}
				<p class="mt-2 text-sm text-[#d1dde7]">
					This municipality URL is protected. Enter the assigned password to continue.
				</p>
			{/if}
		</div>

		{#if data.gateUnlocked}
			<a
				href={`/lgu/${data.municipalitySlug}/login`}
				class="mb-4 flex w-full cursor-pointer items-center justify-center rounded-lg border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15"
			>
				Continue to municipal login
			</a>
		{/if}

		<form method="POST" class="space-y-3" onsubmit={handleSubmit}>
			<div>
				<label for="password" class="block text-xs text-[#d1dde7] mb-1.5">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					bind:value={password}
					placeholder="Enter municipality password"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
				{#if accessError}
					<p class="mt-1.5 text-xs text-red-300">{accessError}</p>
				{/if}
			</div>

			<button
				type="submit"
				class="w-full cursor-pointer rounded-lg border border-white/30 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
			>
				Continue
			</button>
		</form>
	</div>
</div>
