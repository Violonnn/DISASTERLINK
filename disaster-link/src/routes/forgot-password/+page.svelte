<script lang="ts">
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabase';
    import { goto } from '$app/navigation';

    /* ── Step tracker ──
       1 = enter email
       2 = "check your inbox" confirmation
       3 = set new password (shown after clicking the email link) */
    let step = $state<1 | 2 | 3>(1);

    /* ── Step 1 fields ── */
    let email = $state('');

    /* ── Step 3 fields ── */
    let newPassword = $state('');
    let confirmPassword = $state('');
    let lastName = $state('');

    /* ── UI state ── */
    let isSubmitting = $state(false);
    let errorMessage = $state('');
    let successMessage = $state('');
    let showErrors = $state(false);

    /* ── Step 1 validation ── */
    let emailError = $derived(
        email.trim() === ''
            ? 'Email is required'
            : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
                ? 'Enter a valid email address'
                : ''
    );

    /* ── Step 3 validation ── */
    let passwordErrors = $derived({
        newPassword:
            newPassword === ''
                ? 'New password is required'
                : newPassword.length < 6
                    ? 'Password must be at least 6 characters'
                    : '',
        confirmPassword:
            confirmPassword === ''
                ? 'Please confirm your password'
                : confirmPassword !== newPassword
                    ? 'Passwords do not match'
                    : ''
    });

    let isPasswordFormValid = $derived(
        Object.values(passwordErrors).every((msg) => msg === '')
    );

    /* ── Listen for the PASSWORD_RECOVERY event when the user clicks the email link ── */
    onMount(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY' && session) {
                /* Try to get last name from user metadata first */
                const meta = session.user.user_metadata;
                lastName = meta?.last_name ?? '';

                /* Fallback: query profiles table if metadata is empty */
                if (!lastName) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('last_name')
                        .eq('id', session.user.id)
                        .single();
                    lastName = profile?.last_name ?? 'there';
                }

                step = 3;
            }
        });

        return () => subscription.unsubscribe();
    });

    /* ── Step 1 handler: send the reset link via Supabase ── */
    async function handleEmailSubmit(event: SubmitEvent) {
        event.preventDefault();
        showErrors = true;

        if (emailError) return;

        isSubmitting = true;
        errorMessage = '';

        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${window.location.origin}/forgot-password`
        });

        isSubmitting = false;

        if (error) {
            errorMessage = 'Unable to send reset email. Please try again.';
            return;
        }

        step = 2;
    }

    /* ── Step 3 handler: update the password using Supabase's secure method ── */
    async function handlePasswordReset(event: SubmitEvent) {
        event.preventDefault();
        showErrors = true;

        if (!isPasswordFormValid) return;

        isSubmitting = true;
        errorMessage = '';

        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });

        isSubmitting = false;

        if (error) {
            errorMessage = 'Failed to reset password. Please try again.';
            return;
        }

        /* Sign out so they log in fresh with the new password */
        await supabase.auth.signOut();

        successMessage = 'Password updated successfully!';
        setTimeout(() => goto('/login'), 2500);
    }
</script>

<div class="min-h-screen flex flex-col items-center justify-center relative cursor-default">
    <img src="/imgs/landing2.png" alt="" class="absolute inset-0 w-full h-full opacity-60 object-contain pointer-events-none" />

    <!-- Top navigation bar -->
    <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
        <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
            <a href="/" class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</a>
            <div class="flex items-center space-x-3 md:space-x-6">
                <a href="/login" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs text-white md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Log In</a>
            </div>
        </div>
    </div>

    <!-- Forgot password card -->
    <div class="relative bg-[#2F4B5D]/4 w-150 h-100 grid place-content-center rounded-[16px] shadow-lg">
        <img src="/imgs/login1.png" alt="" class="absolute inset-0 w-full h-full object-cover pointer-events-none" />

        <div class="relative w-full flex flex-col items-center">

            <!-- ═══════════ STEP 1: Enter email ═══════════ -->
            {#if step === 1}
                <h1 class="relative text-[#2F4B5D] text-2xl font-bold -mt-25">Forgot Password</h1>
                <span class="relative text-[#2F4B5D] font-light text-sm">Enter your email to receive a reset link.</span>

                {#if errorMessage}
                    <div class="w-60 mt-6 bg-red-100 border border-red-400 text-red-800 text-[10px] rounded-lg px-3 py-2 text-center">
                        {errorMessage}
                    </div>
                {/if}

                <div class="flex flex-col items-end">
                    <form onsubmit={handleEmailSubmit} novalidate class="flex flex-col mt-10">
                        <div class="relative pb-3">
                            <label for="EM" class="text-[10px] text-[#2F4B5D] w-full text-left ml-1">Email Address</label>
                            <div class="relative flex items-center">
                                <div class="absolute left-2.5 flex items-center pointer-events-none">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-3.5 h-3.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                                    </svg>
                                </div>
                                <input
                                    id="EM"
                                    name="email"
                                    type="email"
                                    placeholder="Enter your Email"
                                    bind:value={email}
                                    class="w-60 border p-1 pl-8 rounded-lg text-xs text-[#0C212F]"
                                />
                            </div>
                            {#if showErrors && emailError}
                                <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{emailError}</p>
                            {/if}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            class="w-40 bg-gray-800 text-white py-2 rounded-[14px] mt-4 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center self-center"
                        >
                            {#if isSubmitting}
                                <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                            {:else}
                                Send Reset Link
                            {/if}
                        </button>
                    </form>

                    <a href="/login" class="text-[9px] mt-3 text-[#2F4B5D] hover:underline cursor-pointer self-center">Back to Login</a>
                </div>

            <!-- ═══════════ STEP 2: Check your email ═══════════ -->
            {:else if step === 2}
                <h1 class="relative text-[#2F4B5D] text-2xl font-bold -mt-25">Check Your Email</h1>
                <div class="w-60 mt-4 bg-green-100 border border-green-400 text-green-800 text-xs rounded-lg px-4 py-3 text-center">
                    <p>We sent a password reset link to <strong>{email}</strong></p>
                    <p class="mt-2 text-[10px] text-green-600">Click the link in your email, then you'll be brought back here to set a new password.</p>
                </div>

                <a href="/login" class="text-[9px] mt-6 text-[#2F4B5D] hover:underline cursor-pointer">Back to Login</a>

            <!-- ═══════════ STEP 3: Set new password (after clicking email link) ═══════════ -->
            {:else}
                <h1 class="relative text-[#2F4B5D] text-xl font-bold -mt-25">Hi {lastName}, forgetting something? :&gt;</h1>
                <span class="relative text-[#2F4B5D] font-light text-sm">Set your new password below.</span>

                {#if successMessage}
                    <div class="w-60 mt-6 bg-green-100 border border-green-400 text-green-800 text-[10px] rounded-lg px-3 py-2 text-center">
                        {successMessage}
                        <p class="mt-1 text-[9px] text-green-600">Redirecting to login…</p>
                    </div>
                {/if}

                {#if errorMessage}
                    <div class="w-60 mt-6 bg-red-100 border border-red-400 text-red-800 text-[10px] rounded-lg px-3 py-2 text-center">
                        {errorMessage}
                    </div>
                {/if}

                <div class="flex flex-col items-end">
                    <form onsubmit={handlePasswordReset} novalidate class="flex flex-col mt-10">

                        <!-- New Password -->
                        <div class="relative pb-3">
                            <label for="NEWPASS" class="text-[10px] text-[#2F4B5D] w-full text-left ml-1">New Password</label>
                            <div class="relative flex items-center">
                                <div class="absolute left-2.5 flex items-center pointer-events-none">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-3.5 h-3.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                    </svg>
                                </div>
                                <input
                                    id="NEWPASS"
                                    name="newPassword"
                                    type="password"
                                    placeholder="Min 6 characters"
                                    bind:value={newPassword}
                                    class="w-60 border p-1 pl-8 rounded-lg text-xs text-[#0C212F]"
                                />
                            </div>
                            {#if showErrors && passwordErrors.newPassword}
                                <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{passwordErrors.newPassword}</p>
                            {/if}
                        </div>

                        <!-- Confirm Password -->
                        <div class="relative pb-3 mt-2">
                            <label for="CPASS" class="text-[10px] text-[#2F4B5D] w-full text-left ml-1">Confirm Password</label>
                            <div class="relative flex items-center">
                                <div class="absolute left-2.5 flex items-center pointer-events-none">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-3.5 h-3.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                    </svg>
                                </div>
                                <input
                                    id="CPASS"
                                    name="confirmPassword"
                                    type="password"
                                    placeholder="Re-enter password"
                                    bind:value={confirmPassword}
                                    class="w-60 border p-1 pl-8 rounded-lg text-xs text-[#0C212F]"
                                />
                            </div>
                            {#if showErrors && passwordErrors.confirmPassword}
                                <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{passwordErrors.confirmPassword}</p>
                            {/if}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            class="w-40 bg-gray-800 text-white py-2 rounded-[14px] mt-4 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center self-center"
                        >
                            {#if isSubmitting}
                                <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                            {:else}
                                Reset Password
                            {/if}
                        </button>
                    </form>
                </div>
            {/if}

        </div>
    </div>
</div>
