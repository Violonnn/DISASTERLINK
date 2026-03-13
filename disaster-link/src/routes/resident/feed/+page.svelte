<script lang="ts">
  /**
   * Resident Feed — a disaster-awareness newsfeed in Facebook/Instagram style.
   * Three-column layout: left blank, center feed with icon row + profile + posts, right pinned LGU.
   */
  import { onMount, onDestroy } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import ResidentNavBar from '$lib/components/ResidentNavBar.svelte';
  import { fetchFeedPosts, fetchReportNotes, createReportNote, toggleReportUpvote, uploadReportPhoto } from '$lib/services/hazard-report';
  import type { HazardReport, ReportNote } from '$lib/services/hazard-report';
  import { clearResidentLocation } from '$lib/services/resident-location-session';
  import {
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    createNotification,
    type Notification
  } from '$lib/services/notifications';

  async function handleLogout() {
    if (!confirm('Are you sure you want to log out?')) return;
    // Clear any saved resident location so a new login starts fresh.
    clearResidentLocation();
    await supabase.auth.signOut();
    goto('/login');
  }

  let isLoading = $state(true);
  let userLabel = $state('Resident');
  let userInitials = $state('R');
  let residentBarangayName = $state('');
  let currentUserId = $state('');
  let posts = $state<HazardReport[]>([]);
  let commentDrafts = $state<Record<string, string>>({});
  let submittingCommentFor = $state<Record<string, boolean>>({});
  let togglingUpvoteFor = $state<Record<string, boolean>>({});
  let activeCommentFor = $state<Record<string, boolean>>({});
  let commentPhotoUrls = $state<Record<string, string[]>>({});
  let loadingCommentsFor = $state<Record<string, boolean>>({});
  let commentsByPost = $state<Record<string, ReportNote[]>>({});
  let commentVisibleTopCount = $state<Record<string, number>>({});
  let replyTargetFor = $state<Record<string, string | null>>({});

  let hasUpvotedFor = $state<Record<string, boolean>>({});

  /* Notifications for the feed left panel (real-time + Read all / View / Delete) */
  let feedNotifications = $state<Notification[]>([]);
  let feedNotificationsChannel: ReturnType<typeof supabase.channel> | null = null;
  /** When set, the post with this id is highlighted (scroll-into-view from notification View). */
  let highlightedPostId = $state<string | null>(null);

  let replyDrafts = $state<Record<string, string>>({});
  let replyPhotoUrls = $state<Record<string, string[]>>({});
  let replyVisibleCounts = $state<Record<string, number>>({});

  let feedChannel: ReturnType<typeof supabase.channel> | null = null;

  const currentPath = '/resident/feed';
  const feedQuickLinks = [
    { id: 'map', label: 'Map', href: '/resident/dashboard', icon: 'map' },
    { id: 'feed', label: 'Feed', href: '/resident/feed', icon: 'feed' },
    { id: 'report', label: 'Report', href: '/resident/dashboard', icon: 'report' }
  ];

  /* Handle quick link clicks so we can pass context (e.g. open report panel) when needed. */
  function handleQuickLinkClick(item: { id: string; href: string }) {
    if (item.id === 'report') {
      // Redirect to dashboard and immediately open the report panel there.
      goto('/resident/dashboard?action=openReport');
      return;
    }
    goto(item.href);
  }

  /* Navigate to the map and focus a specific report marker by ID. */
  function showReportOnMap(post: HazardReport) {
    if (!post.id) return;
    goto(`/resident/dashboard?focusReportId=${encodeURIComponent(post.id)}`);
  }

  /* Submit a new comment for a given post and refresh the feed counts. */
  async function handleSubmitComment(post: HazardReport) {
    const draft = (commentDrafts[post.id] ?? '').trim();
    if (draft.length < 2) {
      alert('Please enter a comment with at least 2 characters.');
      return;
    }
    submittingCommentFor = { ...submittingCommentFor, [post.id]: true };
    const photoUrls = commentPhotoUrls[post.id] ?? [];
    const { error } = await createReportNote(post.id, draft, { photoUrls, parentNoteId: null });
    submittingCommentFor = { ...submittingCommentFor, [post.id]: false };
    if (error) {
      alert(error);
      return;
    }
    commentDrafts = { ...commentDrafts, [post.id]: '' };
    const nextPhotos = { ...commentPhotoUrls };
    delete nextPhotos[post.id];
    commentPhotoUrls = nextPhotos;
    await loadCommentsForPost(post.id);
    /* Notify the report owner if someone else commented on their post. */
    if (post.reporterId && post.reporterId !== currentUserId) {
      const link = `/resident/dashboard?focusReportId=${encodeURIComponent(post.id)}`;
      await createNotification(post.reporterId, 'New comment on your report', 'Someone commented on your report.', link);
    }
  }

  /* Handle Enter key inside the comment input to submit quickly. */
  function handleCommentKeydown(event: KeyboardEvent, post: HazardReport) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Trigger submit only when there is something typed.
      const draft = (commentDrafts[post.id] ?? '').trim();
      if (draft.length >= 2 && !submittingCommentFor[post.id]) {
        void handleSubmitComment(post);
      }
    }
  }

  /* Load all comments for a specific post and cache them in memory. */
  async function loadCommentsForPost(reportId: string) {
    loadingCommentsFor = { ...loadingCommentsFor, [reportId]: true };
    const notes = await fetchReportNotes(reportId);
    loadingCommentsFor = { ...loadingCommentsFor, [reportId]: false };
    commentsByPost = { ...commentsByPost, [reportId]: notes };
    const topLevelCount = notes.filter((n) => !n.parentNoteId).length;
    const initialVisible = topLevelCount === 0 ? 0 : Math.min(2, topLevelCount);
    commentVisibleTopCount = { ...commentVisibleTopCount, [reportId]: initialVisible };
  }

  /* Begin replying to a specific comment on a post. */
  function startReply(postId: string, noteId: string) {
    replyTargetFor = { ...replyTargetFor, [postId]: noteId };
  }

  /* Cancel reply mode for a given post. */
  function cancelReply(postId: string) {
    const nextReply = { ...replyTargetFor };
    delete nextReply[postId];
    replyTargetFor = nextReply;
  }

  /* Remove a selected photo from the pending attachments of a comment. */
  function removeCommentPhoto(postId: string, url: string) {
    const existing = commentPhotoUrls[postId] ?? [];
    const next = existing.filter((u) => u !== url);
    if (next.length === 0) {
      const copy = { ...commentPhotoUrls };
      delete copy[postId];
      commentPhotoUrls = copy;
    } else {
      commentPhotoUrls = { ...commentPhotoUrls, [postId]: next };
    }
  }

  /* Refresh the entire feed and comments for realtime updates. */
  async function refreshFeed() {
    posts = await fetchFeedPosts(20);
    await Promise.all(
      posts.map(async (p) => {
        await loadCommentsForPost(p.id);
      })
    );
    await refreshUserUpvotes();
  }

  /* Submit a reply under a specific top-level comment. */
  async function handleReplySubmit(post: HazardReport, parentNoteId: string) {
    const draft = (replyDrafts[parentNoteId] ?? '').trim();
    if (draft.length < 2) {
      alert('Please enter a reply with at least 2 characters.');
      return;
    }
    submittingCommentFor = { ...submittingCommentFor, [parentNoteId]: true };
    const photoUrls = replyPhotoUrls[parentNoteId] ?? [];
    const { error } = await createReportNote(post.id, draft, { photoUrls, parentNoteId });
    submittingCommentFor = { ...submittingCommentFor, [parentNoteId]: false };
    if (error) {
      alert(error);
      return;
    }
    const nextDrafts = { ...replyDrafts };
    delete nextDrafts[parentNoteId];
    replyDrafts = nextDrafts;
    const nextPhotos = { ...replyPhotoUrls };
    delete nextPhotos[parentNoteId];
    replyPhotoUrls = nextPhotos;
    const nextReplyTargets = { ...replyTargetFor };
    // Clear reply mode only if this comment was the current reply target
    for (const key of Object.keys(nextReplyTargets)) {
      if (nextReplyTargets[key] === parentNoteId) {
        delete nextReplyTargets[key];
      }
    }
    replyTargetFor = nextReplyTargets;
    await loadCommentsForPost(post.id);
    /* Notify the report owner when someone else replies on their post. */
    if (post.reporterId && post.reporterId !== currentUserId) {
      const link = `/resident/dashboard?focusReportId=${encodeURIComponent(post.id)}`;
      await createNotification(post.reporterId, 'New comment on your report', 'Someone replied to a comment on your report.', link);
    }
  }

  function handleReplyKeydown(event: KeyboardEvent, post: HazardReport, parentNoteId: string) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const draft = (replyDrafts[parentNoteId] ?? '').trim();
      if (draft.length >= 2 && !submittingCommentFor[parentNoteId]) {
        void handleReplySubmit(post, parentNoteId);
      }
    }
  }

  async function handleAddReplyPhotos(event: Event, parentNoteId: string) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    const existing = replyPhotoUrls[parentNoteId] ?? [];
    let updated = [...existing];
    for (const file of files) {
      const url = await uploadReportPhoto(file);
      if (url) {
        updated = [...updated, url];
      }
    }
    if (updated.length !== existing.length) {
      replyPhotoUrls = { ...replyPhotoUrls, [parentNoteId]: updated };
    }
  }

  function removeReplyPhoto(parentNoteId: string, url: string) {
    const existing = replyPhotoUrls[parentNoteId] ?? [];
    const next = existing.filter((u) => u !== url);
    if (next.length === 0) {
      const copy = { ...replyPhotoUrls };
      delete copy[parentNoteId];
      replyPhotoUrls = copy;
    } else {
      replyPhotoUrls = { ...replyPhotoUrls, [parentNoteId]: next };
    }
  }

  /* Helper: get all top-level notes for a post (no parent). */
  function getTopLevelNotesForPost(postId: string): ReportNote[] {
    const all = commentsByPost[postId] ?? [];
    return all.filter((n) => !n.parentNoteId);
  }

  /* Helper: get all replies for a given note on a post. */
  function getRepliesForPostNote(postId: string, noteId: string): ReportNote[] {
    const all = commentsByPost[postId] ?? [];
    return all.filter((n) => n.parentNoteId === noteId);
  }

  /* Show 5 more top-level comments for a given post. */
  function showMoreComments(postId: string) {
    const allTop = getTopLevelNotesForPost(postId);
    const current = commentVisibleTopCount[postId] ?? 0;
    const next = Math.min(allTop.length, current + 5);
    commentVisibleTopCount = { ...commentVisibleTopCount, [postId]: next };
  }

  function showMoreReplies(postId: string, noteId: string) {
    const key = `${postId}:${noteId}`;
    const allReplies = getRepliesForPostNote(postId, noteId);
    const current = replyVisibleCounts[key] ?? Math.min(2, allReplies.length);
    const next = Math.min(allReplies.length, current + 5);
    replyVisibleCounts = { ...replyVisibleCounts, [key]: next };
  }

  /* Load which reports the current user has upvoted so we can keep icons filled after reload. */
  async function refreshUserUpvotes() {
    const userId = currentUserId;
    if (!userId || posts.length === 0) return;
    const reportIds = posts.map((p) => p.id);
    const { data, error } = await supabase
      .from('report_upvotes')
      .select('report_id')
      .eq('user_id', userId)
      .in('report_id', reportIds);
    if (error) return;
    const next: Record<string, boolean> = {};
    for (const row of data ?? []) {
      next[row.report_id] = true;
    }
    hasUpvotedFor = next;
  }

  /* Add one or more photo attachments for a comment on a given post. */
  async function handleAddCommentPhotos(event: Event, post: HazardReport) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    const existing = commentPhotoUrls[post.id] ?? [];
    let updated = [...existing];
    for (const file of files) {
      const url = await uploadReportPhoto(file);
      if (url) {
        updated = [...updated, url];
      }
    }
    if (updated.length !== existing.length) {
      commentPhotoUrls = { ...commentPhotoUrls, [post.id]: updated };
    }
  }

  async function loadFeedNotifications() {
    if (!currentUserId) return;
    feedNotifications = await fetchNotifications(currentUserId);
  }

  async function handleFeedMarkAllRead() {
    if (!currentUserId) return;
    await markAllNotificationsRead(currentUserId);
    await loadFeedNotifications();
  }

  /** Parse focusReportId from notification link. */
  function parseReportIdFromNotificationLink(link: string | null): string | null {
    if (!link) return null;
    try {
      const url = new URL(link, 'https://dummy');
      return url.searchParams.get('focusReportId');
    } catch {
      return null;
    }
  }

  async function handleFeedNotificationView(n: Notification) {
    if (n.readAt === null) await markNotificationRead(n.id);
    await loadFeedNotifications();
    const reportId = parseReportIdFromNotificationLink(n.link);
    if (reportId) {
      highlightedPostId = reportId;
      requestAnimationFrame(() => {
        const el = document.getElementById(`post-${reportId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => {
        highlightedPostId = null;
      }, 2500);
    } else if (n.link) {
      goto(n.link);
    }
  }

  async function handleFeedNotificationDelete(notificationId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await deleteNotification(notificationId);
    await loadFeedNotifications();
  }

  const feedUnreadCount = $derived(feedNotifications.filter((n) => !n.readAt).length);

  /* Toggle an upvote for the current user on a post, and update the local count. */
  async function handleToggleUpvote(post: HazardReport) {
    if (!post.id) return;
    togglingUpvoteFor = { ...togglingUpvoteFor, [post.id]: true };
    const { hasUpvoted, error } = await toggleReportUpvote(post.id);
    togglingUpvoteFor = { ...togglingUpvoteFor, [post.id]: false };
    if (error) {
      alert(error);
      return;
    }
    const delta = hasUpvoted ? 1 : -1;
    hasUpvotedFor = { ...hasUpvotedFor, [post.id]: hasUpvoted };
    posts = posts.map((p) =>
      p.id === post.id
        ? { ...p, upvoteCount: Math.max(0, (p.upvoteCount ?? 0) + delta) }
        : p
    );
    /* Notify the report owner when someone else upvotes their post (only on new upvote). */
    if (hasUpvoted && post.reporterId && post.reporterId !== currentUserId) {
      const link = `/resident/dashboard?focusReportId=${encodeURIComponent(post.id)}`;
      await createNotification(post.reporterId, 'New upvote on your report', 'Someone upvoted your report.', link);
    }
  }

  /* Format a UTC timestamp into a human-readable relative time string */
  function timeAgo(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1)  return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)   return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7)     return `${days}d ago`;
    return new Date(isoString).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* Returns the first two letters of the full name as avatar initials */
  function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      goto('/login');
      return;
    }

    /* Verify the user is a resident */
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, role, barangay_id')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'resident') {
      await supabase.auth.signOut();
      goto('/login');
      return;
    }

    currentUserId = session.user.id;

    const fn = profile.first_name ?? '';
    const ln = profile.last_name ?? '';
    userLabel    = [fn, ln].filter(Boolean).join(' ') || 'Resident';
    userInitials = (fn ? fn[0] : '') + (ln ? ln[0] : '') || 'R';

    /* Fetch affiliated barangay name if assigned */
    if (profile.barangay_id) {
      const { data: brgy } = await supabase
        .from('barangays')
        .select('name')
        .eq('id', profile.barangay_id)
        .single();
      residentBarangayName = brgy?.name ?? '';
    }

    /* Load the newsfeed posts and comments from the reports table */
    await refreshFeed();

    await loadFeedNotifications();
    feedNotificationsChannel = supabase
      .channel('feed-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` },
        () => loadFeedNotifications()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` },
        () => loadFeedNotifications()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` },
        () => loadFeedNotifications()
      )
      .subscribe();

    /* Realtime updates for reports, comments, and upvotes */
    feedChannel = supabase
      .channel('resident-feed-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        () => {
          void refreshFeed();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'report_notes' },
        () => {
          void refreshFeed();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'report_upvotes' },
        () => {
          void refreshFeed();
        }
      )
      .subscribe();

    isLoading = false;
  });

  onDestroy(() => {
    feedChannel?.unsubscribe();
    feedNotificationsChannel?.unsubscribe();
  });
</script>

<!-- Nav bar sits at the top — same dark style as the map dashboard -->
<ResidentNavBar
  {userLabel}
  {userInitials}
  {residentBarangayName}
  currentPath="/resident/feed"
/>

<!-- Loading spinner while fetching session + posts -->
{#if isLoading}
  <div class="min-h-screen grid place-items-center bg-[#0C212F]">
    <svg class="animate-spin h-8 w-8 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
  </div>
{:else}

<!-- Main page body: offset by nav height -->
<div class="min-h-screen bg-[#0C212F] pt-12 md:pt-14">
  <div class="max-w-screen-xl mx-auto flex h-full">

    <!-- Left panel: notifications (top), profile (below notifications), logout (bottom) -->
    <aside class="hidden lg:flex lg:flex-col w-64 xl:w-72 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] bg-[#0C212F] border-r border-white/5">
      <!-- Notifications: fixed height block, no flex-grow so profile sits right below -->
      <div class="p-4 border-b border-white/10 flex flex-col shrink-0">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <div class="relative shrink-0">
              <span class="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-white" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75v-.7V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
              </span>
              {#if feedUnreadCount > 0}
                <span class="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{feedUnreadCount > 99 ? '99+' : feedUnreadCount}</span>
              {/if}
            </div>
            <p class="text-white/50 text-[10px] uppercase tracking-wider">Notifications</p>
          </div>
          {#if feedUnreadCount > 0}
            <button type="button" class="text-cyan-400 text-[10px] hover:underline cursor-pointer" onclick={handleFeedMarkAllRead}>Read all</button>
          {/if}
        </div>
        <div class="feed-notifications-scroll rounded-lg bg-white/5 border border-white/10 overflow-y-auto mt-1 max-h-[14.5rem]">
          {#if feedNotifications.length === 0}
            <p class="px-3 py-4 text-white/40 text-xs">No notifications.</p>
          {:else}
            <div class="divide-y divide-white/10">
              {#each feedNotifications as n}
                <div class="flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 transition {n.readAt ? 'opacity-70' : ''}">
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-xs font-medium">{n.title}</p>
                    <p class="text-white/50 text-[10px] mt-0.5 line-clamp-2">{n.body}</p>
                    <p class="text-white/40 text-[10px] mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    {#if n.link}
                      <button type="button" class="text-cyan-400 text-[10px] hover:underline cursor-pointer" onclick={() => handleFeedNotificationView(n)}>View</button>
                    {/if}
                    <button type="button" class="text-white/40 hover:text-red-400 p-1 cursor-pointer" aria-label="Delete notification" onclick={(e) => handleFeedNotificationDelete(n.id, e)}>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <!-- Profile: directly below notifications -->
      <div class="p-4 border-b border-white/10 shrink-0">
        <a href="/resident/settings" class="flex items-center gap-2 group touch-manipulation">
          <div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold shrink-0 group-hover:bg-white/30 transition">
            {userInitials}
          </div>
          <span class="text-white/90 text-sm font-medium group-hover:text-white transition truncate">{userLabel}</span>
        </a>
      </div>
      <!-- Logout: pushed to bottom -->
      <div class="mt-auto p-4 shrink-0">
        <button
          type="button"
          onclick={handleLogout}
          class="flex items-center gap-2 w-full rounded-lg py-2 px-3 text-white/70 hover:text-white hover:bg-white/10 transition touch-manipulation"
          aria-label="Log out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 shrink-0">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
          <span class="text-xs font-medium">Log out</span>
        </button>
      </div>
    </aside>

    <!-- Center: Map-Feed-Report (sticky), Disaster Updates, then posts -->
    <main class="flex-1 min-w-0 px-2 sm:px-4 py-4 flex flex-col gap-4">
      <!-- Map · Feed · Report: fixed on scroll, centered, hamburger-style with highlight under when active -->
      <div class="sticky top-14 z-10 flex items-end justify-center gap-1 sm:gap-2 py-2 -mx-2 sm:-mx-4 px-2 sm:px-4 mb-1 bg-[#0C212F] border-b border-white/5">
        {#each feedQuickLinks as item}
          <a
            href={item.href}        
            class="relative flex flex-col items-center px-3 py-2 rounded-lg touch-manipulation {currentPath === item.href ? 'bg-white/10' : 'hover:bg-white/5'} transition pb-3"
            onclick={(event) => { event.preventDefault(); handleQuickLinkClick(item); }}
          >
            <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 {currentPath === item.href ? 'bg-amber-500/20 text-amber-400' : 'bg-transparent text-white/80'} mb-1.5">
              {#if item.icon === 'map'}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 0 1 15 0Z" /></svg>
              {:else if item.icon === 'feed'}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" /></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
              {/if}
            </div>
            <span class="text-[10px] font-medium leading-tight {currentPath === item.href ? 'text-amber-400' : 'text-white/80'}">{item.label}</span>
            {#if currentPath === item.href}
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-500 rounded-full"></div>
            {/if}
          </a>
        {/each}
      </div>

      <!-- Disaster Updates line (scrolls with content) -->
      <div class="flex items-center gap-3 mb-2">
        <h2 class="text-white/80 text-sm font-semibold tracking-wide">Disaster Updates</h2>
        <div class="flex-1 h-px bg-white/10"></div>
      </div>

      <!-- Empty state when no reports exist yet -->
      {#if posts.length === 0}
        <div class="flex flex-col items-center justify-center py-20 gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" class="w-14 h-14 text-white/20">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
          </svg>
          <p class="text-white/30 text-sm">No reports yet. Check back later.</p>
        </div>
      {/if}

      <!-- Post cards -->
      {#each posts as post (post.id)}
        <article
          id="post-{post.id}"
          class="bg-[#1B2E3A] rounded-2xl border overflow-hidden shadow-lg transition-[border-color,box-shadow] {highlightedPostId === post.id ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-white/10'}"
        >

          <!-- Post header: avatar, full name, location, time, and optional map marker shortcut -->
          <div class="flex items-start gap-3 px-4 pt-4 pb-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold border border-white/10 shrink-0">
              {getInitials(post.publisherName)}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-white text-sm font-semibold leading-tight truncate">{post.publisherName}</p>
              <p class="text-white/50 text-[11px] mt-0.5 truncate">
                {post.barangayName}{post.municipalityName ? `, ${post.municipalityName}` : ''}
                <span class="mx-1 text-white/30">·</span>
                {timeAgo(post.createdAt)}
                {#if post.updatedAt && new Date(post.updatedAt).getTime() > new Date(post.createdAt).getTime() + 1000}
                  <span class="ml-1 text-amber-300 text-[10px] font-medium">(edited)</span>
                {/if}
              </p>
            </div>

            {#if post.gpsLat != null && post.gpsLng != null}
              <button
                type="button"
                class="ml-auto flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 text-amber-300 text-[10px] font-medium hover:bg-amber-500/20 hover:text-amber-100 transition touch-manipulation shrink-0 cursor-pointer"
                aria-label="Show this report on the map"
                onclick={() => showReportOnMap(post)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 0C5.582 0 2 3.582 2 8c0 4.418 5.5 11 8 12 2.5-1 8-7.582 8-12 0-4.418-3.582-8-8-8Zm0 11.25A3.25 3.25 0 1 1 10 4.75a3.25 3.25 0 0 1 0 6.5Z" clip-rule="evenodd" />
                </svg>
                <span>Map</span>
              </button>
            {/if}
          </div>

          <!-- Post body: title + description text -->
          {#if post.title || post.description}
            <div class="px-4 pb-3">
              {#if post.title}
                <p class="text-white text-sm font-medium mb-1">{post.title}</p>
              {/if}
              {#if post.description}
                <p class="text-white/70 text-sm leading-relaxed">{post.description}</p>
              {/if}
            </div>
          {/if}

          <!-- Photo grid: 1 photo → full-width, 2 → side by side, 3+ → 2-col grid -->
          {#if post.photoUrls.length > 0}
            <div class="px-4 pb-3">
              {#if post.photoUrls.length === 1}
                <img
                  src={post.photoUrls[0]}
                  alt=""
                  class="w-full max-h-80 object-cover rounded-xl border border-white/10"
                  loading="lazy"
                />
              {:else if post.photoUrls.length === 2}
                <div class="grid grid-cols-2 gap-1.5">
                  {#each post.photoUrls as url}
                    <img src={url} alt="" class="w-full h-44 object-cover rounded-xl border border-white/10" loading="lazy" />
                  {/each}
                </div>
              {:else}
                <div class="grid grid-cols-2 gap-1.5">
                  {#each post.photoUrls.slice(0, 4) as url, i}
                    <div class="relative">
                      <img src={url} alt="" class="w-full h-36 object-cover rounded-xl border border-white/10" loading="lazy" />
                      {#if i === 3 && post.photoUrls.length > 4}
                        <div class="absolute inset-0 bg-black/60 rounded-xl flex items-center justify-center">
                          <span class="text-white font-bold text-lg">+{post.photoUrls.length - 4}</span>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Divider -->
          <div class="mx-4 border-t border-white/10"></div>

          <!-- Comments list (supports 1-level threaded replies, shows 2, with "View more") -->
          {#if commentsByPost[post.id]?.length}
            <div class="px-4 pt-3 pb-1 space-y-2">
              {#each getTopLevelNotesForPost(post.id).slice(0, commentVisibleTopCount[post.id] ?? 0) as note (note.id)}
                <!-- Top-level comment -->
                <div class="space-y-1.5">
                  <div class="flex items-start gap-2">
                    <div class="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
                      {getInitials(note.authorName)}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-2 text-[11px]">
                        <div class="flex items-center gap-2">
                          <span class="text-white/90 font-medium truncate max-w-[140px]">{note.authorName}</span>
                          <span class="text-white/30 text-[10px]">{timeAgo(note.createdAt)}</span>
                        </div>
                        <div class="flex items-center gap-2 text-white/40">
                          <!-- Report icon (no behavior yet) -->
                          <button
                            type="button"
                            class="p-1 rounded-full hover:bg-white/10 transition touch-manipulation"
                            aria-label="Report comment"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M6 21v-9.75L9.75 9l4.5 3 4.5-3V21" />
                              <path stroke-linecap="round" stroke-linejoin="round" d="M6 3h12" />
                            </svg>
                          </button>
                          <!-- Delete icon (only for own comments, no behavior yet) -->
                          {#if note.authorId === currentUserId}
                            <button
                              type="button"
                              class="p-1 rounded-full hover:bg-white/10 transition touch-manipulation"
                              aria-label="Delete comment"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M10 11v6m4-6v6M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 7l1 12a1 1 0 001 .9h8a1 1 0 001-.9l1-12" />
                              </svg>
                            </button>
                          {/if}
                        </div>
                      </div>
                      <p class="text-white/80 text-xs leading-snug mt-0.5 break-words">{note.body}</p>
                      {#if note.photoUrls.length}
                        <div class="mt-1 flex flex-wrap gap-1.5">
                          {#each note.photoUrls as url}
                            <a href={url} target="_blank" rel="noopener noreferrer" class="block">
                              <img src={url} alt="" class="w-14 h-14 rounded-md border border-white/10 object-cover hover:border-white/30 transition" loading="lazy" />
                            </a>
                          {/each}
                        </div>
                      {/if}
                      <!-- Reply text button under top-level comment -->
                      <button
                        type="button"
                        class="mt-1 text-[10px] font-medium text-white/50 hover:text-white/80 transition touch-manipulation cursor-pointer"
                        onclick={() => startReply(post.id, note.id)}
                      >
                        Reply
                      </button>
                    </div>
                  </div>

                  <!-- Replies (one level deep) -->
                  {#each getRepliesForPostNote(post.id, note.id).slice(0, replyVisibleCounts[`${post.id}:${note.id}`] ?? Math.min(2, getRepliesForPostNote(post.id, note.id).length)) as reply (reply.id)}
                    <div class="mt-1 ml-8 pl-3 border-l border-white/10 flex items-start gap-2">
                      <div class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white text-[9px] font-semibold shrink-0">
                        {getInitials(reply.authorName)}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2 text-[10px]">
                          <div class="flex items-center gap-2">
                            <span class="text-white/85 font-medium truncate max-w-[120px]">{reply.authorName}</span>
                            <span class="text-white/30">{timeAgo(reply.createdAt)}</span>
                          </div>
                          <div class="flex items-center gap-2 text-white/40">
                            <!-- Report icon for reply (no behavior) -->
                            <button
                              type="button"
                              class="p-1 rounded-full hover:bg-white/10 transition touch-manipulation"
                              aria-label="Report reply"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 21v-9.75L9.75 9l4.5 3 4.5-3V21" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 3h12" />
                              </svg>
                            </button>
                            <!-- Delete icon for own reply (no behavior) -->
                            {#if reply.authorId === currentUserId}
                              <button
                                type="button"
                                class="p-1 rounded-full hover:bg-white/10 transition touch-manipulation"
                                aria-label="Delete reply"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M10 11v6m4-6v6M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 7l1 12a1 1 0 001 .9h8a1 1 0 001-.9l1-12" />
                                </svg>
                              </button>
                            {/if}
                          </div>
                        </div>
                        <p class="text-white/80 text-[11px] leading-snug mt-0.5 break-words">{reply.body}</p>
                        {#if reply.photoUrls.length}
                          <div class="mt-1 flex flex-wrap gap-1.5">
                            {#each reply.photoUrls as url}
                              <a href={url} target="_blank" rel="noopener noreferrer" class="block">
                                <img src={url} alt="" class="w-12 h-12 rounded-md border border-white/10 object-cover hover:border-white/30 transition" loading="lazy" />
                              </a>
                            {/each}
                          </div>
                        {/if}
                        <!-- Second-level replies are not allowed -->
                      </div>
                    </div>
                  {/each}

                  <!-- Inline reply field for this comment -->
                  {#if replyTargetFor[post.id] === note.id}
                    <div class="mt-1 ml-8 pl-3 flex items-start gap-2">
                      <div class="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-white text-[9px] font-semibold shrink-0">
                        {getInitials(userLabel)}
                      </div>
                      <div class="flex-1 min-w-0">
                        <input
                          type="text"
                          placeholder={`Reply to ${note.authorName}…`}
                          bind:value={replyDrafts[note.id]}
                          class="w-full bg-[#0C212F]/60 text-white/80 placeholder-white/30 text-[11px] px-3 py-1.5 rounded-full border border-white/10 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition"
                          aria-label="Write a reply"
                          onkeydown={(event) => handleReplyKeydown(event as KeyboardEvent, post, note.id)}
                        />
                        {#if (replyPhotoUrls[note.id]?.length ?? 0) > 0}
                          <div class="mt-1 flex flex-wrap gap-1">
                            {#each replyPhotoUrls[note.id] as url (url)}
                              <div class="relative w-9 h-9 rounded-md overflow-hidden border border-white/10">
                                <img src={url} alt="" class="w-full h-full object-cover" loading="lazy" />
                                <button
                                  type="button"
                                  class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] flex items-center justify-center hover:bg-black"
                                  aria-label="Remove attached photo"
                                  onclick={() => removeReplyPhoto(note.id, url)}
                                >
                                  ×
                                </button>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <label
                          class="p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation text-white/60 hover:text-white/90 cursor-pointer"
                          aria-label="Image / Video"
                          title="Image / Video"
                        >
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            class="hidden"
                            onchange={(event) => handleAddReplyPhotos(event, note.id)}
                          />
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h12a2.25 2.25 0 012.25 2.25v9.75A2.25 2.25 0 0118 18.75H6A2.25 2.25 0 013.75 16.5V6.75z" />
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12.75l2.9-2.9a1.5 1.5 0 012.12 0l2.9 2.9M13.5 11.25l1.15-1.15a1.5 1.5 0 012.12 0l1.73 1.73" />
                          </svg>
                        </label>
                        <button
                          type="button"
                          class="p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation text-white/60 hover:text-white/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                          aria-label="Submit reply"
                          title="Reply"
                          disabled={submittingCommentFor[note.id]}
                          onclick={() => handleReplySubmit(post, note.id)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  {/if}
                  {#if getRepliesForPostNote(post.id, note.id).length > (replyVisibleCounts[`${post.id}:${note.id}`] ?? Math.min(2, getRepliesForPostNote(post.id, note.id).length))}
                    <button
                      type="button"
                      class="mt-1 ml-8 pl-3 text-[9px] font-medium text-white/55 hover:text-white/85 transition touch-manipulation cursor-pointer"
                      onclick={() => showMoreReplies(post.id, note.id)}
                    >
                      View more replies
                    </button>
                  {/if}
                </div>
              {/each}
              {#if getTopLevelNotesForPost(post.id).length > (commentVisibleTopCount[post.id] ?? 0)}
                <button
                  type="button"
                  class="mt-1 mb-2 text-[10px] font-medium text-white/60 hover:text-white/85 transition touch-manipulation cursor-pointer"
                  onclick={() => showMoreComments(post.id)}
                >
                  View more comments
                </button>
              {/if}
            </div>
          {/if}

          <!-- Action bar: comment input (expands on focus) + upvote icon -->
          <div class="flex items-center px-4 py-3 gap-2">
            {#if false}{/if}
            <!-- Comment text input — expands slightly more when active -->
            <div class={(activeCommentFor[post.id] ? 'basis-4/5' : 'basis-2/3')}>
              <input
                type="text"
                placeholder="Write a comment…"
                bind:value={commentDrafts[post.id]}
                class="w-full bg-[#0C212F]/60 text-white/80 placeholder-white/30 text-xs px-4 py-2 rounded-full border border-white/10 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition"
                aria-label="Write a comment"
                onfocus={() => (activeCommentFor = { ...activeCommentFor, [post.id]: true })}
                onblur={() => {
                  if (!(commentDrafts[post.id] ?? '').trim()) {
                    const next = { ...activeCommentFor };
                    delete next[post.id];
                    activeCommentFor = next;
                  }
                }}
                onkeydown={(event) => handleCommentKeydown(event as KeyboardEvent, post)}
              />
              {#if (commentPhotoUrls[post.id]?.length ?? 0) > 0}
                <div class="mt-1 flex flex-wrap gap-1">
                  {#each commentPhotoUrls[post.id] as url (url)}
                    <div class="relative w-10 h-10 rounded-md overflow-hidden border border-white/10">
                      <img src={url} alt="" class="w-full h-full object-cover" loading="lazy" />
                      <button
                        type="button"
                        class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] flex items-center justify-center hover:bg-black"
                        aria-label="Remove attached photo"
                        onclick={() => removeCommentPhoto(post.id, url)}
                      >
                        ×
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Comment / photo / upvote controls -->
            <div class="flex items-center justify-start gap-1 ml-2 shrink-0">
              <!-- Comment submit icon and count: hidden when the field is active -->
              {#if !activeCommentFor[post.id]}
                <div class="flex items-center gap-0.5">
                  <button
                    class="p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation text-white/60 hover:text-white/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                    aria-label="Submit comment"
                    title="Comment"
                    disabled={submittingCommentFor[post.id]}
                    onclick={() => handleSubmitComment(post)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                    </svg>
                  </button>
                  <span class="text-white/50 text-[10px]">
                    {(commentsByPost[post.id]?.length ?? 0)}
                  </span>
                </div>
              {/if}

              <!-- Photo attachment button -->
              <label
                class="p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation text-white/60 hover:text-white/90 cursor-pointer"
                aria-label="Image / Video"
                title="Image / Video"
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  class="hidden"
                  onchange={(event) => handleAddCommentPhotos(event, post)}
                />
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h12a2.25 2.25 0 012.25 2.25v9.75A2.25 2.25 0 0118 18.75H6A2.25 2.25 0 013.75 16.5V6.75z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12.75l2.9-2.9a1.5 1.5 0 012.12 0l2.9 2.9M13.5 11.25l1.15-1.15a1.5 1.5 0 012.12 0l1.73 1.73" />
                </svg>
              </label>

              <!-- Upvote icon with count -->
              <button
                class="flex items-center gap-0.5 p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer {hasUpvotedFor[post.id] ? 'text-amber-300' : 'text-white/60 hover:text-orange-400'}"
                aria-label="Upvotes"
                title="Upvotes"
                disabled={togglingUpvoteFor[post.id]}
                onclick={() => handleToggleUpvote(post)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
                <span class="text-[10px]">
                  {(post.upvoteCount ?? 0)}
                </span>
              </button>
            </div>
          </div>

        </article>
      {/each}

      <!-- Bottom spacer -->
      <div class="h-8"></div>
    </main>

    <!-- Right panel: pinned LGU post (placeholder for now) -->
    <aside class="hidden lg:block w-64 xl:w-72 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] bg-[#0C212F] overflow-y-auto">
      <div class="p-4 space-y-3">
        <h3 class="text-white/80 text-xs font-semibold uppercase tracking-wider">Pinned by LGU</h3>
        <div class="rounded-xl border border-white/10 bg-white/5 p-4">
          <p class="text-white/50 text-[10px] mb-2">Official updates will appear here.</p>
          <div class="aspect-video rounded-lg bg-white/5 border border-dashed border-white/20 flex items-center justify-center">
            <span class="text-white/30 text-xs">No pinned post yet</span>
          </div>
          <p class="text-white/40 text-[10px] mt-2">LGU announcements and critical alerts will be pinned at the top.</p>
        </div>
      </div>
    </aside>

  </div>
</div>

{/if}

<style>
  /* Notification list: show ~3 items, scrollable; scrollbar matches system (dark) */
  .feed-notifications-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.25) rgba(255, 255, 255, 0.06);
  }
  .feed-notifications-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .feed-notifications-scroll::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
  }
  .feed-notifications-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.25);
    border-radius: 3px;
  }
  .feed-notifications-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.35);
  }
</style>
