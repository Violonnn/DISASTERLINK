<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabase';
	import { getLguDashboardPath } from '$lib/auth-redirect';

	let { data } = $props();

	let email = $state('');
	let password = $state('');
	let errorMessage = $state('');
	let infoMessage = $state('');
	let isSubmitting = $state(false);

	const lguRoles = new Set([
		'bdrrmo',
		'barangay_responder',
		'lgu_responder',
		'mdrrmo_admin',
		'mdrrmo_staff',
		'mayor',
		'municipal_responder'
	]);

	const errors = $derived({
		email:
			email.trim() === ''
				? 'Email is required'
				: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
					? 'Enter a valid email address'
					: '',
		password: password === '' ? 'Password is required' : ''
	});
	const submitError = $derived.by(() => errorMessage || '');

	async function checkMunicipalEligibility(): Promise<{
		eligible: boolean;
		reason: 'ok' | 'invalid_email' | 'no_account' | 'wrong_municipality';
	}> {
		const response = await fetch('/api/auth/municipal-login-eligibility', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: email.trim(),
				municipalitySlug: data.municipalitySlug
			})
		});
		if (!response.ok) {
			return { eligible: false, reason: 'no_account' };
		}
		return (await response.json()) as {
			eligible: boolean;
			reason: 'ok' | 'invalid_email' | 'no_account' | 'wrong_municipality';
		};
	}

	// This signs in and enforces municipality-bound LGU account access.
	async function handleMunicipalLogin(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		errorMessage = '';
		infoMessage = '';

		if (errors.email) {
			errorMessage = errors.email;
			return;
		}
		if (errors.password) {
			errorMessage = errors.password;
			return;
		}

		// This blocks cross-municipality and non-LGU emails before sign-in to avoid bypass.
		const eligibility = await checkMunicipalEligibility();
		if (!eligibility.eligible) {
			errorMessage =
				eligibility.reason === 'wrong_municipality'
					? 'Invalid account for this municipality.'
					: 'No account found for this municipality.';
			return;
		}

		isSubmitting = true;

		const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
			email: email.trim(),
			password
		});
		if (authError || !authData.user) {
			isSubmitting = false;
			if (authError?.message?.toLowerCase().includes('email not confirmed')) {
				errorMessage = 'Account is pending email verification. Please verify first.';
				return;
			}
			errorMessage = 'Invalid email or password.';
			return;
		}

		const { data: profile, error: profileError } = await supabase
			.from('profiles')
			.select('role, municipality_id')
			.eq('id', authData.user.id)
			.single();
		if (profileError || !profile) {
			isSubmitting = false;
			await supabase.auth.signOut();
			errorMessage = 'No account found for this municipality.';
			return;
		}

		const profileRole = String(profile.role ?? '');
		const profileMunicipalityId = String(profile.municipality_id ?? '');
		const isAllowedRole = lguRoles.has(profileRole);
		const isAllowedMunicipality =
			Array.isArray(data.allowedMunicipalityIds) &&
			data.allowedMunicipalityIds.includes(profileMunicipalityId);

		if (!isAllowedRole || !isAllowedMunicipality) {
			isSubmitting = false;
			await supabase.auth.signOut();
			errorMessage = 'Invalid account for this municipality.';
			return;
		}

		isSubmitting = false;
		infoMessage = `Welcome to ${data.municipalityName}. Redirecting...`;
		await goto(getLguDashboardPath(profileRole));
	}
</script>

<div class="min-h-screen bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] px-4 py-8">
	<div class="mx-auto w-full max-w-lg rounded-2xl border border-white/15 bg-[#0C212F]/55 p-6 backdrop-blur-md shadow-2xl sm:p-8">
		<p class="text-center text-[11px] tracking-[0.2em] text-[#dce7ef] mb-5 font-semibold">DISASTERLINK</p>
		<div class="text-center">
			<p class="text-xs uppercase tracking-[0.2em] text-emerald-200/90">Municipal LGU Sign In</p>
			<h1 class="mt-2 text-3xl font-semibold text-white sm:text-4xl">{data.municipalityName}</h1>
			<p class="mx-auto mt-3 max-w-md text-sm text-[#d1dde7]">
				Sign in with an invitation-linked LGU account for this municipality.
			</p>
		</div>

		<form class="mt-6 space-y-3" onsubmit={handleMunicipalLogin} novalidate>
			<div>
				<label for="municipalEmail" class="mb-1.5 block text-xs text-[#d1dde7]">Email</label>
				<input
					id="municipalEmail"
					type="email"
					bind:value={email}
					placeholder="Enter LGU email"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
			</div>
			<div>
				<label for="municipalPassword" class="mb-1.5 block text-xs text-[#d1dde7]">Password</label>
				<input
					id="municipalPassword"
					type="password"
					bind:value={password}
					autocomplete="current-password"
					placeholder="Enter password"
					class="w-full rounded-lg border border-white/20 bg-[#0C212F]/40 px-3 py-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-[#768391]"
				/>
				{#if submitError}
					<p class="mt-1.5 text-xs text-red-300">{submitError}</p>
				{/if}
			</div>

			{#if infoMessage}
				<p class="text-xs text-emerald-300">{infoMessage}</p>
			{/if}

			<button
				type="submit"
				disabled={isSubmitting}
				class="w-full cursor-pointer rounded-lg border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-70"
			>
				{isSubmitting ? 'Signing in...' : 'Sign in'}
			</button>
		</form>
	</div>
</div>
