<script lang="ts">
    import { supabase } from '$lib/supabase';
    import { goto } from '$app/navigation';
    import { getLguDashboardPath } from '$lib/auth-redirect';

    /* ── Form field state ── */
    let email = $state('');
    let password = $state('');

    /* ── UI state ── */
    let isSubmitting = $state(false);
    let errorMessage = $state('');
    let infoMessage = $state('');
    let showErrors = $state(false);

    /* ── Reactive validation ── */
    const MIN_PASSWORD_LENGTH = 6;
    let errors = $derived({
        email:
            email.trim() === ''
                ? 'Email is required'
                : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
                    ? 'Enter a valid email address'
                    : '',
        password:
            password === ''
                ? 'Password is required'
                : password.length < MIN_PASSWORD_LENGTH
                    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
                    : ''
    });

    let isFormValid = $derived(
        Object.values(errors).every((msg) => msg === '')
    );

    /* ── Login handler ── */
    async function handleLogin(event: SubmitEvent) {
        event.preventDefault();
        showErrors = true;

        if (!isFormValid) return;

        isSubmitting = true;
        errorMessage = '';
        infoMessage = '';

        /* Step 1: Pre-check — RPC returns TABLE (array). First row has is_proof_pending.
           Skip if RPC doesn't exist or fails (e.g. migration not run). */
        let eligibility: { is_proof_pending?: boolean } | null = null;
        const res = await supabase.rpc('check_login_eligibility', { check_email: email.trim() });
        if (!res.error && res.data) {
            const row = Array.isArray(res.data) ? res.data[0] : res.data;
            eligibility = row ? (row as { is_proof_pending?: boolean }) : null;
        }

        if (eligibility?.is_proof_pending) {
            isSubmitting = false;
            infoMessage = 'Your account is pending admin verification of your proof of employment. Please wait for approval.';
            return;
        }

        /* Step 2: Attempt to sign in */
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password
        });

        if (authError) {
            isSubmitting = false;

            if (authError.message.toLowerCase().includes('email not confirmed')) {
                infoMessage = 'Your email is not yet verified. Please check your inbox for the confirmation link.';
                return;
            }

            errorMessage = 'Invalid email or password.';
            return;
        }

        /* Step 3: Fetch the user's profile for role-based redirect */
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', authData.user.id)
            .single();

        if (profileError || !profile) {
            isSubmitting = false;
            errorMessage = 'Unable to load your profile. Please try again.';
            return;
        }

        /* Step 4: Redirect based on role — all LGU roles use getLguDashboardPath */
        isSubmitting = false;

        const role = profile.role as string;
        if (role === 'resident') {
            goto('/resident/dashboard');
        } else if (role === 'lgu_responder' || role === 'municipal_responder' || role === 'barangay_responder') {
            goto(getLguDashboardPath(role));
        } else {
            goto('/');
        }
    }
</script>

<div class="min-h-screen flex flex-col items-center justify-center relative cursor-default">
    <img src="/imgs/landing2.png" alt="" class="absolute inset-0 w-full h-full opacity-60 object-contain pointer-events-none" />

    <!-- Top navigation bar -->
    <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
        <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
            <a href="/" class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</a>
            <div class="flex items-center space-x-3 md:space-x-6">
                <a href="/signup" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs text-white md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Sign Up</a>
            </div>
        </div>
    </div>

    <!-- Login card -->
    <div class="relative bg-[#2F4B5D]/4 w-150 h-100 grid place-content-center rounded-[16px] shadow-lg">
        <img src="/imgs/login1.png" alt="" class="absolute inset-0 w-full h-full object-cover pointer-events-none" />
        <div class="relative w-full flex flex-col items-center">
            <h1 class="relative text-[#2F4B5D] text-2xl font-bold -mt-10">Welcome Back!</h1>
            <span class="relative top-5 text-[#2F4B5D] font-light -mt-5 text-sm">Let's get you logged in.</span>

            <!-- Info banner (email not verified / proof pending) -->
            {#if infoMessage}
                <div class="w-60 mt-6 bg-amber-50 border border-amber-300 text-amber-800 text-[10px] rounded-lg px-3 py-2 text-center">
                    {infoMessage}
                </div>
            {/if}

            <!-- Error banner -->
            {#if errorMessage}
                <div class="absolute w-60 mt-6 bg-red-100 text-red-800 text-[10px] rounded-lg px-3 py-2 text-center">
                    {errorMessage}
                </div>
            {/if}

            <div class="flex flex-col items-end">
                <form onsubmit={handleLogin} novalidate class="flex flex-col mt-10">

                    <!-- Email field -->
                    <div class="relative pb-1 mt-4">
                        <label for="EM" class="text-[10px] text-[#2F4B5D] w-full text-left ml-1">Email</label>
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
                                placeholder="Enter Email"
                                bind:value={email}
                                class="w-60 border p-1 pl-8 rounded-lg text-xs text-[#0C212F]"
                            />
                        </div>
                        {#if showErrors && errors.email}
                            <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.email}</p>
                        {/if}
                    </div>

                    <!-- Password field -->
                    <div class="relative pb-1">
                        <label for="PASS" class="text-[10px] text-[#2F4B5D] w-full text-left ml-1">Password</label>
                        <div class="relative flex items-center">
                            <div class="absolute left-2.5 flex items-center pointer-events-none">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-3.5 h-3.5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                </svg>
                            </div>
                            <input
                                id="PASS"
                                name="password"
                                type="password"
                                placeholder="Enter Password"
                                bind:value={password}
                                class="w-60 border p-1 pl-8 rounded-lg text-xs text-[#0C212F]"
                            />
                        </div>
                        {#if showErrors && errors.password}
                            <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.password}</p>
                        {/if}
                        <a href="/forgot-password" class="text-[9px] mt-1 ml-1 text-[#2F4B5D] hover:underline cursor-pointer">Forgot password?</a>
                    </div>

                    <!-- Login button -->
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        class="relative w-40 bg-gray-800 text-white py-2 rounded-[14px] mt-4 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center self-center"
                    >
                        {#if isSubmitting}
                            <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                        {:else}
                            Log In
                        {/if}
                    </button>
                </form>
            </div>
        </div>
    </div>
</div>
