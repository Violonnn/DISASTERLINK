<script lang="ts">
	// This receives action response data from the server (for validation and 403 messages).
	let { form } = $props();

	let accessKey = $state('');
	let showValidation = $state(false);

	// This reactively validates the input so users get immediate feedback before submit.
	const accessKeyError = $derived.by(() => {
		const trimmedValue = accessKey.trim();
		if (!showValidation) return '';
		if (!trimmedValue) return 'Access key is required.';
		return '';
	});

	// This avoids duplicate flashes by showing server errors only when client validation has no message.
	const serverError = $derived.by(() => {
		if (accessKeyError) return '';
		return form?.error ?? '';
	});
</script>

<div class="min-h-screen flex items-center justify-center bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] px-4 py-8">
	<div class="w-full max-w-md rounded-2xl border border-white/15 bg-[#0C212F]/55 backdrop-blur-md shadow-2xl p-6 sm:p-7">
		<!-- This brand label keeps DISASTERLINK visible inside the access card. -->
		<p class="text-center text-[11px] tracking-[0.2em] text-[#dce7ef] mb-4 font-semibold">
			DISASTERLINK
		</p>

		<!-- This icon area matches the visual focus from the provided design. -->
		<div class="mx-auto mb-4 h-11 w-11 rounded-xl bg-[#dce7ef] grid place-items-center shadow-md">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5 text-[#0C212F]" fill="none" stroke="currentColor" stroke-width="1.8">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 3v6c0 4.6-2.8 7.7-7 9-4.2-1.3-7-4.4-7-9V6l7-3z" />
				<path stroke-linecap="round" stroke-linejoin="round" d="M9.5 12.5l1.6 1.6 3.4-3.6" />
			</svg>
		</div>

		<!-- This heading block follows the screenshot structure with clearer copy. -->
		<div class="text-center mb-5">
			<h1 class="text-2xl font-semibold text-white">Access restricted</h1>
			<p class="text-sm text-[#d1dde7] mt-2 leading-5">
				This area is protected. Enter the access key to continue.
			</p>
		</div>

		<!-- This form posts to the server action that validates key and lockout rules. -->
		<form method="POST" class="space-y-4" onsubmit={() => (showValidation = true)}>
			<div>
				<label for="accessKey" class="block text-xs text-[#d1dde7] mb-1.5">Access key</label>
				<input
					id="accessKey"
					name="accessKey"
					type="password"
					bind:value={accessKey}
					autocomplete="current-password"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
					placeholder="Enter access key"
				/>
				{#if accessKeyError}
					<p class="text-xs text-red-300 mt-1.5">{accessKeyError}</p>
				{/if}
				{#if serverError}
					<p class="text-xs text-red-300 mt-1.5">{serverError}</p>
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
