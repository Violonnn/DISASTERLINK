<script lang="ts">
    import { supabase } from '$lib/supabase';
    import { goto } from '$app/navigation';

    /* ── Form field state ── */
    let firstName = $state('');
    let lastName = $state('');
    let email = $state('');
    let phone = $state('');
    let password = $state('');
    let confirmPassword = $state('');

    /* ── UI state ── */
    let isSubmitting = $state(false);
    let errorMessage = $state('');
    let successMessage = $state('');
    let showErrors = $state(false);

    /* ── Reactive validation — re-evaluates whenever any field changes ── */
    let errors = $derived({
        firstName:
            firstName.trim() === '' ? 'First name is required' : '',
        lastName:
            lastName.trim() === '' ? 'Last name is required' : '',
        email:
            email.trim() === ''
                ? 'Email is required'
                : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
                    ? 'Enter a valid email address'
                    : '',
        phone:
            phone.trim() === ''
                ? 'Contact number is required'
                : !/^(09\d{9}|\+639\d{9})$/.test(phone.replace(/[\s-]/g, ''))
                    ? 'Enter a valid PH number (09XXXXXXXXX)'
                    : '',
        password:
            password === ''
                ? 'Password is required'
                : password.length < 6
                    ? 'Password must be at least 6 characters'
                    : '',
        confirmPassword:
            confirmPassword === ''
                ? 'Please confirm your password'
                : confirmPassword !== password
                    ? 'Passwords do not match'
                    : ''
    });

    /* True only when every validation message is an empty string */
    let isFormValid = $derived(
        Object.values(errors).every((msg) => msg === '')
    );

    /* ── Signup handler — calls Supabase Auth then redirects ── */
    async function handleSignup(event: SubmitEvent) {
        event.preventDefault();
        showErrors = true;

        if (!isFormValid) return;

        isSubmitting = true;
        errorMessage = '';

        /* Step 1: Check if the phone number is already registered */
        const { data: phoneTaken, error: phoneError } = await supabase
            .rpc('is_phone_taken', { check_phone: phone.trim() });

        if (phoneError) {
            isSubmitting = false;
            errorMessage = 'Unable to verify phone number. Please try again.';
            return;
        }

        if (phoneTaken) {
            isSubmitting = false;
            errorMessage = 'This phone number is already registered.';
            return;
        }

        /* Step 2: Create the auth account */
        const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
                data: {
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    contact_phone: phone.trim(),
                    role: 'resident'
                },
                emailRedirectTo: `${window.location.origin}/login`
            }
        });

        isSubmitting = false;

        if (error) {
            errorMessage = error.message;
            return;
        }

        /* Step 3: Detect duplicate email — Supabase returns an empty
           identities array when the email is already registered */
        if (data.user?.identities?.length === 0) {
            errorMessage = 'This email is already registered. Please log in instead.';
            return;
        }

        successMessage =
            'Account created! Please check your email to confirm your account.';

        setTimeout(() => goto('/login'), 3500);
    }
</script>

<div class="min-h-screen flex flex-col items-center justify-center relative cursor-default">
    <img src="/imgs/landing2.png" alt="" class="absolute inset-0 w-full h-full opacity-70 object-contain pointer-events-none" />

    <!-- Top navigation bar -->
    <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
        <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
            <a href="/" class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</a>
            <div class="flex items-center space-x-3 md:space-x-6">
                <a href="/login" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs text-white md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Log In</a>
            </div>
        </div>
    </div>

    <!-- Signup form card -->
    <form
        onsubmit={handleSignup}
        novalidate
        class="relative bg-[#2F4B5D]/4 w-full max-w-[680px] px-6 py-10 grid place-content-center rounded-[16px] shadow-lg"
    >
        <div class="relative w-full flex flex-col items-center">
            <h1 class="relative text-[#2F4B5D] text-2xl font-bold text-center">Create your DisasterLink account</h1>
            <span class="relative text-[#2F4B5D] font-light text-sm mt-1">Access features to connect effectively.</span>

            <!-- Success banner — shown after signup completes -->
            {#if successMessage}
                <div class="w-full md:w-140 mt-4 bg-green-100 border border-green-400 text-green-800 text-xs rounded-lg px-4 py-3 text-center">
                    {successMessage}
                    <p class="mt-1 text-[10px] text-green-600">Redirecting to login…</p>
                </div>
            {/if}

            <!-- Error banner — shown when Supabase returns an error -->
            {#if errorMessage}
                <div class="w-full md:w-140 mt-4 bg-red-100 border border-red-400 text-red-800 text-xs rounded-lg px-4 py-3 text-center">
                    {errorMessage}
                </div>
            {/if}

            <!-- Input fields grid -->
            <div class="relative mt-8 grid grid-cols-1 md:grid-cols-3 w-full md:w-140 place-items-center gap-y-1">

                <!-- First Name -->
                <div class="relative pb-3">
                    <label for="FN" class="text-[10px] text-[#2F4B5D] md:col-span-2 w-full text-left ml-1">First Name <span class="text-red-500">*</span></label>
                    <input
                        id="FN"
                        name="firstName"
                        type="text"
                        placeholder="Enter your First Name"
                        bind:value={firstName}
                        class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]"
                    />
                    {#if showErrors && errors.firstName}
                        <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.firstName}</p>
                    {/if}
                </div>

                <!-- Last Name -->
                <div class="relative pb-3">
                    <label for="LN" class="text-[10px] text-[#2F4B5D] md:col-span-2 w-full text-left ml-1">Last Name <span class="text-red-500">*</span></label>
                    <input
                        id="LN"
                        name="lastName"
                        type="text"
                        placeholder="Enter your Last Name"
                        bind:value={lastName}
                        class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]"
                    />
                    {#if showErrors && errors.lastName}
                        <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.lastName}</p>
                    {/if}
                </div>

                <!-- Empty cell to keep the 3-column grid aligned -->
                <div class="hidden md:block"></div>

                <!-- Email Address (spans 2 columns on md+) -->
                <div class="relative pb-3 md:col-span-2 w-full text-left ml-1">
                    <label for="EM" class="text-[10px] text-[#2F4B5D]">Email Address <span class="text-red-500">*</span></label>
                    <input
                        id="EM"
                        name="email"
                        type="email"
                        placeholder="Enter your Email"
                        bind:value={email}
                        class="md:col-span-2 w-91 border p-1 rounded-lg text-xs text-[#0C212F]"
                    />
                    {#if showErrors && errors.email}
                        <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.email}</p>
                    {/if}
                </div>

                <!-- Contact Number -->
                <div class="relative pb-3">
                    <label for="PN" class="text-[10px] text-[#2F4B5D]">Contact Number <span class="text-red-500">*</span></label>
                    <input
                        id="PN"
                        name="phone"
                        type="tel"
                        placeholder="09XXXXXXXXX"
                        bind:value={phone}
                        class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]"
                    />
                    {#if showErrors && errors.phone}
                        <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.phone}</p>
                    {/if}
                </div>

                <!-- Password -->
                <div class="relative pb-3">
                    <label for="PASS" class="text-[10px] text-[#2F4B5D]">Password <span class="text-red-500">*</span></label>
                    <input
                        id="PASS"
                        name="password"
                        type="password"
                        placeholder="Min 6 characters"
                        bind:value={password}
                        class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]"
                    />
                    {#if showErrors && errors.password}
                        <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.password}</p>
                    {/if}
                </div>

                <!-- Confirm Password -->
                <div class="relative pb-3">
                    <label for="CPASS" class="text-[10px] text-[#2F4B5D]">Confirm Password <span class="text-red-500">*</span></label>
                    <input
                        id="CPASS"
                        name="confirmPassword"
                        type="password"
                        placeholder="Re-enter password"
                        bind:value={confirmPassword}
                        class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]"
                    />
                    {#if showErrors && errors.confirmPassword}
                        <p class="absolute bottom-0 left-1 text-[9px] text-red-500 leading-none">{errors.confirmPassword}</p>
                    {/if}
                </div>

                <!-- Submit button -->
                <button
                    type="submit"
                    disabled={isSubmitting}
                    class="w-full md:w-25 h-10 md:h-8 bg-gray-800 text-xs md:text-sm text-white rounded col-start-1 md:col-start-3 flex items-center justify-center mt-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
                >
                    {#if isSubmitting}
                        <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                    {:else}
                        Sign Up
                    {/if}
                </button>
            </div>
        </div>

       
    </form>
</div>
