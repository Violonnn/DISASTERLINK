<script lang="ts">
	// This receives action errors for the login UI.
	let { form } = $props();

	let username = $state('');
	let password = $state('');
	let localValidationError = $state('');

	// This computes one message based on the submitted values only.
	function getSubmitValidationError(currentUsername: string, currentPassword: string): string {
		const normalizedUsername = currentUsername.trim();
		if (!normalizedUsername && !currentPassword) return 'Username and password required';
		if (!normalizedUsername) return 'Username required';
		if (!currentPassword) return 'Password required';
		return '';
	}

	// This handles submit validation without live feedback while typing.
	function handleSubmit(event: SubmitEvent): void {
		localValidationError = getSubmitValidationError(username, password);
		if (localValidationError) {
			event.preventDefault();
		}
	}

	// This shows one final error message under password only.
	const loginError = $derived.by(() => {
		if (localValidationError) return localValidationError;
		return form?.error ?? '';
	});
</script>

<div class="min-h-screen flex items-center justify-center bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] px-4 py-8">
	<div class="w-full max-w-md rounded-2xl border border-white/15 bg-[#0C212F]/55 backdrop-blur-md shadow-2xl p-6 sm:p-7">
		<!-- This brand label keeps consistent identity with the rest of the system. -->
		<p class="text-center text-[11px] tracking-[0.2em] text-[#dce7ef] mb-4 font-semibold">
			DISASTERLINK
		</p>

		<div class="mx-auto mb-4 h-11 w-11 rounded-xl bg-[#dce7ef] grid place-items-center shadow-md">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5 text-[#0C212F]" fill="none" stroke="currentColor" stroke-width="1.8">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 3v6c0 4.6-2.8 7.7-7 9-4.2-1.3-7-4.4-7-9V6l7-3z" />
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 8.5a2.5 2.5 0 0 0-2.5 2.5v1h5v-1A2.5 2.5 0 0 0 12 8.5z" />
				<path stroke-linecap="round" stroke-linejoin="round" d="M9.5 12h5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V13a1 1 0 0 1 1-1z" />
			</svg>
		</div>

		<div class="text-center mb-5">
			<h1 class="text-2xl font-semibold text-white">Admin login</h1>
			<p class="text-sm text-[#d1dde7] mt-2 leading-5">
				Sign in with your username and password.
			</p>
		</div>

		<!-- This login form posts credentials for secure server-side validation. -->
		<form method="POST" class="space-y-4" onsubmit={handleSubmit}>
			<div>
				<label for="username" class="block text-xs text-[#d1dde7] mb-1.5">Username</label>
				<input
					id="username"
					name="username"
					type="text"
					autocomplete="username"
					bind:value={username}
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
					placeholder="Enter admin username"
				/>
			</div>

			<div>
				<label for="password" class="block text-xs text-[#d1dde7] mb-1.5">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					bind:value={password}
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
					placeholder="Enter admin password"
				/>
				{#if loginError}
					<p class="text-xs text-red-300 mt-1.5">{loginError}</p>
				{/if}
			</div>

			<button
				type="submit"
				class="w-full cursor-pointer rounded-lg border border-white/30 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
			>
				Log in
			</button>
		</form>
	</div>
</div>
