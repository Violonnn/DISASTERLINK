<script lang="ts">
  /**
   * MapDashboard — shared map view for guest-dashboard and lgu-responder.
   * Shows hazard layers, search, GPS, barangay status layer (realtime), and LGU-specific draw/status controls.
   */
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import type L from 'leaflet';
  import {
    HAZARD_LAYERS,
    loadHazardGeoJSON,
    createHazardLayer,
    type HazardType
  } from '$lib/services/hazard-overlays';
  import {
    fetchBarangaysWithStatus,
    subscribeBarangayStatusRealtime,
    createBarangayStatusLayer,
    updateBarangayStatus,
    uploadStatusPhoto,
    validateStatusPhoto,
    isNeedStatus,
    BARANGAY_STATUS_LABELS,
    BARANGAY_STATUS_COLORS,
    type BarangayStatusEnum,
    type BarangayWithStatus
  } from '$lib/services/barangay-status';
  import {
    fetchAssistanceLogForBarangay,
    createAssistanceOffer,
    markAssistanceDelivered,
    uploadAssistancePhoto,
    validateAssistancePhoto,
    subscribeAssistanceRealtime,
    type AssistanceOffer
  } from '$lib/services/barangay-assistance';
  import {
    saveBarangayBoundary,
    submitBoundaryRequest,
    fetchJoinableBarangays,
    joinBarangay,
    leaveBarangay,
    requestBarangayDelete,
    fetchMunicipalities,
    fetchBarangaysByMunicipality,
    fetchPendingBoundaryRequestsForMunicipal,
    approveBoundaryRequest,
    rejectBoundaryRequest,
    type BarangayInfo,
    type PendingBoundaryRequest,
    type BoundaryRequestForMunicipal,
    type JoinableBarangay
  } from '$lib/services/barangay-boundary';
  import { fetchNotifications, countUnreadNotifications, markAllNotificationsRead, markNotificationRead, deleteNotification, createNotification, type Notification } from '$lib/services/notifications';
  import { searchPlace, reverseGeocode, type GeocodeResult } from '$lib/services/geocode';
  import {
    fetchBarangayProfile,
    updateBarangayProfile,
    uploadBrochurePhoto,
    validateBrochurePhoto
  } from '$lib/services/barangay-profile';
  import {
    fetchAllHazardReports,
    fetchReportsByReporter,
    fetchHazardReportsForBarangays,
    fetchReportsByBarangayId,
    createHazardReport,
    updateHazardReport,
    deleteHazardReport,
    uploadReportPhoto,
    uploadReportVideo,
    validateReportPhoto,
    validateReportVideo,
    subscribeReportsRealtime,
    fetchReportNotes,
    toggleReportUpvote,
    createReportNote,
    type HazardReport
  } from '$lib/services/hazard-report';
  import { saveResidentLocation, loadResidentLocation } from '$lib/services/resident-location-session';
  import { fetchWeatherForBarangay, type WeatherResult } from '$lib/services/weather';
  import { supabase } from '$lib/supabase';

  // This keeps role checks readable while supporting both legacy and new LGU role labels.
  const MUNICIPAL_ROLE_SET = new Set(['municipal_responder', 'mdrrmo_admin', 'mdrrmo_staff', 'mayor']);

  function isMunicipalRole(role: string | null | undefined): boolean {
    if (!role) return false;
    return MUNICIPAL_ROLE_SET.has(role);
  }

  interface MenuItem {
    label: string;
    href?: string;
    action?: () => void;
    /** Optional SVG innerHTML string shown inside the menu icon circle */
    icon?: string;
  }

  interface Props {
    mode: 'guest' | 'lgu' | 'resident';
    userLabel?: string;
    userInitials?: string;
    locationLabel?: string;
    menuItems?: MenuItem[];
    pfpMenuItems?: MenuItem[];
    hamburgerMenuItems?: MenuItem[];
    lguUserId?: string;
    lguRole?: string;
    lguMunicipalityId?: string;
    lguMunicipalityName?: string;
    lguBarangayInfo?: BarangayInfo | null;
    pendingRequest?: PendingBoundaryRequest | null;
    onBoundaryRequestSubmitted?: () => void | Promise<void>;
    onBarangayInfoChanged?: () => void | Promise<void>;
    /** Signed-in user ID for upvote/comment — guests (missing) can only view */
    currentUserId?: string;
    /** Resident's affiliated barangay name (shown in header for resident mode) */
    residentBarangayName?: string;
    /** Resident's user ID (used for signed-in interactions) */
    residentUserId?: string;
    /** Resident's affiliated barangay ID (required to submit reports) */
    residentBarangayId?: string;
    /** Whether the resident has confirmed their email address (gates Contributions) */
    isEmailVerified?: boolean;
    /** Optional initial action when arriving on resident dashboard (e.g. open report panel). */
    initialResidentAction?: 'openReport' | null;
    /** Optional report ID that should be focused on the map when the page loads. */
    initialReportIdToFocus?: string | null;
  }

  let {
    mode = 'guest',
    userLabel = mode === 'guest' ? 'Guest User' : mode === 'resident' ? 'Resident' : 'LGU',
    userInitials = '',
    locationLabel = '',
    menuItems = [],
    pfpMenuItems,
    hamburgerMenuItems,
    lguUserId = '',
    lguRole = '',
    lguMunicipalityId = '',
    lguMunicipalityName = '',
    lguBarangayInfo = null,
    pendingRequest = null,
    onBoundaryRequestSubmitted,
    onBarangayInfoChanged,
    currentUserId,
    residentBarangayName = '',
    residentUserId = '',
    residentBarangayId = '',
    isEmailVerified = true,
    initialResidentAction = null,
    initialReportIdToFocus = null
  }: Props = $props();

  const signedInUserId = $derived(
    ((currentUserId ?? (mode === 'lgu' ? lguUserId : mode === 'resident' ? residentUserId : '')) || '').trim() || null
  );

  const mapRootId = 'map-dashboard-root';

  const STATUS_OPTIONS: BarangayStatusEnum[] = [
    'normal',
    'in_need_of_resources',
    'in_need_of_manpower',
    'active_disaster'
  ];

  let mapElement: HTMLDivElement;
  let map: L.Map;
  let marker: L.Marker | null = null;
  let searchMarker: L.Marker | null = null;
  let leaflet: typeof L;
  let drawControl: L.Control.Draw | null = null;
  let drawnItems: L.FeatureGroup | null = null;
  let realtimeChannel: ReturnType<typeof subscribeBarangayStatusRealtime> | null = null;

  let locationText = $state('Tap "Get My Location"');
  let isLocating = $state(false);
  let locationError = $state('');
  let locationSuccess = $state('');
  let latitude = $state<number | null>(null);
  let longitude = $state<number | null>(null);
  let detectedBarangayName = $state<string>('Not Detected');

  let searchQuery = $state('');
  let searchResults = $state<GeocodeResult[]>([]);
  let isSearching = $state(false);
  let searchDropdownOpen = $state(false);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let hazardPanelOpen = $state(false);
  let activeHazardLayers = $state<Record<string, L.GeoJSON>>({});
  let loadingHazards = $state<Record<string, boolean>>({});

  let legendOpen = $state(false);
  /* Resident left sidebar + which sub-panel is open ('legend' | 'hazard' | null) */
  let residentSidebarOpen = $state(false);
  let activeSidebarPanel = $state<'legend' | 'hazard' | 'announcement' | 'local-reports' | 'contributions' | 'guest-login' | null>(null);
  let guestRestrictedPanelTarget = $state<'notifications' | 'contributions'>('notifications');
  let isFullscreen = $state(false);
  let openMenu = $state<string | null>(null);
  let minglanillaBorderVisible = $state(false);
  let minglanillaBorderLayer = $state<L.GeoJSON | null>(null);
  let municipalBoundaryPreviewLayer = $state<L.GeoJSON | null>(null);

  let barangayStatusLayer = $state<L.GeoJSON | null>(null);
  let barangaysWithStatus = $state<BarangayWithStatus[]>([]);
  let statusPanelOpen = $state(false);
  let isSavingStatus = $state(false);
  let pendingStatus = $state<BarangayStatusEnum | null>(null);
  let statusDescription = $state('');
  let statusPhotoFiles = $state<File[]>([]);
  let statusPhotoError = $state('');
  let isDrawingBoundary = $state(false);
  let isSavingBoundary = $state(false);

  let mapAreaPanelOpen = $state(false);
  let municipalities = $state<Awaited<ReturnType<typeof fetchMunicipalities>>>([]);
  let barangayOptions = $state<Awaited<ReturnType<typeof fetchBarangaysByMunicipality>>>([]);
  let selectedMunicipalityId = $state('');
  let selectedBarangayId = $state('');
  let newBarangayName = $state('');
  let isCreatingNewBarangay = $state(true);
  let boundaryContactEmail = $state('');
  let boundaryContactPhone = $state('');
  let boundaryDescription = $state('');

  let assistancePanelOpen = $state(false);
  let assistanceBarangay = $state<BarangayWithStatus | null>(null);
  let assistanceLog = $state<AssistanceOffer[]>([]);
  let assistanceDescription = $state('');
  let assistanceExpectedArrival = $state('');
  let assistancePhotoFile = $state<File | null>(null);
  let assistancePhotoError = $state('');
  let isSubmittingAssistance = $state(false);
  let assistanceChannel: ReturnType<typeof subscribeAssistanceRealtime> | null = null;

  let joinPanelOpen = $state(false);
  let joinableBarangays = $state<JoinableBarangay[]>([]);
  let isJoining = $state(false);
  let leavePanelOpen = $state(false);
  let leaveReason = $state('');
  let isLeaving = $state(false);
  let deleteRequestPanelOpen = $state(false);
  let deleteReason = $state('');
  let isRequestingDelete = $state(false);
  let municipalApprovalPanelOpen = $state(false);
  let municipalPendingRequests = $state<BoundaryRequestForMunicipal[]>([]);
  let isApprovingRequestId = $state<string | null>(null);
  let rejectingRequestId = $state<string | null>(null);
  let rejectReason = $state('');
  let isRejectingRequestId = $state<string | null>(null);
  let notificationsOpen = $state(false);
  let notifications = $state<Notification[]>([]);
  let unreadCount = $state(0);
  let guestNotificationOpen = $state(false);

  /* Resident notification state for toolbar panel */
  let residentNotificationsOpen = $state(false);
  let residentDbNotifications = $state<Notification[]>([]);
  let residentNotifications = $derived<Notification[]>([...residentDbNotifications]);
  let residentUnreadCount = $derived(
    residentDbNotifications.filter((n) => !n.readAt).length
  );

  let barangayMgmtExpanded = $state(false);

  let brochurePanelOpen = $state(false);
  let brochureDescription = $state('');
  let brochureExistingUrls = $state<string[]>([]);
  let brochurePhotoFiles = $state<File[]>([]);
  let brochurePhotoError = $state('');
  let isSavingBrochure = $state(false);

  /* Resident toolbar visibility — shown by default, toggled by the chevron tab */
  let toolbarVisible = $state(true);

  /* Hazard report state — LGU can report disasters with location, photos, videos */
  let reportPanelOpen = $state(false);
  let reportTitle = $state('');
  let reportDescription = $state('');
  let reportPhotoFiles = $state<File[]>([]);
  let reportVideoFiles = $state<File[]>([]);
  let reportMediaError = $state('');
  let isSubmittingReport = $state(false);
  let hazardReports = $state<HazardReport[]>([]);
  let reportMarkersLayer = $state<L.LayerGroup | null>(null);
  let reportMarkerById = $state<Record<string, L.Marker>>({});
  let reportsChannel: ReturnType<typeof subscribeReportsRealtime> | null = null;
  /** Debounce rapid postgres_changes on `reports` so one coalesced refresh updates the map and sidebars. */
  let reportsRealtimeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let residentNotificationsChannel: ReturnType<typeof supabase.channel> | null = null;
  let selectedReport = $state<HazardReport | null>(null);
  let selectedReportComments = $state<Awaited<ReturnType<typeof fetchReportNotes>>>([]);
  let selectedReportCommentDraft = $state('');
  let selectedReportCommentPhotos = $state<string[]>([]);
  let selectedReportSubmitting = $state(false);
  let selectedReportHasUpvoted = $state(false);
  /* Modal comment/reply pagination and reply UI (match feed: 2 initial, +5 on "View more") */
  let selectedReportCommentVisibleTopCount = $state(0);
  let selectedReportReplyVisibleCounts = $state<Record<string, number>>({});
  let selectedReportReplyTarget = $state<string | null>(null);
  let selectedReportReplyDrafts = $state<Record<string, string>>({});
  let selectedReportReplyPhotos = $state<Record<string, string[]>>({});
  let selectedReportSubmittingReplyFor = $state<string | null>(null);
  let selectedReportActiveCommentFocus = $state(false);
  let selectedReportTogglingUpvote = $state(false);
  let reportCreateProfile = $state<{ brochurePhotoUrls: string[] } | null>(null);
  let reportPhotoPreviewUrls = $state<string[]>([]);
  let reportVideoPreviewUrls = $state<string[]>([]);
  /* For residents: barangay detected from current location when opening report (no affiliation required). */
  let reportBarangayId = $state<string | null>(null);
  let reportBarangayName = $state<string>('');

  /* Your Contributions (resident): list, sort, edit/delete modals */
  let userContributions = $state<HazardReport[]>([]);
  let contributionSort = $state<'date-desc' | 'date-asc' | 'engagement'>('date-desc');
  let contributionEditReport = $state<HazardReport | null>(null);
  let contributionDeleteReport = $state<HazardReport | null>(null);
  let contributionEditTitle = $state('');
  let contributionEditDescription = $state('');
  let contributionEditPhotoUrls = $state<string[]>([]);
  let contributionEditVideoUrls = $state<string[]>([]);
  let contributionSaving = $state(false);
  let contributionDeleting = $state(false);
  let contributionError = $state('');
  let contributionDeleteError = $state('');

  /* Local reports: all reports in the barangay that contains the user's location (or profile barangay) */
  let localBarangayReports = $state<HazardReport[]>([]);
  let localBarangayReportsLoading = $state(false);
  let localReportSort = $state<'date-desc' | 'date-asc' | 'engagement'>('date-desc');
  /** Barangay name for the current "local reports" list (from location or profile). */
  let localReportsBarangayName = $state<string>('');

  const sortedContributions = $derived.by(() => {
    const list = [...userContributions];
    if (contributionSort === 'date-desc') return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (contributionSort === 'date-asc') return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const engagement = (r: HazardReport) => (r.upvoteCount ?? 0) + (r.commentCount ?? 0);
    return list.sort((a, b) => engagement(b) - engagement(a) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  const sortedLocalBarangayReports = $derived.by(() => {
    const list = [...localBarangayReports];
    if (localReportSort === 'date-desc') return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (localReportSort === 'date-asc') return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const engagement = (r: HazardReport) => (r.upvoteCount ?? 0) + (r.commentCount ?? 0);
    return list.sort((a, b) => engagement(b) - engagement(a) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  const sortedGuestReports = $derived.by(() => {
    const list = [...hazardReports];
    if (localReportSort === 'date-desc') return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (localReportSort === 'date-asc') return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const engagement = (r: HazardReport) => (r.upvoteCount ?? 0) + (r.commentCount ?? 0);
    return list.sort((a, b) => engagement(b) - engagement(a) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  const selectedReportOwnedBySignedInUser = $derived(
    !!(selectedReport && signedInUserId && selectedReport.reporterId === signedInUserId)
  );
  const canCommentSelectedReport = $derived(mode === 'guest' ? selectedReportOwnedBySignedInUser : !!signedInUserId);
  const canUpvoteSelectedReport = $derived(mode === 'guest' ? false : !!signedInUserId);

  /** Resolve which barangay to use for Local Reports: by user's current location (inside border) first, then profile. */
  async function loadLocalBarangayReports() {
    let barangayId: string | null = null;
    let barangayName = residentBarangayName || '';

    // Prefer barangay that contains the user's current location (reports "within border")
    if (latitude != null && longitude != null && barangaysWithStatus.length > 0) {
      const at = getBarangayAtLocation(latitude, longitude);
      if (at) {
        barangayId = at.id;
        barangayName = at.name;
      }
    }
    // Fallback: profile's affiliated barangay
    if (!barangayId && residentBarangayId) {
      barangayId = residentBarangayId;
      barangayName = residentBarangayName || 'your barangay';
    }

    localReportsBarangayName = barangayName;
    if (!barangayId) {
      localBarangayReports = [];
      return;
    }

    localBarangayReportsLoading = true;
    localBarangayReports = await fetchReportsByBarangayId(barangayId);
    localBarangayReportsLoading = false;
  }

  const DEFAULT_CENTER: [number, number] = [10.3157, 123.8854];
  const DEFAULT_ZOOM = 13;

  /* Toolbar items for resident and guest floating center bar. */
  const residentToolbarItems = $derived([
    {
      id: 'map',
      label: 'Map',
      href: '/resident/dashboard' as string | undefined,
      action: undefined as (() => void) | undefined,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px;height:18px"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 0 1 15 0Z" /></svg>`,
      active: false
    },
    {
      id: 'report',
      label: 'Report',
      href: undefined as string | undefined,
      action: openReportPanel as (() => void) | undefined,
      icon: '',
      active: false
    },
    {
      id: 'feed',
      label: 'Feed',
      href: '/resident/feed' as string | undefined,
      action: undefined as (() => void) | undefined,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px;height:18px"><path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" /></svg>`,
      active: false
    },
    {
      id: 'resources',
      label: 'Resources',
      href: undefined as string | undefined,
      action: undefined as (() => void) | undefined,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px;height:18px"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>`,
      active: false
    },
    {
      id: 'hotlines',
      label: 'Hotlines',
      href: undefined as string | undefined,
      action: undefined as (() => void) | undefined,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px;height:18px"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>`,
      active: false
    }
  ]);

  const guestToolbarItems = $derived([
    {
      id: 'report',
      label: 'Report',
      href: undefined as string | undefined,
      action: openReportPanel as (() => void) | undefined,
      icon: '',
      active: false
    },
    {
      id: 'resources',
      label: 'Resources',
      href: undefined as string | undefined,
      action: () => {
        activeSidebarPanel = 'guest-login';
        guestRestrictedPanelTarget = 'notifications';
      },
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px;height:18px"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>`,
      active: false
    },
    {
      id: 'hotlines',
      label: 'Hotlines',
      href: undefined as string | undefined,
      action: () => {
        activeSidebarPanel = 'guest-login';
        guestRestrictedPanelTarget = 'notifications';
      },
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px;height:18px"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>`,
      active: false
    }
  ]);

  /* Split toolbar items into left and right pools; Report is rendered in center. */
  const leftToolbarItems  = $derived(residentToolbarItems.filter(i => ['map',       'feed'].includes(i.id)));
  const rightToolbarItems = $derived(residentToolbarItems.filter(i => ['resources', 'hotlines'].includes(i.id)));
  const guestLeftToolbarItems  = $derived(guestToolbarItems.filter(i => ['resources'].includes(i.id)));
  const guestRightToolbarItems = $derived(guestToolbarItems.filter(i => ['hotlines'].includes(i.id)));

  function toggle(name: string) {
    // Ensure only one of profile menu / notifications / sidebar is open at a time
    notificationsOpen = false;
    residentNotificationsOpen = false;
    guestNotificationOpen = false;
    residentSidebarOpen = false;
    openMenu = openMenu === name ? null : name;
  }
  function close() {
    // Close all header overlays (profile, notifications, sidebar)
    openMenu = null;
    notificationsOpen = false;
    residentNotificationsOpen = false;
    guestNotificationOpen = false;
    residentSidebarOpen = false;
    barangayMgmtExpanded = false;
  }

  function scheduleSearch() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(doSearch, 320);
  }

  async function doSearch() {
    if (!searchQuery.trim()) {
      searchResults = [];
      searchDropdownOpen = false;
      return;
    }
    isSearching = true;
    searchDropdownOpen = true;
    try {
      const results = await searchPlace(searchQuery.trim(), { limit: 5, countryCodes: 'ph' });
      searchResults = results;
    } catch {
      searchResults = [];
      locationError = 'Search service unavailable.';
    } finally {
      isSearching = false;
    }
  }

  function goToSearchResult(result: GeocodeResult) {
    if (!map || !leaflet) return;
    const { lat, lon, displayName, boundingBox } = result;
    if (searchMarker) {
      map.removeLayer(searchMarker);
      searchMarker = null;
    }
    if (boundingBox && boundingBox.length === 4) {
      const south = Math.min(boundingBox[0], boundingBox[1]);
      const north = Math.max(boundingBox[0], boundingBox[1]);
      const west = Math.min(boundingBox[2], boundingBox[3]);
      const east = Math.max(boundingBox[2], boundingBox[3]);
      map.flyToBounds([
        [south, west],
        [north, east]
      ], { padding: [40, 40], duration: 1 });
    } else {
      map.flyTo([lat, lon], 15, { duration: 1 });
    }
    /* Violet teardrop pin for search results — visually distinct from report markers. */
    const searchPinIcon = leaflet.divIcon({
      className: '',
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 20 26"><path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#7c3aed" stroke="white" stroke-width="1.5"/><circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/></svg>`,
      iconSize: [20, 26],
      iconAnchor: [10, 26],
      popupAnchor: [0, -26]
    });
    searchMarker = leaflet.marker([lat, lon], { icon: searchPinIcon }).addTo(map).bindPopup(displayName).openPopup();
    searchQuery = '';
    searchResults = [];
    searchDropdownOpen = false;
  }

  function toggleFullscreen() {
    const container = document.getElementById(mapRootId);
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.().then(() => (isFullscreen = true));
    } else {
      document.exitFullscreen?.().then(() => (isFullscreen = false));
    }
  }

  function setupFullscreenListener() {
    const handler = () => {
      isFullscreen = !!document.fullscreenElement;
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }

  /* ── Build popup HTML for a barangay; includes brochure, Provide Assistance, and Set Status ── */
  function buildBarangayPopupHtml(b: BarangayWithStatus): string {
    const color = BARANGAY_STATUS_COLORS[b.status];
    let html =
      `<div class="map-popup-content" data-barangay-id="${b.id}" style="min-width:240px;max-width:340px;font-size:13px;line-height:1.5">` +
      `<strong>${escapeHtml(b.name)}</strong><br/>` +
      `<span style="color:#666">${escapeHtml(b.municipalityName)}</span><br/>` +
      `<span style="color:${color};font-weight:600">${escapeHtml(BARANGAY_STATUS_LABELS[b.status])}</span>`;
    if (b.statusDescription) {
      html += `<br/><span style="color:#444;font-size:12px;display:block;margin-top:4px">${escapeHtml(b.statusDescription)}</span>`;
    }
    if (b.statusPhotoUrls?.length) {
      html += `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">`;
      for (const url of b.statusPhotoUrls.slice(0, 4)) {
        html += `<img src="${escapeHtml(url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px" loading="lazy" />`;
      }
      html += `</div>`;
    }
    const canAssist =
      mode === 'lgu' &&
      lguUserId &&
      (lguBarangayInfo == null || lguBarangayInfo.id !== b.id) &&
      isNeedStatus(b.status);
    const isOwnBarangay = mode === 'lgu' && lguBarangayInfo?.id === b.id;
    // Horizontal layout: circle icon + title (consistent across all contexts)
    const circleStyle = 'width:32px;height:32px;min-width:32px;min-height:32px;border-radius:50%;background:#768391;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;margin-bottom:4px';
    const itemStyle = 'display:flex;flex-direction:column;align-items:center;min-width:44px;flex-shrink:0;padding:4px;margin:0;border:none;border-radius:8px;cursor:pointer;background:transparent;transition:background 0.2s;font:inherit;text-decoration:none;color:#333';
    const profileIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>';
    const assistIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507 12 12 0 0 1 .521-3.507c.26-.85 1.083-1.368 1.972-1.368h.908c.445 0 .72.498.523.898a18.94 18.94 0 0 1-.27.602" /></svg>';
    const setStatusIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>';
    const assistanceReceivedIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.66 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.98l7.5-4.04a2.25 2.25 0 0 1 2.134 0l7.5 4.04a2.25 2.25 0 0 1 1.183 1.98V19.5Z" /></svg>';

    html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;display:flex;gap:8px;justify-content:flex-start;align-items:flex-start;flex-wrap:nowrap">`;
    html += `<a href="/barangays/${escapeHtml(b.id)}" class="view-barangay-profile-link" data-barangay-id="${b.id}" style="${itemStyle}" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">`;
    html += `<div style="${circleStyle}">${profileIcon}</div>`;
    html += `<span style="font-size:10px;font-weight:500;text-align:center;line-height:1.2">Barangay Profile</span></a>`;

    if (isOwnBarangay) {
      if (lguBarangayInfo?.isApproved) {
        html += `<button type="button" class="set-status-btn" data-barangay-id="${b.id}" style="${itemStyle}" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">`;
        html += `<div style="${circleStyle}">${setStatusIcon}</div>`;
        html += `<span style="font-size:10px;font-weight:500;text-align:center;line-height:1.2">Set Status</span></button>`;
      }
      if (isNeedStatus(b.status)) {
        html += `<button type="button" class="view-assistance-received-btn" data-recipient-id="${b.id}" style="${itemStyle}" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">`;
        html += `<div style="${circleStyle}">${assistanceReceivedIcon}</div>`;
        html += `<span style="font-size:10px;font-weight:500;text-align:center;line-height:1.2">Assistance Received</span></button>`;
      }
    } else if (canAssist) {
      html += `<button type="button" class="provide-assistance-btn" data-recipient-id="${b.id}" data-recipient-name="${escapeHtml(b.name)}" style="${itemStyle}" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">`;
      html += `<div style="${circleStyle}">${assistIcon}</div>`;
      html += `<span style="font-size:10px;font-weight:500;text-align:center;line-height:1.2">Provide Assistance</span></button>`;
    }
    html += `</div>`;
    /* Resident and guest: weather section inside the same popup container (loads when popup opens). */
    if (mode === 'resident' || mode === 'guest') {
      html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;font-size:11px;color:#444" data-weather-container>Loading weather…</div>`;
    }
    html += `</div>`;
    return html;
  }

  /* Build HTML for weather block inside the barangay popup (resident only). */
  function buildWeatherPopupHtml(data: WeatherResult): string {
    return (
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">` +
      `<span style="font-weight:600;color:#333;font-size:13px">${Math.round(data.temperatureCelsius)}°C</span>` +
      `<span style="color:#666">${escapeHtml(data.weatherLabel)}</span>` +
      `<span style="color:#888;font-size:10px">Humidity ${data.relativeHumidityPercent}% · Wind ${data.windSpeedKmh} km/h</span>` +
      `</div>`
    );
  }

  function escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function refreshBarangayStatusLayer() {
    if (!map || !leaflet) return;
    const data = await fetchBarangaysWithStatus();
    barangaysWithStatus = data;

    if (barangayStatusLayer) {
      map.removeLayer(barangayStatusLayer);
      barangayStatusLayer = null;
    }

    /* Resident and guest: when popup opens, fetch weather and show it inside the same popup container. */
    const onPopupOpen = mode === 'resident' || mode === 'guest' ? onBarangayPopupOpen : undefined;
    const layer = createBarangayStatusLayer(leaflet, data, buildBarangayPopupHtml, undefined, onPopupOpen);
    if (layer) {
      layer.addTo(map);
      barangayStatusLayer = layer;
    }
    await refreshReportMarkers();
  }

  /* ── When selecting a status: normal saves immediately; need statuses show form ── */
  function selectStatus(status: BarangayStatusEnum) {
    if (isNeedStatus(status)) {
      pendingStatus = status;
      statusDescription = '';
      statusPhotoFiles = [];
      statusPhotoError = '';
    } else {
      pendingStatus = null;
      setBarangayStatus(status);
    }
  }

  function cancelStatusForm() {
    pendingStatus = null;
    statusDescription = '';
    statusPhotoFiles = [];
    statusPhotoError = '';
  }

  function handleStatusPhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const valid: File[] = [];
    let err = '';
    for (const f of files) {
      const msg = validateStatusPhoto(f);
      if (msg) err = msg;
      else valid.push(f);
    }
    statusPhotoFiles = valid;
    statusPhotoError = err;
  }

  async function saveBarangayStatusWithDetails() {
    if (!lguBarangayInfo?.id || !lguUserId || !lguBarangayInfo.isApproved || !pendingStatus)
      return;
    if (isNeedStatus(pendingStatus) && statusDescription.trim().length < 5) {
      statusPhotoError = 'Description must be at least 5 characters.';
      return;
    }
    isSavingStatus = true;
    locationError = '';
    statusPhotoError = '';
    try {
      const photoUrls: string[] = [];
      for (const f of statusPhotoFiles) {
        const url = await uploadStatusPhoto(f);
        if (url) photoUrls.push(url);
      }
      const { error } = await updateBarangayStatus(
        lguBarangayInfo.id,
        pendingStatus,
        lguUserId,
        {
          description: statusDescription.trim(),
          photoUrls
        }
      );
      if (error) locationError = error;
      else {
        pendingStatus = null;
        statusDescription = '';
        statusPhotoFiles = [];
        statusPanelOpen = false;
        await refreshBarangayStatusLayer();
      }
    } finally {
      isSavingStatus = false;
    }
  }

  async function setBarangayStatus(status: BarangayStatusEnum) {
    if (!lguBarangayInfo?.id || !lguUserId || !lguBarangayInfo.isApproved) return;
    isSavingStatus = true;
    locationError = '';
    try {
      const { error } = await updateBarangayStatus(lguBarangayInfo.id, status, lguUserId);
      if (error) locationError = error;
      else {
        statusPanelOpen = false;
        await refreshBarangayStatusLayer();
      }
    } finally {
      isSavingStatus = false;
    }
  }

  /* ── Convert Leaflet polygon LatLngs to GeoJSON Polygon ── */
  function latlngsToGeoJSON(latlngs: L.LatLng[] | L.LatLng[][] | L.LatLng[][][]): GeoJSON.Polygon {
    const toRing = (ring: L.LatLng[]): [number, number][] =>
      ring.map((ll) => [ll.lng, ll.lat] as [number, number]);
    const raw = latlngs as L.LatLng[] | L.LatLng[][];
    const rings: [number, number][][] = Array.isArray(raw[0]) && raw[0].length > 0 && typeof (raw[0] as L.LatLng[])[0] !== 'number'
      ? (raw as L.LatLng[][]).map((r) => toRing(r as L.LatLng[]))
      : [toRing(raw as L.LatLng[])];
    return { type: 'Polygon', coordinates: rings };
  }

  async function openMapAreaPanel() {
    mapAreaPanelOpen = true;
    isCreatingNewBarangay = true;
    selectedBarangayId = '';
    newBarangayName = '';
    boundaryContactEmail = '';
    boundaryContactPhone = '';
    boundaryDescription = '';
    if (municipalities.length === 0) {
      municipalities = await fetchMunicipalities();
    }
  }

  async function onMunicipalityChange(munId: string) {
    selectedMunicipalityId = munId;
    selectedBarangayId = '';
    if (munId) {
      barangayOptions = await fetchBarangaysByMunicipality(munId);
    } else {
      barangayOptions = [];
    }
  }

  function startDrawBoundary() {
    if (!map || !leaflet || drawnItems) return;

    if (lguBarangayInfo?.id) {
      startDrawForAssignedBarangay();
    } else {
      if (!selectedMunicipalityId) {
        locationError = 'Select a municipality first.';
        return;
      }
      const barangayName = newBarangayName.trim();
      if (!barangayName) {
        locationError = 'Enter the new barangay name.';
        return;
      }
      if (!boundaryContactEmail.trim()) {
        locationError = 'Contact email is required before submitting.';
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(boundaryContactEmail.trim())) {
        locationError = 'Enter a valid email address.';
        return;
      }
      if (!boundaryContactPhone.trim()) {
        locationError = 'Contact number is required before submitting.';
        return;
      }
      if (!/^(09\d{9}|\+639\d{9})$/.test(boundaryContactPhone.replace(/[\s-]/g, ''))) {
        locationError = 'Enter a valid PH number (09XXXXXXXXX or +63 9XXXXXXXXX).';
        return;
      }
      mapAreaPanelOpen = false;
      locationError = '';
      startDrawForNewArea(selectedMunicipalityId, null, barangayName);
    }
  }

  function startDrawForAssignedBarangay() {
    if (!lguBarangayInfo?.id) return;
    isDrawingBoundary = true;
    statusPanelOpen = false;
    hazardPanelOpen = false;
    legendOpen = false;

    drawnItems = leaflet.featureGroup().addTo(map);

    (globalThis as unknown as { L: typeof L }).L = leaflet;
    drawControl = new (leaflet as typeof L & { Control: { Draw: new (opt: { draw: object; edit: object }) => L.Control } }).Control.Draw({
      draw: {
        polygon: {
          shapeOptions: { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.4 },
          metric: true
        },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false
      },
      edit: { featureGroup: drawnItems }
    });

    map.addControl(drawControl);

    map.on('draw:created', async (e: { layer: L.Polygon }) => {
      const layer = e.layer;
      const geom = latlngsToGeoJSON(layer.getLatLngs());

      if (drawnItems) map.removeLayer(drawnItems);
      if (drawControl) map.removeControl(drawControl);
      drawControl = null;
      drawnItems = null;
      isDrawingBoundary = false;

      isSavingBoundary = true;
      locationError = '';
      try {
        const { success, error } = await saveBarangayBoundary(lguBarangayInfo!.id, geom);
        locationError = '';
        locationSuccess = '';
        if (error) locationError = error;
        else {
          if (lguBarangayInfo?.isCreator) {
            locationSuccess = 'Boundary update requested. Admin approval required.';
          }
          await refreshBarangayStatusLayer();
        }
      } finally {
        isSavingBoundary = false;
      }
    });
  }

  function startDrawForNewArea(municipalityId: string, barangayId: string | null, barangayName: string) {
    isDrawingBoundary = true;
    hazardPanelOpen = false;
    legendOpen = false;

    drawnItems = leaflet.featureGroup().addTo(map);

    (globalThis as unknown as { L: typeof L }).L = leaflet;
    drawControl = new (leaflet as typeof L & { Control: { Draw: new (opt: { draw: object; edit: object }) => L.Control } }).Control.Draw({
      draw: {
        polygon: {
          shapeOptions: { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.4 },
          metric: true
        },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false
      },
      edit: { featureGroup: drawnItems }
    });

    map.addControl(drawControl);

    map.on('draw:created', async (e: { layer: L.Polygon }) => {
      const layer = e.layer;
      const geom = latlngsToGeoJSON(layer.getLatLngs());

      if (drawnItems) map.removeLayer(drawnItems);
      if (drawControl) map.removeControl(drawControl);
      drawControl = null;
      drawnItems = null;
      isDrawingBoundary = false;

      isSavingBoundary = true;
      locationError = '';
      try {
        const { success, error } = await submitBoundaryRequest(
          municipalityId,
          barangayId,
          barangayName,
          geom,
          boundaryContactEmail.trim(),
          boundaryContactPhone.trim(),
          boundaryDescription.trim() || undefined
        );
        if (error) locationError = error;
        else {
          await onBoundaryRequestSubmitted?.();
          locationError = '';
        }
      } finally {
        isSavingBoundary = false;
      }
    });
  }

  function cancelDrawBoundary() {
    if (!map || !drawnItems || !drawControl) return;
    map.removeLayer(drawnItems);
    map.removeControl(drawControl);
    drawnItems = null;
    drawControl = null;
    isDrawingBoundary = false;
  }

  async function handleMapContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const assistBtn = target.closest?.('.provide-assistance-btn');
    const viewBtn = target.closest?.('.view-assistance-received-btn');
    const setStatusBtn = target.closest?.('.set-status-btn');

    if (setStatusBtn) {
      statusPanelOpen = true;
      close();
      return;
    }

    if (assistBtn) {
      const recipientId = assistBtn.getAttribute('data-recipient-id');
      if (!recipientId) return;
      const b = barangaysWithStatus.find((x) => x.id === recipientId);
      if (b) openAssistancePanel(b);
      return;
    }

    if (viewBtn) {
      const recipientId = viewBtn.getAttribute('data-recipient-id');
      if (!recipientId) return;
      const b = barangaysWithStatus.find((x) => x.id === recipientId);
      if (b) openAssistancePanel(b);
    }
  }

  async function openAssistancePanel(b: BarangayWithStatus) {
    assistanceBarangay = b;
    assistancePanelOpen = true;
    assistanceDescription = '';
    assistanceExpectedArrival = '';
    assistancePhotoFile = null;
    assistancePhotoError = '';
    assistanceLog = await fetchAssistanceLogForBarangay(b.id);
    assistanceChannel?.unsubscribe?.();
    assistanceChannel = subscribeAssistanceRealtime(b.id, async () => {
      assistanceLog = await fetchAssistanceLogForBarangay(b.id);
    });
  }

  function closeAssistancePanel() {
    assistancePanelOpen = false;
    assistanceBarangay = null;
    assistanceChannel?.unsubscribe?.();
    assistanceChannel = null;
  }

  /* When a resident’s barangay popup opens, fetch weather and inject it into the popup container. */
  async function onBarangayPopupOpen(b: BarangayWithStatus, popupElement: HTMLElement) {
    const container = popupElement.querySelector('[data-weather-container]');
    if (!container) return;
    const { data, error } = await fetchWeatherForBarangay(b);
    if (error) {
      container.innerHTML = `<span style="color:#b91c1c;font-size:11px">${escapeHtml(error)}</span>`;
      return;
    }
    if (data) container.innerHTML = buildWeatherPopupHtml(data);
  }

  async function openBrochurePanel() {
    if (!lguBarangayInfo?.id) return;
    brochurePanelOpen = true;
    brochurePhotoError = '';
    const profile = await fetchBarangayProfile(lguBarangayInfo.id);
    brochureDescription = profile?.description ?? '';
    brochureExistingUrls = profile?.brochurePhotoUrls ?? [];
    brochurePhotoFiles = [];
  }

  function closeBrochurePanel() {
    brochurePanelOpen = false;
    brochureDescription = '';
    brochureExistingUrls = [];
    brochurePhotoFiles = [];
    brochurePhotoError = '';
  }

  function handleBrochurePhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const valid: File[] = [];
    let err = '';
    for (const f of files) {
      const msg = validateBrochurePhoto(f);
      if (msg) err = msg;
      else valid.push(f);
    }
    brochurePhotoFiles = valid;
    brochurePhotoError = err;
  }

  async function saveBrochure() {
    if (!lguBarangayInfo?.id) return;
    isSavingBrochure = true;
    locationError = '';
    brochurePhotoError = '';
    try {
      const newUrls: string[] = [];
      for (const f of brochurePhotoFiles) {
        const url = await uploadBrochurePhoto(f);
        if (url) newUrls.push(url);
      }
      const allUrls = [...brochureExistingUrls, ...newUrls];
      const { success, error } = await updateBarangayProfile(
        lguBarangayInfo.id,
        brochureDescription.trim(),
        allUrls
      );
      if (error) locationError = error;
      else if (success) {
        closeBrochurePanel();
        await refreshBarangayStatusLayer();
        locationSuccess = 'Barangay profile updated.';
      }
    } finally {
      isSavingBrochure = false;
    }
  }

  function removeBrochurePhoto(index: number) {
    brochureExistingUrls = brochureExistingUrls.filter((_, i) => i !== index);
  }

  function removeBrochurePhotoFile(index: number) {
    brochurePhotoFiles = brochurePhotoFiles.filter((_, i) => i !== index);
  }

  function handleAssistancePhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    assistancePhotoFile = null;
    assistancePhotoError = '';
    if (file) {
      const msg = validateAssistancePhoto(file);
      if (msg) assistancePhotoError = msg;
      else assistancePhotoFile = file;
    }
  }

  async function submitAssistance() {
    if (!assistanceBarangay || !lguUserId) return;
    if (assistanceDescription.trim().length < 3) {
      locationError = 'Please describe the assistance (at least 3 characters).';
      return;
    }
    isSubmittingAssistance = true;
    locationError = '';
    let imageUrl: string | null = null;
    if (assistancePhotoFile) {
      imageUrl = await uploadAssistancePhoto(assistancePhotoFile);
    }
    const arrival =
      assistanceExpectedArrival.trim() ?
        new Date(assistanceExpectedArrival.trim()).toISOString() :
        null;
    const { id, error } = await createAssistanceOffer(
      assistanceBarangay.id,
      assistanceDescription.trim(),
      lguUserId,
      {
        statusUpdateId: assistanceBarangay.statusUpdateId,
        expectedArrivalAt: arrival,
        imageUrl
      }
    );
    isSubmittingAssistance = false;
    if (error) locationError = error;
    else if (id) {
      assistanceDescription = '';
      assistanceExpectedArrival = '';
      assistancePhotoFile = null;
      assistancePhotoError = '';
      assistanceLog = await fetchAssistanceLogForBarangay(assistanceBarangay.id);
    }
  }

  async function handleMarkAssistanceDelivered(offerId: string) {
    const { error } = await markAssistanceDelivered(offerId);
    if (error) locationError = error;
    else if (assistanceBarangay)
      assistanceLog = await fetchAssistanceLogForBarangay(assistanceBarangay.id);
  }

  async function openJoinPanel() {
    joinPanelOpen = true;
    joinableBarangays = await fetchJoinableBarangays();
  }

  async function handleJoinBarangay(barangayId: string) {
    isJoining = true;
    locationError = '';
    try {
      const { success, error } = await joinBarangay(barangayId);
      if (error) locationError = error;
      else if (success) {
        joinPanelOpen = false;
        await onBarangayInfoChanged?.();
      }
    } finally {
      isJoining = false;
    }
  }

  async function openLeavePanel() {
    leavePanelOpen = true;
    leaveReason = '';
  }

  async function handleLeaveBarangay() {
    isLeaving = true;
    locationError = '';
    try {
      const { success, error } = await leaveBarangay(leaveReason.trim());
      if (error) locationError = error;
      else if (success) {
        leavePanelOpen = false;
        await onBarangayInfoChanged?.();
      }
    } finally {
      isLeaving = false;
    }
  }

  async function openMunicipalApprovalPanel() {
    municipalApprovalPanelOpen = true;
    municipalPendingRequests = await fetchPendingBoundaryRequestsForMunicipal();
    rejectingRequestId = null;
    rejectReason = '';
    clearMunicipalBoundaryPreview();
  }

  function locateBoundaryOnMap(geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | null) {
    if (!map || !leaflet || !geojson) return;
    try {
      if (municipalBoundaryPreviewLayer) {
        map.removeLayer(municipalBoundaryPreviewLayer);
        municipalBoundaryPreviewLayer = null;
      }
      const layer = leaflet.geoJSON(geojson as GeoJSON.GeoJsonObject, {
        style: {
          color: '#16a34a',
          weight: 3,
          fillColor: '#22c55e',
          fillOpacity: 0.35
        }
      });
      layer.addTo(map);
      municipalBoundaryPreviewLayer = layer;
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.flyToBounds(bounds, { padding: [80, 80], duration: 0.8 });
    } catch {
      locationError = 'Could not display boundary.';
    }
  }

  function clearMunicipalBoundaryPreview() {
    if (map && municipalBoundaryPreviewLayer) {
      map.removeLayer(municipalBoundaryPreviewLayer);
      municipalBoundaryPreviewLayer = null;
    }
  }

  function openRejectPanel(requestId: string) {
    rejectingRequestId = requestId;
    rejectReason = '';
  }

  function closeRejectPanel() {
    rejectingRequestId = null;
    rejectReason = '';
  }

  async function handleRejectBoundaryRequest() {
    if (!rejectingRequestId) return;
    isRejectingRequestId = rejectingRequestId;
    locationError = '';
    try {
      const { success, error } = await rejectBoundaryRequest(rejectingRequestId, rejectReason.trim());
      if (error) locationError = error;
      else if (success) {
        municipalPendingRequests = municipalPendingRequests.filter((r) => r.id !== rejectingRequestId);
        closeRejectPanel();
        clearMunicipalBoundaryPreview();
        locationSuccess = 'Boundary request rejected.';
      }
    } finally {
      isRejectingRequestId = null;
    }
  }

  async function handleApproveBoundaryRequest(requestId: string) {
    isApprovingRequestId = requestId;
    locationError = '';
    try {
      const { success, error } = await approveBoundaryRequest(requestId);
      if (error) locationError = error;
      else if (success) {
        municipalPendingRequests = await fetchPendingBoundaryRequestsForMunicipal();
        clearMunicipalBoundaryPreview();
        locationSuccess = 'Boundary request approved.';
        await refreshBarangayStatusLayer();
      }
    } finally {
      isApprovingRequestId = null;
    }
  }

  async function openDeleteRequestPanel() {
    deleteRequestPanelOpen = true;
    deleteReason = '';
  }

  async function handleRequestBarangayDelete() {
    if (!lguBarangayInfo?.id) return;
    isRequestingDelete = true;
    locationError = '';
    try {
      const { success, error } = await requestBarangayDelete(lguBarangayInfo.id, deleteReason.trim());
      if (error) locationError = error;
      else if (success) {
        deleteRequestPanelOpen = false;
        locationSuccess = 'Delete request submitted. Admin approval required.';
        await onBarangayInfoChanged?.();
      }
    } finally {
      isRequestingDelete = false;
    }
  }

  async function loadNotifications() {
    if (!lguUserId) return;
    notifications = await fetchNotifications(lguUserId);
    unreadCount = await countUnreadNotifications(lguUserId);
  }

  async function openNotifications() {
    // Toggle: if already open, close; otherwise open and close other overlays
    if (notificationsOpen) {
      notificationsOpen = false;
      return;
    }
    openMenu = null;
    residentNotificationsOpen = false;
    residentSidebarOpen = false;
    notificationsOpen = true;
    await loadNotifications();
  }

  async function handleMarkAllNotificationsRead() {
    if (!lguUserId) return;
    await markAllNotificationsRead(lguUserId);
    await loadNotifications();
  }

  /* Load DB-stored resident notifications (used for the badge count on mount and when
     opening the panel so the list is always fresh). */
  async function loadResidentNotifications() {
    if (!residentUserId) return;
    residentDbNotifications = await fetchNotifications(residentUserId);
  }

  async function openResidentNotifications() {
    /* Toggle — close if already open */
    if (residentNotificationsOpen) {
      residentNotificationsOpen = false;
      return;
    }
    /* Close any other open overlays */
    openMenu = null;
    notificationsOpen = false;
    residentSidebarOpen = false;
    activeSidebarPanel = null;
    await loadResidentNotifications();
    residentNotificationsOpen = true;
  }

  async function handleMarkAllResidentNotificationsRead() {
    if (!residentUserId) return;
    await markAllNotificationsRead(residentUserId);
    await loadResidentNotifications();
  }

  /** Parse focusReportId from notification link (e.g. /resident/dashboard?focusReportId=uuid). */
  function parseReportIdFromNotificationLink(link: string | null): string | null {
    if (!link) return null;
    try {
      const url = new URL(link, 'https://dummy');
      return url.searchParams.get('focusReportId');
    } catch {
      return null;
    }
  }

  /* Mark a single notification as read; then locate and view the report on the map (View). */
  async function handleResidentNotificationView(n: Notification) {
    if (n.readAt === null) await markNotificationRead(n.id);
    await loadResidentNotifications();
    residentNotificationsOpen = false;
    const reportId = parseReportIdFromNotificationLink(n.link);
    if (reportId) {
      await focusReportOnMap(reportId);
    } else if (n.link) {
      goto(n.link);
    }
  }

  /* Delete one notification and refresh the list. */
  async function handleResidentNotificationDelete(notificationId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await deleteNotification(notificationId);
    await loadResidentNotifications();
  }

  async function toggleMinglanillaBorder() {
    if (!map || !leaflet) return;
    if (minglanillaBorderVisible) {
      if (minglanillaBorderLayer) {
        map.removeLayer(minglanillaBorderLayer);
        minglanillaBorderLayer = null;
      }
      minglanillaBorderVisible = false;
      return;
    }
    try {
      const res = await fetch('/geojson/minglanilla-boundary.geojson');
      const geojson = await res.json();
      const layer = leaflet.geoJSON(geojson as GeoJSON.GeoJsonObject, {
        style: {
          color: '#3b82f6',
          weight: 2.5,
          fillColor: '#3b82f6',
          fillOpacity: 0.08
        }
      });
      layer.addTo(map);
      minglanillaBorderLayer = layer;
      minglanillaBorderVisible = true;
    } catch {
      locationError = 'Could not load Minglanilla boundary.';
    }
  }

  function updateDetectedBarangay() {
    if (latitude == null || longitude == null || barangaysWithStatus.length === 0) {
      detectedBarangayName = 'Not Detected';
      return;
    }
    const lat = latitude;
    const lon = longitude;
    // Simple point-in-polygon check over all barangay boundaries
    for (const b of barangaysWithStatus) {
      const geo = b.boundaryGeojson as GeoJSON.Geometry | null | undefined;
      if (!geo) continue;
      if (geometryContainsPoint(geo, lat, lon)) {
        detectedBarangayName = b.name;
        return;
      }
    }
    detectedBarangayName = 'Not Detected';
  }

  function geometryContainsPoint(geometry: GeoJSON.Geometry, lat: number, lon: number): boolean {
    if (geometry.type === 'Polygon') {
      return polygonContainsPoint(geometry.coordinates, lat, lon);
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some((poly) => polygonContainsPoint(poly, lat, lon));
    }
    return false;
  }

  function polygonContainsPoint(
    coordinates: GeoJSON.Position[][],
    lat: number,
    lon: number
  ): boolean {
    // Ray casting algorithm on the outer ring (first element)
    const ring = coordinates[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [lonI, latI] = ring[i] as [number, number];
      const [lonJ, latJ] = ring[j] as [number, number];
      const intersect =
        latI > lat !== latJ > lat &&
        lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI + 0.0000001) + lonI;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Returns the barangay that contains the given point, or null. Used for resident report (detect which barangay they are in). */
  function getBarangayAtLocation(lat: number, lon: number): { id: string; name: string } | null {
    for (const b of barangaysWithStatus) {
      const geo = b.boundaryGeojson as GeoJSON.Geometry | null | undefined;
      if (!geo) continue;
      if (geometryContainsPoint(geo, lat, lon)) return { id: b.id, name: b.name };
    }
    return null;
  }

  async function getMyLocation() {
    if (!map || !leaflet) return;
    if (!navigator.geolocation) {
      locationError = 'Geolocation is not supported by your browser.';
      return;
    }
    isLocating = true;
    locationError = '';
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        });
      });
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      latitude = lat;
      longitude = lon;
      if (marker) map.removeLayer(marker);
      map.flyTo([lat, lon], 16, { duration: 1.5 });
      /* Navy teardrop pin — matches the system's primary color so residents
         instantly recognise the "you are here" marker vs report markers. */
      const locationPinIcon = leaflet.divIcon({
        className: '',
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 20 26"><path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#1B2E3A" stroke="white" stroke-width="1.5"/><circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/></svg>`,
        iconSize: [28, 36],
        iconAnchor: [14, 36],
        popupAnchor: [0, -36]
      });
      marker = leaflet
        .marker([lat, lon], { icon: locationPinIcon })
        .addTo(map);
      const address = await reverseGeocode(lat, lon);
      locationText = address;
      updateDetectedBarangay();
      if (mode === 'resident') {
        // Persist the successful location lookup for the rest of this tab session.
        saveResidentLocation({
          latitude: lat,
          longitude: lon,
          locationText: address,
          detectedBarangayName,
          savedAt: Date.now()
        });
      }
    } catch (err: unknown) {
      const geo = err as GeolocationPositionError;
      if (geo.code === 1) locationError = 'Location permission denied. Please allow access in your browser settings.';
      else if (geo.code === 2) locationError = 'Location unavailable. Check your GPS or internet connection.';
      else if (geo.code === 3) locationError = 'Location request timed out. Please try again.';
      else locationError = (err as Error).message || 'Could not determine your location.';
    } finally {
      isLocating = false;
    }
  }

  /* Restore a previously saved resident location when returning to the dashboard. */
  function restoreResidentLocationFromSession() {
    if (mode !== 'resident') return;
    const stored = loadResidentLocation();
    if (!stored || !map || !leaflet) return;
    latitude = stored.latitude;
    longitude = stored.longitude;
    locationText = stored.locationText;
    detectedBarangayName = stored.detectedBarangayName || detectedBarangayName;
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
    const locationPinIcon = leaflet.divIcon({
      className: '',
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 20 26"><path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#1B2E3A" stroke="white" stroke-width="1.5"/><circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/></svg>`,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -36]
    });
    map.setView([stored.latitude, stored.longitude], 16);
    marker = leaflet
      .marker([stored.latitude, stored.longitude], { icon: locationPinIcon })
      .addTo(map);
  }

  async function toggleHazardLayer(hazardType: HazardType) {
    if (!map || !leaflet) return;
    if (activeHazardLayers[hazardType]) {
      map.removeLayer(activeHazardLayers[hazardType]);
      delete activeHazardLayers[hazardType];
      return;
    }
    const config = HAZARD_LAYERS.find((h) => h.type === hazardType);
    if (!config) return;
    loadingHazards[hazardType] = true;
    try {
      const geojsonData = await loadHazardGeoJSON(config.geojsonPath);
      const layer = createHazardLayer(leaflet, geojsonData, config);
      layer.addTo(map);
      activeHazardLayers[hazardType] = layer;
    } catch {
      locationError = `Could not load ${config.label} data.`;
    } finally {
      delete loadingHazards[hazardType];
    }
  }

  function isHazardActive(hazardType: HazardType): boolean {
    return hazardType in activeHazardLayers;
  }
  function activeLayerCount(): number {
    return Object.keys(activeHazardLayers).length;
  }

  /* ── Hazard report: open panel, capture location first, then show form. Residents: barangay is detected from location (no affiliation required). ── */
  async function openReportPanel() {
    const userId = mode === 'resident' ? residentUserId : mode === 'lgu' ? lguUserId : 'guest-reporter';
    if (mode !== 'guest' && !userId) return;

    if (mode === 'lgu') {
      if (!lguBarangayInfo?.id) return;
      reportBarangayId = lguBarangayInfo.id;
      reportBarangayName = lguBarangayInfo.name ?? '';
    } else {
      // For residents, ensure we have a current location first so the report
      // can reuse it and be persisted for the session.
      if (latitude == null || longitude == null) {
        await getMyLocation();
      }
      if (latitude == null || longitude == null) {
        // If location is still not available (denied / error), do not open the form.
        return;
      }
      const where = getBarangayAtLocation(latitude, longitude);
      if (where) {
        reportBarangayId = where.id;
        reportBarangayName = where.name;
      } else {
        reportBarangayId = null;
        reportBarangayName = '';
      }
    }

    reportPanelOpen = true;
    reportTitle = '';
    reportDescription = '';
    reportPhotoFiles = [];
    reportVideoFiles = [];
    reportMediaError = '';
    reportCreateProfile = null;

    if (mode === 'lgu' && lguBarangayInfo?.id) {
      const profile = await fetchBarangayProfile(lguBarangayInfo.id);
      reportCreateProfile = profile ? { brochurePhotoUrls: profile.brochurePhotoUrls } : null;
    }

    if (!navigator.geolocation) {
      locationError = 'Geolocation is required to report. Enable it in your browser.';
      return;
    }
    isLocating = true;
    locationError = '';
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        });
      });
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      latitude = lat;
      longitude = lon;
      /* Reuse the same "Current Location" marker instead of a second report marker. */
      const locationPinIcon = leaflet!.divIcon({
        className: '',
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 20 26"><path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#1B2E3A" stroke="white" stroke-width="1.5"/><circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/></svg>`,
        iconSize: [28, 36],
        iconAnchor: [14, 36],
        popupAnchor: [0, -36]
      });
      if (marker && map) {
        marker.setLatLng([lat, lon]);
        marker.setIcon(locationPinIcon);
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else if (map && leaflet) {
        marker = leaflet.marker([lat, lon], { icon: locationPinIcon }).addTo(map);
      }
      map?.flyTo([lat, lon], 16, { duration: 1 });
      updateDetectedBarangay();

      // Residents and guests both need barangay from the captured GPS point for reporting.
      if (mode === 'resident' || mode === 'guest') {
        const at = getBarangayAtLocation(lat, lon);
        if (at) {
          reportBarangayId = at.id;
          reportBarangayName = at.name;
          const profile = await fetchBarangayProfile(at.id);
          reportCreateProfile = profile ? { brochurePhotoUrls: profile.brochurePhotoUrls } : null;
        } else {
          locationError = 'Your location is not within a barangay boundary. Move inside a barangay area and try again.';
        }
      }
    } catch (err: unknown) {
      const geo = err as GeolocationPositionError;
      if (geo.code === 1) locationError = 'Location permission denied. Please allow access to report.';
      else if (geo.code === 2) locationError = 'Location unavailable. Enable GPS to report.';
      else if (geo.code === 3) locationError = 'Location request timed out. Please try again.';
      else locationError = (err as Error).message || 'Could not get location.';
    } finally {
      isLocating = false;
    }
  }

  function closeReportPanel() {
    reportPhotoPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    reportVideoPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    reportPanelOpen = false;
    reportBarangayId = null;
    reportBarangayName = '';
    reportTitle = '';
    reportDescription = '';
    reportPhotoFiles = [];
    reportVideoFiles = [];
    reportPhotoPreviewUrls = [];
    reportVideoPreviewUrls = [];
    reportMediaError = '';
    reportCreateProfile = null;
  }

  function handleReportPhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const valid: File[] = [];
    let err = '';
    for (const f of files) {
      const msg = validateReportPhoto(f);
      if (msg) err = msg;
      else valid.push(f);
    }
    const newUrls = valid.map((f) => URL.createObjectURL(f));
    reportPhotoFiles = [...reportPhotoFiles, ...valid];
    reportPhotoPreviewUrls = [...reportPhotoPreviewUrls, ...newUrls];
    reportMediaError = err;
    input.value = '';
  }

  function handleReportVideoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const valid: File[] = [];
    let err = '';
    for (const f of files) {
      const msg = validateReportVideo(f);
      if (msg) err = msg;
      else valid.push(f);
    }
    const newUrls = valid.map((f) => URL.createObjectURL(f));
    reportVideoFiles = [...reportVideoFiles, ...valid];
    reportVideoPreviewUrls = [...reportVideoPreviewUrls, ...newUrls];
    reportMediaError = err;
    input.value = '';
  }

  function removeReportPhoto(index: number) {
    URL.revokeObjectURL(reportPhotoPreviewUrls[index]);
    reportPhotoFiles = reportPhotoFiles.filter((_, i) => i !== index);
    reportPhotoPreviewUrls = reportPhotoPreviewUrls.filter((_, i) => i !== index);
  }

  function removeReportVideo(index: number) {
    URL.revokeObjectURL(reportVideoPreviewUrls[index]);
    reportVideoFiles = reportVideoFiles.filter((_, i) => i !== index);
    reportVideoPreviewUrls = reportVideoPreviewUrls.filter((_, i) => i !== index);
  }

  async function submitReport() {
    const barangayId = mode === 'resident' || mode === 'guest' ? reportBarangayId : lguBarangayInfo?.id;
    const reporterUserId = mode === 'resident' ? residentUserId : mode === 'lgu' ? lguUserId : '';

    if ((mode === 'resident' || mode === 'guest') && !reportBarangayId) {
      locationError = 'Your location is not within a barangay boundary. Move inside a barangay area and try again.';
      return;
    }
    if (mode === 'resident' || mode === 'lgu') {
      if (!reporterUserId?.trim()) {
        locationError =
          mode === 'resident' ? 'You must be signed in to submit a report.' : 'Session expired. Please sign in again.';
        return;
      }
    }
    if (!barangayId || latitude == null || longitude == null) return;
    const title = reportTitle.trim();
    if (title.length < 2) {
      locationError = 'Please enter a title (at least 2 characters).';
      return;
    }
    if (reportDescription.trim().length < 5) {
      locationError = 'Please describe the situation (at least 5 characters).';
      return;
    }
    if (reportPhotoFiles.length + reportVideoFiles.length < 1) {
      locationError = 'Please attach at least one photo or video before submitting.';
      return;
    }
    isSubmittingReport = true;
    locationError = '';
    reportMediaError = '';
    try {
      const photoUrls: string[] = [];
      for (const f of reportPhotoFiles) {
        const url = await uploadReportPhoto(f);
        if (url) photoUrls.push(url);
      }
      const videoUrls: string[] = [];
      for (const f of reportVideoFiles) {
        const url = await uploadReportVideo(f);
        if (url) videoUrls.push(url);
      }
      let result: { id: string | null; error: string | null };
      if (mode === 'guest') {
        const res = await fetch('/api/reports/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barangayId: reportBarangayId,
            title,
            description: reportDescription.trim(),
            gpsLat: latitude,
            gpsLng: longitude,
            photoUrls,
            videoUrls
          })
        });
        let body: { id?: string | null; error?: string | null } = {};
        try {
          body = (await res.json()) as typeof body;
        } catch {
          locationError = 'Could not reach the server. Check your connection and try again.';
          return;
        }
        result = {
          id: body.id ?? null,
          error: body.error ?? (!res.ok ? 'Submit failed. Please try again.' : null)
        };
      } else {
        result = await createHazardReport({
          barangayId: barangayId,
          reporterId: reporterUserId,
          title,
          description: reportDescription.trim(),
          gpsLat: latitude,
          gpsLng: longitude,
          photoUrls,
          videoUrls
        });
      }
      const { id, error } = result;
      if (error) locationError = error;
      else if (id) {
        closeReportPanel();
        locationSuccess = 'Report submitted successfully.';
        await refreshReportMarkers();
        if (mode === 'resident') {
          await loadUserContributions();
        }
      }
    } finally {
      isSubmittingReport = false;
    }
  }

  async function openReportDetail(r: HazardReport) {
    selectedReport = r;
    await refreshSelectedReportState(r.id);
  }

  function closeReportDetail() {
    selectedReport = null;
    selectedReportComments = [];
    selectedReportCommentDraft = '';
    selectedReportCommentPhotos = [];
    selectedReportSubmitting = false;
    selectedReportHasUpvoted = false;
    selectedReportCommentVisibleTopCount = 0;
    selectedReportReplyVisibleCounts = {};
    selectedReportReplyTarget = null;
    selectedReportReplyDrafts = {};
    selectedReportReplyPhotos = {};
    selectedReportActiveCommentFocus = false;
  }

  function buildReportTooltipHtml(r: HazardReport): string {
    const title = escapeHtml(r.title ?? 'Report');
    const upvotes = (r as { upvoteCount?: number }).upvoteCount ?? 0;
    const comments = (r as { commentCount?: number }).commentCount ?? 0;
    const dateStr = r.createdAt
      ? new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const meta = `${upvotes} upvote${upvotes !== 1 ? 's' : ''} · ${comments} comment${comments !== 1 ? 's' : ''} · ${escapeHtml(dateStr)}`;
    const firstImg = r.photoUrls?.[0];
    if (firstImg) {
      return `<div class="report-tooltip-with-img" style="background:#0C212F;color:white;border:1px solid rgba(255,255,255,0.2);border-radius:10px;overflow:hidden;display:flex;min-width:200px;max-width:260px">
        <div style="width:72px;height:72px;flex-shrink:0;overflow:hidden;background:rgba(255,255,255,0.08)">
          <img src="${escapeHtml(firstImg)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" />
        </div>
        <div style="flex:1;min-width:0;padding:8px 10px;display:flex;flex-direction:column;gap:4px;justify-content:center">
          <div style="font-size:12px;font-weight:500;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${title}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.7)">${meta}</div>
        </div>
      </div>`;
    }
    return `<div style="background:#0C212F;color:white;border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:8px 10px;min-width:120px">
      <div style="font-size:12px;font-weight:500">${title}</div>
      <div style="margin-top:6px;font-size:10px;color:rgba(255,255,255,0.7)">${meta}</div>
    </div>`;
  }

  async function refreshReportMarkers() {
    if (!map || !leaflet) return;
    hazardReports = await fetchAllHazardReports();
    if (reportMarkersLayer) {
      map.removeLayer(reportMarkersLayer);
      reportMarkersLayer = null;
    }
    reportMarkerById = {};
    if (hazardReports.length === 0) return;
    /* Compact red circle marker for hazard/disaster reports — slightly smaller
       than the original 24 px to reduce visual clutter on dense map areas. */
    const hazardIcon = leaflet.divIcon({
      className: '',
      html: '<div style="width:20px;height:20px;background:#dc2626;border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    const group = leaflet.layerGroup();
    for (const r of hazardReports) {
      if (r.gpsLat == null || r.gpsLng == null) continue;
      const m = leaflet.marker([r.gpsLat, r.gpsLng], { icon: hazardIcon });
      m.on('click', () => openReportDetail(r));
      m.bindTooltip(buildReportTooltipHtml(r), { direction: 'top', className: 'hazard-marker-tooltip', offset: [0, -8] });
      group.addLayer(m);
      reportMarkerById = { ...reportMarkerById, [r.id]: m };
    }
    group.addTo(map);
    reportMarkersLayer = group;
  }

  /** Batch multiple Realtime events (e.g. several clients reporting) into one UI refresh. */
  function scheduleRealtimeReportsRefresh() {
    if (reportsRealtimeDebounceTimer) clearTimeout(reportsRealtimeDebounceTimer);
    reportsRealtimeDebounceTimer = setTimeout(() => {
      reportsRealtimeDebounceTimer = null;
      void applyRealtimeReportsRefresh();
    }, 200);
  }

  /** Reload markers from DB, keep the open detail panel in sync, and refresh resident lists that depend on reports. */
  async function applyRealtimeReportsRefresh() {
    await refreshReportMarkers();
    const open = selectedReport;
    if (open) {
      const next = hazardReports.find((r) => r.id === open.id);
      if (next) selectedReport = { ...next };
      else closeReportDetail();
    }
    if (mode === 'resident') void loadLocalBarangayReports();
    if (mode === 'resident' && residentUserId) void loadUserContributions();
  }

  async function refreshSelectedReportState(reportId: string) {
    selectedReportComments = await fetchReportNotes(reportId);
    const topLevel = selectedReportComments.filter((n) => !n.parentNoteId);
    selectedReportCommentVisibleTopCount = topLevel.length === 0 ? 0 : Math.min(2, topLevel.length);
    const replyCounts: Record<string, number> = {};
    for (const note of topLevel) {
      const replies = selectedReportComments.filter((n) => n.parentNoteId === note.id);
      replyCounts[note.id] = Math.min(2, replies.length);
    }
    selectedReportReplyVisibleCounts = replyCounts;
    if (!signedInUserId) {
      selectedReportHasUpvoted = false;
      return;
    }
    const { data, error } = await supabase
      .from('report_upvotes')
      .select('id')
      .eq('report_id', reportId)
      .eq('user_id', signedInUserId)
      .limit(1);
    if (error) {
      selectedReportHasUpvoted = false;
      return;
    }
    selectedReportHasUpvoted = (data ?? []).length > 0;
  }

  async function submitSelectedReportComment() {
    if (!selectedReport || !canCommentSelectedReport || !signedInUserId) return;
    const draft = selectedReportCommentDraft.trim();
    if (draft.length < 2) {
      locationError = 'Comment must be at least 2 characters long.';
      return;
    }
    selectedReportSubmitting = true;
    const photoUrls = [...selectedReportCommentPhotos];
    const { error } = await createReportNote(selectedReport.id, draft, { photoUrls });
    selectedReportSubmitting = false;
    if (error) {
      locationError = error;
      return;
    }
    selectedReportCommentDraft = '';
    selectedReportCommentPhotos = [];
    await refreshSelectedReportState(selectedReport.id);
    await refreshReportMarkers();
    /* Notify the report owner if someone else commented on their report. */
    if (selectedReport.reporterId && selectedReport.reporterId !== signedInUserId) {
      const link = `/resident/dashboard?focusReportId=${encodeURIComponent(selectedReport.id)}`;
      await createNotification(selectedReport.reporterId, 'New comment on your report', 'Someone commented on your report.', link);
    }
  }

  async function toggleSelectedReportUpvote() {
    if (!selectedReport || !canUpvoteSelectedReport) return;
    selectedReportTogglingUpvote = true;
    const { hasUpvoted, error } = await toggleReportUpvote(selectedReport.id);
    selectedReportTogglingUpvote = false;
    if (error) {
      locationError = error;
      return;
    }
    selectedReportHasUpvoted = hasUpvoted;
    // Update local selectedReport + hazardReports counts optimistically
    const delta = hasUpvoted ? 1 : -1;
    selectedReport = {
      ...selectedReport,
      upvoteCount: Math.max(0, (selectedReport.upvoteCount ?? 0) + delta)
    };
    hazardReports = hazardReports.map((r) =>
      r.id === selectedReport!.id
        ? { ...r, upvoteCount: Math.max(0, (r.upvoteCount ?? 0) + delta) }
        : r
    );
    // Keep contributions list in sync if present
    userContributions = userContributions.map((r) =>
      r.id === selectedReport!.id
        ? { ...r, upvoteCount: Math.max(0, (r.upvoteCount ?? 0) + delta) }
        : r
    );
    /* Notify the report owner when someone else upvotes their report (only on new upvote). */
    if (hasUpvoted && selectedReport.reporterId && selectedReport.reporterId !== signedInUserId) {
      const link = `/resident/dashboard?focusReportId=${encodeURIComponent(selectedReport.id)}`;
      await createNotification(selectedReport.reporterId, 'New upvote on your report', 'Someone upvoted your report.', link);
    }
  }

  /* Focus a specific report on the map by ID and highlight it for the resident. */
  async function focusReportOnMap(reportId: string) {
    if (!map || !leaflet) return;
    if (!hazardReports.length) {
      await refreshReportMarkers();
    }
    const report = hazardReports.find((r) => r.id === reportId);
    if (!report || report.gpsLat == null || report.gpsLng == null) return;
    const markerForReport = reportMarkerById[report.id];
    const center: [number, number] = [report.gpsLat, report.gpsLng];
    map.flyTo(center, 16, { duration: 1.2 });
    if (markerForReport && typeof markerForReport.openTooltip === 'function') {
      markerForReport.openTooltip();
    }
    // Also open the full report detail panel so it feels clearly highlighted.
    openReportDetail(report);
  }

  /* Locate a report on the map only (fly to marker + tooltip), without opening the detail modal. */
  async function locateReportOnMap(reportId: string) {
    if (!map || !leaflet) return;
    if (!hazardReports.length) {
      await refreshReportMarkers();
    }
    const report = hazardReports.find((r) => r.id === reportId);
    if (!report || report.gpsLat == null || report.gpsLng == null) return;
    const markerForReport = reportMarkerById[report.id];
    const center: [number, number] = [report.gpsLat, report.gpsLng];
    map.flyTo(center, 16, { duration: 1.2 });
    if (markerForReport && typeof markerForReport.openTooltip === 'function') {
      markerForReport.openTooltip();
    }
  }

  async function loadUserContributions() {
    if (mode !== 'resident' || !residentUserId) return;
    userContributions = await fetchReportsByReporter(residentUserId);
  }

  function openContributionEdit(r: HazardReport) {
    contributionEditReport = r;
    contributionEditTitle = r.title ?? '';
    contributionEditDescription = r.description ?? '';
    contributionEditPhotoUrls = [...(r.photoUrls ?? [])];
    contributionEditVideoUrls = [...(r.videoUrls ?? [])];
    contributionError = '';
  }

  function closeContributionEdit() {
    contributionEditReport = null;
    contributionError = '';
  }

  function removeContributionEditPhoto(i: number) {
    contributionEditPhotoUrls = contributionEditPhotoUrls.filter((_, idx) => idx !== i);
  }

  function removeContributionEditVideo(i: number) {
    contributionEditVideoUrls = contributionEditVideoUrls.filter((_, idx) => idx !== i);
  }

  async function addContributionEditPhotos(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      const url = await uploadReportPhoto(file);
      if (url) contributionEditPhotoUrls = [...contributionEditPhotoUrls, url];
    }
  }

  async function addContributionEditVideos(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      const url = await uploadReportVideo(file);
      if (url) contributionEditVideoUrls = [...contributionEditVideoUrls, url];
    }
  }

  async function saveContributionEdit() {
    if (!contributionEditReport || !residentUserId) return;
    const title = contributionEditTitle.trim();
    if (title.length < 2) {
      contributionError = 'Title must be at least 2 characters.';
      return;
    }
    if (contributionEditDescription.trim().length < 5) {
      contributionError = 'Description must be at least 5 characters.';
      return;
    }
    contributionSaving = true;
    contributionError = '';
    const { error } = await updateHazardReport(contributionEditReport.id, residentUserId, {
      title,
      description: contributionEditDescription.trim(),
      photoUrls: contributionEditPhotoUrls,
      videoUrls: contributionEditVideoUrls
    });
    contributionSaving = false;
    if (error) contributionError = error;
    else {
      closeContributionEdit();
      await loadUserContributions();
      await refreshReportMarkers();
    }
  }

  function openContributionDelete(r: HazardReport) {
    contributionDeleteReport = r;
    contributionDeleteError = '';
  }

  function closeContributionDelete() {
    contributionDeleteReport = null;
    contributionDeleteError = '';
  }

  async function confirmContributionDelete() {
    if (!contributionDeleteReport || !residentUserId) return;
    contributionDeleting = true;
    contributionDeleteError = '';
    const { error } = await deleteHazardReport(contributionDeleteReport.id, residentUserId);
    contributionDeleting = false;
    if (error) {
      contributionDeleteError = error;
      return;
    }
    closeContributionDelete();
    await loadUserContributions();
    await refreshReportMarkers();
  }

  function formatContributionDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isReportEdited(r: HazardReport): boolean {
    const u = r.updatedAt;
    if (!u) return false;
    return new Date(u).getTime() > new Date(r.createdAt).getTime() + 1000;
  }

  function initialsFromName(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function timeAgo(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(isoString).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getSelectedReportTopLevelNotes(): Awaited<ReturnType<typeof fetchReportNotes>> {
    const notes = selectedReportComments;
    return notes.filter((n) => !n.parentNoteId);
  }

  function getSelectedReportRepliesForNote(parentNoteId: string): Awaited<ReturnType<typeof fetchReportNotes>> {
    return selectedReportComments.filter((n) => n.parentNoteId === parentNoteId);
  }

  function showMoreSelectedReportComments() {
    const allTop = getSelectedReportTopLevelNotes();
    const next = Math.min(allTop.length, selectedReportCommentVisibleTopCount + 5);
    selectedReportCommentVisibleTopCount = next;
  }

  function showMoreSelectedReportReplies(parentNoteId: string) {
    const allReplies = getSelectedReportRepliesForNote(parentNoteId);
    const current = selectedReportReplyVisibleCounts[parentNoteId] ?? Math.min(2, allReplies.length);
    const next = Math.min(allReplies.length, current + 5);
    selectedReportReplyVisibleCounts = { ...selectedReportReplyVisibleCounts, [parentNoteId]: next };
  }

  function startSelectedReportReply(noteId: string) {
    selectedReportReplyTarget = noteId;
  }

  function cancelSelectedReportReply() {
    selectedReportReplyTarget = null;
  }

  async function submitSelectedReportReply(parentNoteId: string) {
    if (!selectedReport || !canCommentSelectedReport || !signedInUserId) return;
    const draft = (selectedReportReplyDrafts[parentNoteId] ?? '').trim();
    if (draft.length < 2) {
      locationError = 'Reply must be at least 2 characters long.';
      return;
    }
    selectedReportSubmittingReplyFor = parentNoteId;
    const photoUrls = selectedReportReplyPhotos[parentNoteId] ?? [];
    const { error } = await createReportNote(selectedReport.id, draft, { photoUrls, parentNoteId });
    selectedReportSubmittingReplyFor = null;
    if (error) {
      locationError = error;
      return;
    }
    const nextDrafts = { ...selectedReportReplyDrafts };
    delete nextDrafts[parentNoteId];
    selectedReportReplyDrafts = nextDrafts;
    const nextPhotos = { ...selectedReportReplyPhotos };
    delete nextPhotos[parentNoteId];
    selectedReportReplyPhotos = nextPhotos;
    if (selectedReportReplyTarget === parentNoteId) selectedReportReplyTarget = null;
    await refreshSelectedReportState(selectedReport.id);
    await refreshReportMarkers();
  }

  function removeSelectedReportReplyPhoto(parentNoteId: string, url: string) {
    const existing = selectedReportReplyPhotos[parentNoteId] ?? [];
    const next = existing.filter((u) => u !== url);
    if (next.length === 0) {
      const copy = { ...selectedReportReplyPhotos };
      delete copy[parentNoteId];
      selectedReportReplyPhotos = copy;
    } else {
      selectedReportReplyPhotos = { ...selectedReportReplyPhotos, [parentNoteId]: next };
    }
  }

  function removeSelectedReportCommentPhoto(url: string) {
    selectedReportCommentPhotos = selectedReportCommentPhotos.filter((u) => u !== url);
  }

  onMount(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const teardownFullscreen = setupFullscreenListener();

    (async () => {
      const L = (await import('leaflet')).default;
      (globalThis as unknown as { L: typeof L }).L = L;
      await import('leaflet-draw');
      leaflet = L;

      L.Marker.prototype.options.icon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      map = L.map(mapElement, { zoomControl: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(map);
      /* LGU keeps Leaflet zoom controls; resident and guest use custom controls. */
      if (mode === 'lgu') {
        L.control.zoom({ position: 'topleft' }).addTo(map);
      }

      try {
        await refreshBarangayStatusLayer();
        realtimeChannel = subscribeBarangayStatusRealtime(() => refreshBarangayStatusLayer());
      } catch {
        /* Barangay layer may fail if tables not set up; map still works */
      }

      try {
        reportsChannel = subscribeReportsRealtime(() => scheduleRealtimeReportsRefresh());
      } catch {
        /* Realtime requires `reports` in publication supabase_realtime (see migration 20260426). */
      }

      try {
        if (mode === 'lgu' && lguUserId) {
          unreadCount = await countUnreadNotifications(lguUserId);
        }
        /* Pre-load resident notifications and subscribe to new ones so the badge updates in real time */
        if (mode === 'resident' && residentUserId) {
          await loadResidentNotifications();
          residentNotificationsChannel = supabase
            .channel('resident-notifications')
            .on(
              'postgres_changes',
              { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${residentUserId}` },
              () => loadResidentNotifications()
            )
            .on(
              'postgres_changes',
              { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${residentUserId}` },
              () => loadResidentNotifications()
            )
            .on(
              'postgres_changes',
              { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${residentUserId}` },
              () => loadResidentNotifications()
            )
            .subscribe();
          // Restore a previously saved location so residents do not have to keep
          // tapping "Get My Location" as they move between feed and dashboard.
          restoreResidentLocationFromSession();
          // If the page was opened with an action from another screen, perform it now.
          if (initialResidentAction === 'openReport') {
            await openReportPanel();
          }
          if (initialReportIdToFocus) {
            await focusReportOnMap(initialReportIdToFocus);
          }
        }
      } catch {
        /* Notifications or resident bootstrap may fail without blocking the map */
      }
    })();

    return teardownFullscreen;
  });

  onDestroy(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (reportsRealtimeDebounceTimer) clearTimeout(reportsRealtimeDebounceTimer);
    realtimeChannel?.unsubscribe?.();
    assistanceChannel?.unsubscribe?.();
    reportsChannel?.unsubscribe?.();
    residentNotificationsChannel?.unsubscribe?.();
    if (typeof document !== 'undefined') {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    cancelDrawBoundary();
    map?.remove();
  });
</script>

<svelte:head>
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin=""
  />
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css"
    crossorigin=""
  />
</svelte:head>

<style>
  :global(.map-dashboard-wrapper .leaflet-top.leaflet-left) {
    top: 3.5rem;
    left: 0.75rem;
  }
  :global(.hazard-report-marker) {
    background: transparent !important;
    border: none !important;
  }
  :global(.hazard-marker-tooltip) {
    background: #0C212F !important;
    color: white !important;
    border: 1px solid rgba(255,255,255,0.2) !important;
    border-radius: 8px !important;
    font-size: 12px !important;
    padding: 6px 10px !important;
  }
  .scrollbar-hide {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  /* Slim dark scrollbar that matches the system's navy theme */
  .sidebar-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.18) rgba(255,255,255,0.04);
  }
  .sidebar-scroll::-webkit-scrollbar {
    width: 5px;
  }
  .sidebar-scroll::-webkit-scrollbar-track {
    background: rgba(255,255,255,0.04);
    border-radius: 3px;
  }
  .sidebar-scroll::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.18);
    border-radius: 3px;
  }
  .sidebar-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(255,255,255,0.30);
  }
  :global(.hazard-marker-tooltip .report-tooltip-with-img) {
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  /* Contribution sort dropdown: options visible when opened (native select) */
  :global(.contribution-sort-select option) {
    background: #fff;
    color: #111;
  }
</style>

<div id={mapRootId} class="fixed inset-0 flex flex-col bg-[#0C212F]">
  <header class="h-12 md:h-14 shrink-0 bg-[#0C212F]/95 shadow-md z-50 border-b border-white/10">
    <div class="h-full mx-auto flex items-center justify-between gap-2 px-3 md:px-4 max-w-screen-xl relative">
      <div class="flex items-center gap-2 md:gap-3 relative z-20 shrink-0">
        {#if openMenu || notificationsOpen || residentNotificationsOpen || guestNotificationOpen}
          <button class="fixed inset-0 z-10 cursor-default" onclick={close} aria-label="Close menu"></button>
        {/if}
        <div class="flex items-center gap-2 bg-[#768391]/10 rounded-full px-2 md:px-3 py-1 relative z-20">
          <div class="relative">
            <button
              class="bg-white/20 text-white rounded-full w-7 h-7 md:w-8 md:h-8 flex items-center justify-center text-[10px] md:text-xs font-bold hover:bg-white/30 transition cursor-pointer touch-manipulation"
              onclick={() => { if (mode !== 'lgu') { residentSidebarOpen = false; activeSidebarPanel = null; } toggle('pfp'); }}
            >
              {userInitials || userLabel.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
            </button>
            {#if openMenu === 'pfp'}
              <div class="absolute left-0 mt-3 w-48 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30">
                <p class="px-3 py-2 text-[10px] text-gray-400 border-b border-gray-100">{userLabel}</p>
                <div class="p-2">
                  {#each (pfpMenuItems && pfpMenuItems.length > 0 ? pfpMenuItems : menuItems) as item}
                    {#if item.href}
                      <a href={item.href} class="block px-3 py-2 hover:bg-gray-50 rounded-lg text-xs text-[#1B2E3A]">{item.label}</a>
                    {:else if item.action}
                      <button
                        class="block w-full text-left px-3 py-2 hover:bg-gray-50 rounded-lg text-xs text-[#1B2E3A]"
                        onclick={() => { item.action?.(); close(); }}
                      >
                        {item.label}
                      </button>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
          {#if mode === 'lgu' && lguUserId}
            <div class="relative">
              <button class="cursor-pointer p-1 touch-manipulation relative" onclick={openNotifications} aria-label="Notifications">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75v-.7V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {#if unreadCount > 0}
                  <span class="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>
                {/if}
              </button>
              {#if notificationsOpen}
                <div class="absolute left-0 mt-3 w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30 flex flex-col">
                  <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 shrink-0">
                    <span class="text-[#1B2E3A] text-xs font-semibold">Notifications</span>
                    <div class="flex gap-1">
                      {#if unreadCount > 0}
                        <button onclick={handleMarkAllNotificationsRead} class="text-cyan-600 text-[10px] hover:underline">Mark all read</button>
                      {/if}
                      <button onclick={() => (notificationsOpen = false)} class="text-gray-400 hover:text-[#1B2E3A] transition cursor-pointer text-sm" aria-label="Close">&times;</button>
                    </div>
                  </div>
                  <div class="overflow-y-auto min-h-0 flex-1">
                    {#if notifications.length === 0}
                      <p class="px-3 py-4 text-gray-500 text-xs">No notifications.</p>
                    {:else}
                      <div class="divide-y divide-gray-100">
                        {#each notifications as n}
                          <a
                            href={n.link ?? '#'}
                            class="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 transition {n.readAt ? 'opacity-70' : ''}"
                            onclick={() => (notificationsOpen = false)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-4 h-4 mt-0.5 shrink-0">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 17.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                            </svg>
                            <div class="flex-1 min-w-0">
                              <p class="text-[#1B2E3A] text-xs font-medium">{n.title}</p>
                              <p class="text-gray-600 text-[10px] mt-0.5 line-clamp-2">{n.body}</p>
                              <p class="text-gray-400 text-[10px] mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                            </div>
                          </a>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          {#if mode === 'resident'}
            <div class="relative">
              <button
                class="cursor-pointer p-1 touch-manipulation relative"
                onclick={openResidentNotifications}
                aria-label="Notifications"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75v-.7V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {#if residentUnreadCount > 0}
                  <span class="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{residentUnreadCount > 99 ? '99+' : residentUnreadCount}</span>
                {/if}
              </button>

              {#if residentNotificationsOpen}
                <div class="absolute left-0 mt-3 w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30 flex flex-col">
                  <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 shrink-0">
                    <span class="text-[#1B2E3A] text-xs font-semibold">Notifications</span>
                    <div class="flex gap-1">
                      {#if residentDbNotifications.filter(n => !n.readAt).length > 0}
                        <button onclick={handleMarkAllResidentNotificationsRead} class="text-cyan-600 text-[10px] hover:underline cursor-pointer">Read all</button>
                      {/if}
                      <button onclick={() => (residentNotificationsOpen = false)} class="text-gray-400 hover:text-[#1B2E3A] transition cursor-pointer text-sm" aria-label="Close">&times;</button>
                    </div>
                  </div>
                  <div class="overflow-y-auto min-h-0 flex-1">
                    {#if residentNotifications.length === 0}
                      <p class="px-3 py-4 text-gray-500 text-xs">No notifications.</p>
                    {:else}
                      <div class="divide-y divide-gray-100">
                        {#each residentNotifications as n}
                          <div class="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 transition {n.readAt ? 'opacity-70' : ''}">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-4 h-4 mt-0.5 shrink-0">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 17.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                            </svg>
                            <div class="flex-1 min-w-0">
                              <p class="text-[#1B2E3A] text-xs font-medium">{n.title}</p>
                              {#if !n.readAt && n.id === 'unverified'}
                                <p class="text-amber-600 text-[10px] mt-0.5 font-medium">Verify now →</p>
                              {/if}
                              <p class="text-gray-600 text-[10px] mt-0.5 line-clamp-2">{n.body}</p>
                              <p class="text-gray-400 text-[10px] mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                              {#if n.link}
                                <button type="button" class="text-cyan-600 text-[10px] hover:underline cursor-pointer" onclick={() => handleResidentNotificationView(n)}>View</button>
                              {/if}
                              <button type="button" class="text-gray-400 hover:text-red-600 p-1 cursor-pointer" aria-label="Delete notification" onclick={(e) => handleResidentNotificationDelete(n.id, e)}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                              </button>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          {#if mode === 'guest'}
            <div class="relative">
              <button
                class="cursor-pointer p-1 touch-manipulation relative"
                onclick={() => {
                  openMenu = null;
                  notificationsOpen = false;
                  residentNotificationsOpen = false;
                  residentSidebarOpen = false;
                  guestNotificationOpen = !guestNotificationOpen;
                }}
                aria-label="Notifications"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75v-.7V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
              </button>
              {#if guestNotificationOpen}
                <div class="absolute left-0 mt-3 w-72 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30">
                  <div class="px-3 py-2.5 border-b border-gray-100">
                    <p class="text-[#1B2E3A] text-xs font-semibold">Notifications</p>
                  </div>
                  <div class="px-3 py-3">
                    <p class="text-[#1B2E3A] text-xs leading-relaxed">
                      You need to
                      <a href="/login" class="font-bold text-[#1B2E3A] hover:text-amber-600 underline transition">Login</a>
                      to view notifications.
                    </p>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          <div class="relative">
            <button
              class="cursor-pointer p-1 touch-manipulation"
              onclick={() => {
                if (mode !== 'lgu') {
                  // Toggle sidebar; close profile + both notification panels
                  residentSidebarOpen = !residentSidebarOpen;
                  if (!residentSidebarOpen) activeSidebarPanel = null;
                  openMenu = null;
                  notificationsOpen = false;
                  residentNotificationsOpen = false;
                  guestNotificationOpen = false;
                } else {
                  toggle('menu');
                }
              }}
              aria-label="Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            {#if openMenu === 'menu' && mode === 'lgu'}
              <div class="absolute left-0 mt-3 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30 min-w-[200px] md:min-w-[220px]">
                <div class="p-2">
                  <div class="grid grid-cols-3 gap-1">
                    {#each (mode === 'lgu' && hamburgerMenuItems ? hamburgerMenuItems : menuItems) as item}
                      {#if item.href}
                        <a href={item.href} class="flex flex-col items-center px-3 py-3 hover:bg-gray-50 rounded-lg text-center touch-manipulation">
                          <div class="w-7 h-7 bg-gray-100 rounded-full mb-1.5 flex items-center justify-center">
                            {#if item.icon}{@html item.icon}{/if}
                          </div>
                          <span class="text-[10px] text-[#1B2E3A] font-medium">{item.label}</span>
                        </a>
                      {:else if item.action}
                        <button
                          class="flex flex-col items-center px-3 py-3 hover:bg-gray-50 rounded-lg text-center touch-manipulation w-full"
                          onclick={() => { item.action?.(); close(); }}
                        >
                          <div class="w-7 h-7 bg-gray-100 rounded-full mb-1.5 flex items-center justify-center">
                            {#if item.icon}{@html item.icon}{/if}
                          </div>
                          <span class="text-[10px] text-[#1B2E3A] font-medium">{item.label}</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                  {#if mode === 'lgu' && (!pendingRequest || isMunicipalRole(lguRole))}
                    <div class="mt-1 pt-1 border-t border-gray-100">
                      <button
                        class="flex items-center justify-between w-full px-3 py-2 hover:bg-gray-50 rounded-lg text-xs text-[#1B2E3A]"
                        onclick={() => (barangayMgmtExpanded = !barangayMgmtExpanded)}
                      >
                        <span class="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 shrink-0">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                          </svg>
                          Barangay Management
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 transition-transform {barangayMgmtExpanded ? 'rotate-180' : ''}">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      {#if barangayMgmtExpanded}
                        <div class="ml-3 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-2">
                          {#if isMunicipalRole(lguRole)}
                            <button onclick={() => { openMunicipalApprovalPanel(); close(); }} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-indigo-700">
                              Approve Boundary Requests
                            </button>
                          {/if}
                          {#if lguBarangayInfo}
                            {#if lguBarangayInfo.isApproved}
                              <button onclick={() => { openBrochurePanel(); close(); }} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-cyan-700">
                                Barangay Description
                              </button>
                            {/if}
                            {#if lguBarangayInfo.isCreator}
                              <button onclick={() => { startDrawBoundary(); close(); }} disabled={isDrawingBoundary || isSavingBoundary} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-emerald-700 disabled:opacity-50">
                                Request Boundary Update
                              </button>
                              <button onclick={() => { openDeleteRequestPanel(); close(); }} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-red-600">
                                Request Delete
                              </button>
                            {:else}
                              <button onclick={() => { openLeavePanel(); close(); }} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-amber-700">
                                Leave Barangay
                              </button>
                            {/if}
                          {:else if !isMunicipalRole(lguRole)}
                            <button onclick={() => { openMapAreaPanel(); close(); }} disabled={isDrawingBoundary || isSavingBoundary} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-emerald-700 disabled:opacity-50">
                              Map My Barangay
                            </button>
                            <button onclick={() => { openJoinPanel(); close(); }} class="block w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-[11px] text-cyan-700">
                              Join Existing Barangay
                            </button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
      <div class="flex flex-col items-center justify-center gap-0.5 absolute left-1/2 -translate-x-1/2 pointer-events-none">
        <h1 class="text-sm text-gray-400 tracking-wider select-none" style="font-family: 'Playfair Display SC', serif">
          DISASTERLINK
        </h1>
        {#if mode === 'lgu' || mode === 'resident' || mode === 'guest'}
          <p class="text-white text-[10px] sm:text-xs text-center whitespace-nowrap overflow-hidden max-w-[90vw] md:max-w-md text-ellipsis">
            <span class="text-white/70">Current Location:</span>
            <span class="text-white/95">{#if isLocating}Locating…{:else}{locationText}{/if}</span>
            <span class="text-white/50 mx-1.5">·</span>
            {#if mode === 'resident'}
              <span class="text-white/70">Barangay:</span>
              <span class="text-white/95">{detectedBarangayName}</span>
            {:else if mode === 'guest'}
              <span class="text-white/70">Guest View</span>
            {:else}
              <span class="text-white/70">{isMunicipalRole(lguRole) ? 'Affiliated Municipality:' : 'Affiliated Barangay:'}</span>
              <span class="text-white/95">{isMunicipalRole(lguRole) ? (lguMunicipalityName || '—') : (lguBarangayInfo?.name ?? '—')}</span>
            {/if}
          </p>
        {/if}
      </div>
      {#if mode === 'resident' || mode === 'guest'}
        <!-- Search bar lives inside the header for resident mode (right-aligned) -->
        <div class="relative shrink-0 w-36 sm:w-44 md:w-56 ml-auto">
          <input
            type="search"
            bind:value={searchQuery}
            oninput={scheduleSearch}
            onfocus={() => searchQuery && (searchDropdownOpen = true)}
            placeholder="Search place…"
            class="w-full h-7 pl-7 pr-3 rounded-xl bg-white/10 text-white placeholder-white/35 border border-white/20 focus:border-white/40 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/20 transition"
            aria-label="Search for a place"
          />
          <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/50 pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          {#if isSearching}
            <svg class="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/50 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          {/if}
          {#if searchDropdownOpen && (searchResults.length > 0 || isSearching)}
            <div class="absolute top-full right-0 mt-1 w-72 rounded-xl bg-[#0C212F]/95 border border-white/20 shadow-xl backdrop-blur-sm overflow-hidden z-[1001]" role="listbox">
              {#if isSearching}
                <div class="px-4 py-3 text-white/50 text-sm">Searching…</div>
              {:else}
                {#each searchResults as result}
                  <button
                    type="button"
                    class="w-full px-4 py-3 text-left text-sm text-white/90 hover:bg-white/10 transition truncate focus:outline-none focus:bg-white/10 touch-manipulation"
                    onclick={() => goToSearchResult(result)}
                    role="option"
                    aria-selected="false"
                  >
                    {result.displayName}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <div class="w-[1px] shrink-0" aria-hidden="true"></div>
      {/if}
    </div>
  </header>

  <!-- ── Resident Quick-Action Toolbar ─────────────────────────────────────────
       Fixed layout: [←] [Map] [Feed] · [Report(yellow, center)] · [Boundary] [Hazard] [→]
       Report is always anchored to the center; left/right arrows are shown only
       when their respective pools overflow beyond 2 visible slots.
       Outer wrapper is transparent to create a visual gap below the header;
       the inner pill auto-sizes to its content and floats as a rounded card. -->
  {#if mode !== 'lgu'}
    <!-- Toolbar wrapper: re-centers itself in the visible map area as the sidebar
         and sub-panel open / close. Sidebar rail ≈ 95px, sub-panel ≈ 340px. -->
    <div
      class="absolute top-[3rem] md:top-[3.5rem] -translate-x-1/2 z-[1001] flex flex-col items-center transition-[left] duration-300 ease-in-out"
      style="left: {residentSidebarOpen && activeSidebarPanel
        ? 'calc(50% + 218px)'
        : residentSidebarOpen
          ? 'calc(50% + 48px)'
          : '50%'}"
    >

    {#if toolbarVisible}
    <!-- 3-column grid: [1fr left group] [auto Report] [1fr right group]
         Both side groups stretch equally, so Report is always the geometric center.
         The parent wrapper uses items-center (flex-col) so the toggle tab below
         aligns precisely under Report. -->
    <div class="grid grid-cols-[1fr_auto_1fr] items-center px-1.5 py-0.5 mt-2 rounded-2xl bg-[#1c3448] shadow-lg shadow-black/40 border border-white/[0.08]">

      <!-- Left group: arrow + Map + Feed, right-aligned so they hug the Report button -->
      <div class="flex items-center justify-end gap-0.5">
        <button
          class="p-1.5 text-white/30 hover:text-white/70 transition-all touch-manipulation shrink-0 {(mode === 'guest' ? guestLeftToolbarItems.length : leftToolbarItems.length) <= 2 ? 'opacity-0 pointer-events-none' : ''}"
          aria-label="Previous left options"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        {#each (mode === 'guest' ? guestLeftToolbarItems : leftToolbarItems) as item (item.id)}
          {#if item.href}
            <a
              href={item.href}
              title={item.label}
              aria-label={item.label}
              class="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all touch-manipulation min-w-[56px] {item.active ? 'bg-white/15 text-white ring-1 ring-white/25' : 'text-white/55 hover:bg-white/10 hover:text-white'}"
            >
              {@html item.icon}
              <span class="text-[9px] font-medium leading-none">{item.label}</span>
            </a>
          {:else}
            <button
              onclick={item.action}
              title={item.label}
              aria-label={item.label}
              class="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all touch-manipulation min-w-[56px] cursor-pointer {item.active ? 'bg-white/15 text-white ring-1 ring-white/25' : 'text-white/55 hover:bg-white/10 hover:text-white'}"
            >
              {@html item.icon}
              <span class="text-[9px] font-medium leading-none">{item.label}</span>
            </button>
          {/if}
        {/each}
      </div>

      <!-- Report: auto-column center — immovable, always visually centered -->
      <button
        onclick={openReportPanel}
        title="Report a hazard or disaster"
        aria-label="Report a hazard or disaster"
        class="flex flex-col items-center justify-center gap-0.5 px-5 py-1.5 mx-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white shadow-lg transition-all cursor-pointer touch-manipulation min-w-[68px]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <span class="text-[9px] font-bold leading-none">Report</span>
      </button>

      <!-- Right group: Resources + Hotlines + arrow, left-aligned so they hug Report -->
      <div class="flex items-center justify-start gap-0.5">
        {#each (mode === 'guest' ? guestRightToolbarItems : rightToolbarItems) as item (item.id)}
          {#if item.href}
            <a
              href={item.href}
              title={item.label}
              aria-label={item.label}
              class="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all touch-manipulation min-w-[56px] {item.active ? 'bg-white/15 text-white ring-1 ring-white/25' : 'text-white/55 hover:bg-white/10 hover:text-white'}"
            >
              {@html item.icon}
              <span class="text-[9px] font-medium leading-none">{item.label}</span>
            </a>
          {:else}
            <button
              onclick={item.action}
              title={item.label}
              aria-label={item.label}
              class="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all touch-manipulation min-w-[56px] cursor-pointer {item.active ? 'bg-white/15 text-white ring-1 ring-white/25' : 'text-white/55 hover:bg-white/10 hover:text-white'}"
            >
              {@html item.icon}
              <span class="text-[9px] font-medium leading-none">{item.label}</span>
            </button>
          {/if}
        {/each}
        <button
          class="p-1.5 text-white/30 hover:text-white/70 transition-all touch-manipulation shrink-0 {(mode === 'guest' ? guestRightToolbarItems.length : rightToolbarItems.length) <= 2 ? 'opacity-0 pointer-events-none' : ''}"
          aria-label="More right options"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

    </div>
    {/if}

    <!-- ── Toolbar toggle tab ────────────────────────────────────────────────────
         Attached to the bottom of the pill when visible (^ to hide);
         stands alone just below the header when hidden (v to show). -->
    <button
      onclick={() => (toolbarVisible = !toolbarVisible)}
      class="flex items-center justify-center w-10 h-[14px] mt-1 bg-[#1c3448] rounded-2xl border border-white/[0.08] transition-all cursor-pointer text-white/50 hover:text-white/80 shadow-md shadow-black/40 touch-manipulation"
      aria-label={toolbarVisible ? 'Hide toolbar' : 'Show toolbar'}
    >
      {#if toolbarVisible}
        <!-- ^ up chevron: click to hide -->
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3 h-3">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
        </svg>
      {:else}
        <!-- v down chevron: click to show -->
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3 h-3">
          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      {/if}
    </button>

    </div>
  {/if}

  <!-- ── Resident Left Sidebar ──────────────────────────────────────────────────
       Full-height drawer attached to the left edge. Toggled by the hamburger icon.
       Options stack vertically (icon on top, label below). Sub-panels (Map Legend,
       Hazard Layers) open to the right and are scrollable, including a placeholder
       for future announcements from Mayor / MDRRMO / BDRRMO. -->
  {#if mode !== 'lgu' && residentSidebarOpen}
    <!-- top-12 md:top-14 keeps the sidebar flush below the header without covering it -->
    <div class="absolute left-0 top-12 md:top-14 bottom-0 z-[1002] flex pointer-events-auto">


      <!-- ── Icon rail (main sidebar column) ── -->
      <div class="flex flex-col bg-[#0C212F] border-r border-white/10 shadow-2xl overflow-y-auto sidebar-scroll overflow-x-hidden py-2 shrink-0">

        <!-- Announcement -->
        <button
          onclick={() => (activeSidebarPanel = activeSidebarPanel === 'announcement' ? null : 'announcement')}
          class="flex flex-col items-center gap-1.5 px-5 py-4 transition-all touch-manipulation cursor-pointer border-r-2 {activeSidebarPanel === 'announcement' ? 'bg-white/15 border-amber-400' : 'border-transparent hover:bg-white/10'}"
          aria-label="Announcements"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 {activeSidebarPanel === 'announcement' ? 'text-amber-400' : 'text-white/70'}">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 1 8.835-2.535m0 0A23.74 23.74 0 0 1 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
          </svg>
          <span class="text-xs font-medium leading-tight text-center {activeSidebarPanel === 'announcement' ? 'text-amber-400' : 'text-white/70'}">Announce<br>ments</span>
        </button>

        <!-- Local Resident Reports -->
        <button
          onclick={async () => {
            if (activeSidebarPanel === 'local-reports') {
              activeSidebarPanel = null;
            } else {
              activeSidebarPanel = 'local-reports';
              if (mode === 'resident') {
                await loadLocalBarangayReports();
              }
            }
          }}
          class="flex flex-col items-center gap-1.5 px-5 py-4 transition-all touch-manipulation cursor-pointer border-r-2 {activeSidebarPanel === 'local-reports' ? 'bg-white/15 border-white/60' : 'border-transparent hover:bg-white/10'}"
          aria-label="Local Resident Reports"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 {activeSidebarPanel === 'local-reports' ? 'text-white' : 'text-white/70'}">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
          </svg>
          <span class="text-xs font-medium leading-tight text-center {activeSidebarPanel === 'local-reports' ? 'text-white' : 'text-white/70'}">Local<br>Reports</span>
        </button>

        <!-- Your Contributions -->
        <button
          onclick={async () => {
            if (mode === 'guest') {
              activeSidebarPanel = 'guest-login';
              guestRestrictedPanelTarget = 'contributions';
              return;
            }
            if (activeSidebarPanel === 'contributions') {
              activeSidebarPanel = null;
            } else {
              activeSidebarPanel = 'contributions';
              await loadUserContributions();
            }
          }}
          title="Your Contributions"
          class="flex flex-col items-center gap-1.5 px-5 py-4 transition-all border-r-2 {activeSidebarPanel === 'contributions' ? 'bg-white/15 border-white/60 touch-manipulation cursor-pointer' : 'border-transparent hover:bg-white/10 touch-manipulation cursor-pointer'}"
          aria-label="Your Contributions"
        >
          <div class="relative">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 {activeSidebarPanel === 'contributions' ? 'text-white' : 'text-white/70'}">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
            </svg>
          </div>
          <span class="text-xs font-medium leading-tight text-center {activeSidebarPanel === 'contributions' ? 'text-white' : 'text-white/70'}">Your<br>Contribs</span>
        </button>

        <!-- Divider separating community sections from map tools -->
        <div class="mx-3 my-1 border-t border-white/10 shrink-0"></div>

        <!-- Map Legend -->
        <button
          onclick={() => (activeSidebarPanel = activeSidebarPanel === 'legend' ? null : 'legend')}
          class="flex flex-col items-center gap-1.5 px-5 py-4 transition-all touch-manipulation cursor-pointer border-r-2 {activeSidebarPanel === 'legend' ? 'bg-white/15 border-white/60' : 'border-transparent hover:bg-white/10'}"
          aria-label="Map Legend"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 {activeSidebarPanel === 'legend' ? 'text-white' : 'text-white/70'}">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <span class="text-xs font-medium leading-tight text-center {activeSidebarPanel === 'legend' ? 'text-white' : 'text-white/70'}">Map<br>Legend</span>
        </button>

        <!-- Hazard Layers (opens sub-panel) -->
        <button
          onclick={() => (activeSidebarPanel = activeSidebarPanel === 'hazard' ? null : 'hazard')}
          class="flex flex-col items-center gap-1.5 px-5 py-4 transition-all touch-manipulation cursor-pointer border-r-2 {activeSidebarPanel === 'hazard' ? 'bg-white/15 border-white/60' : 'border-transparent hover:bg-white/10'}"
          aria-label="Hazard Layers"
        >
          <div class="relative">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 {activeSidebarPanel === 'hazard' ? 'text-white' : 'text-white/70'}">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0 4.179 2.25L12 17.25 2.25 12l4.179-2.25m11.142 0 4.179 2.25L12 22.5l-9.75-5.25 4.179-2.25" />
            </svg>
            {#if activeLayerCount() > 0}
              <span class="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-amber-500 text-white text-[7px] font-bold flex items-center justify-center">{activeLayerCount()}</span>
            {/if}
          </div>
          <span class="text-xs font-medium leading-tight text-center {activeSidebarPanel === 'hazard' ? 'text-white' : 'text-white/70'}">Hazard<br>Layers</span>
        </button>

        <!-- Municipal Boundaries (toggle — existing functionality) -->
        <button
          onclick={toggleMinglanillaBorder}
          class="flex flex-col items-center gap-1.5 px-5 py-4 transition-all touch-manipulation cursor-pointer border-r-2 {minglanillaBorderVisible ? 'bg-white/15 border-blue-400' : 'border-transparent hover:bg-white/10'}"
          aria-label="Toggle municipal boundaries"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 {minglanillaBorderVisible ? 'text-blue-400' : 'text-white/70'}">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
          </svg>
          <span class="text-xs font-medium leading-tight text-center {minglanillaBorderVisible ? 'text-blue-400' : 'text-white/70'}">Municipal<br>Boundaries</span>
        </button>

        <!-- Divider before last option -->
        <div class="mx-3 my-1 border-t border-white/10 shrink-0"></div>

        <!-- Barangay Boundaries — last, no functionality yet -->
        <button
          disabled
          title="Coming soon"
          class="flex flex-col items-center gap-1.5 px-5 py-4 border-r-2 border-transparent opacity-35 cursor-not-allowed"
          aria-label="Barangay Boundaries (coming soon)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-white/70">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
          <span class="text-xs font-medium leading-tight text-center text-white/70">Barangay<br>Boundaries</span>
        </button>

      </div>

      <!-- ── Announcements sub-panel ── -->
      {#if activeSidebarPanel === 'announcement'}
        <div class="w-[340px] md:w-[420px] bg-[#081c29] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-[#0C212F]">
            <span class="text-white text-sm font-semibold">Announcements</span>
            <button onclick={() => (activeSidebarPanel = null)} class="text-white/50 hover:text-white transition cursor-pointer text-base leading-none" aria-label="Close">&#x2715;</button>
          </div>
          <div class="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-4">

            <!-- Filter chips: choose which source to view -->
            <div>
              <p class="text-white/40 text-[10px] uppercase tracking-wider mb-2">Filter by source</p>
              <div class="flex flex-wrap gap-2">
                {#each ['All', "Mayor's Office", 'MDRRMO', 'BDRRMO'] as source}
                  <button class="px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer {source === 'All' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}">
                    {source}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Placeholder announcement cards (1-2 recent) -->
            <div class="space-y-3">
              <div class="bg-white/5 border border-white/10 rounded-xl p-3.5">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-amber-400 text-xs font-semibold">Mayor's Office</span>
                  <span class="text-white/30 text-[10px]">No posts yet</span>
                </div>
                <p class="text-white/70 text-xs font-medium mb-1">Title</p>
                <p class="text-white/40 text-xs leading-snug">Description of the announcement will appear here once published.</p>
              </div>
              <div class="bg-white/5 border border-white/10 rounded-xl p-3.5">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-blue-400 text-xs font-semibold">MDRRMO</span>
                  <span class="text-white/30 text-[10px]">No posts yet</span>
                </div>
                <p class="text-white/70 text-xs font-medium mb-1">Title</p>
                <p class="text-white/40 text-xs leading-snug">Description of the announcement will appear here once published.</p>
              </div>
            </div>

            <!-- Go to Feed (residents only; guests stay on the map) -->
            {#if mode !== 'guest'}
              <a
                href="/resident/feed"
                class="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/10 border border-white/20 text-white/80 text-xs font-semibold hover:bg-white/15 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
                View all in Feed
              </a>
            {/if}
          </div>
        </div>
      {/if}

      <!-- ── Local Resident Reports sub-panel ── -->
      {#if activeSidebarPanel === 'local-reports'}
        <div class="w-[340px] md:w-[420px] bg-[#081c29] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-[#0C212F]">
            <span class="text-white text-sm font-semibold">{mode === 'guest' ? 'Resident Reports' : 'Local Resident Reports'}</span>
            <button onclick={() => (activeSidebarPanel = null)} class="text-white/50 hover:text-white transition cursor-pointer text-base leading-none" aria-label="Close">&#x2715;</button>
          </div>
          <div class="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-4">
            <p class="text-white/50 text-[10px]">
              {#if mode === 'guest'}
                Showing all resident-submitted reports.
              {:else}
                Reports in {localReportsBarangayName || 'your barangay'}
              {/if}
            </p>
            <div class="flex items-center gap-2">
              <label for="local-report-sort" class="text-white/50 text-[10px] shrink-0 cursor-pointer">Sort by</label>
              <select
                id="local-report-sort"
                bind:value={localReportSort}
                class="rounded-lg bg-white/10 text-white text-xs px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 cursor-pointer"
              >
                <option value="date-desc" class="text-gray-900 bg-white">Newest first</option>
                <option value="date-asc" class="text-gray-900 bg-white">Oldest first</option>
                <option value="engagement" class="text-gray-900 bg-white">Most engagement</option>
              </select>
            </div>
            {#if mode === 'resident' && localBarangayReportsLoading}
              <div class="flex justify-center py-6">
                <svg class="animate-spin h-7 w-7 text-white/50" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            {:else if (mode === 'guest' ? sortedGuestReports.length : sortedLocalBarangayReports.length) === 0}
              <div class="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <div class="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-white/30">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                  </svg>
                </div>
                <div>
                  <p class="text-white/50 text-xs font-medium">{mode === 'guest' ? 'No resident reports yet' : 'No reports in your barangay yet'}</p>
                  <p class="text-white/25 text-[11px] mt-1">
                    {#if mode === 'guest'}
                      Reports will appear here as soon as residents submit them.
                    {:else if !latitude || !longitude}
                      Tap "Get My Location" on the map so we can show reports in your current area.
                    {:else if !localReportsBarangayName}
                      Reports in your current area will appear here once submitted.
                    {:else}
                      Reports submitted by residents in {localReportsBarangayName} will appear here.
                    {/if}
                  </p>
                </div>
              </div>
            {:else}
              <div class="space-y-3">
                {#each (mode === 'guest' ? sortedGuestReports : sortedLocalBarangayReports) as r (r.id)}
                  <div class="bg-white/5 border border-white/10 rounded-xl p-3.5 flex gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-white/50 text-[10px] mb-0.5">{formatContributionDate(r.createdAt)}</p>
                      <p class="text-white/40 text-[10px] mb-2">{r.barangayName}{r.municipalityName ? `, ${r.municipalityName}` : ''}</p>
                      <p class="text-white/90 text-xs font-medium line-clamp-1 mb-1.5">{r.title ?? 'Untitled'}</p>
                      {#if r.description}
                        <p class="text-white/70 text-xs font-medium leading-snug line-clamp-3 mb-2">{r.description}</p>
                      {/if}
                      {#if (r.photoUrls?.length ?? 0) > 0 || (r.videoUrls?.length ?? 0) > 0}
                        <div class="flex gap-1.5 mb-2 flex-wrap">
                          {#each (r.photoUrls ?? []).slice(0, 3) as url}
                            <img src={url} alt="" class="w-12 h-12 rounded object-cover border border-white/10 shrink-0" loading="lazy" />
                          {/each}
                          {#each (r.videoUrls ?? []).slice(0, 1) as url}
                            <div class="w-12 h-12 rounded bg-black/30 border border-white/10 flex items-center justify-center shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          {/each}
                        </div>
                      {/if}
                      <div class="flex items-center gap-3 text-white/40 text-[10px]">
                        <span>{(r.upvoteCount ?? 0)} upvote{(r.upvoteCount ?? 0) !== 1 ? 's' : ''}</span>
                        <span>{(r.commentCount ?? 0)} comment{(r.commentCount ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div class="flex flex-col items-end justify-start gap-1 shrink-0">
                      {#if r.gpsLat != null && r.gpsLng != null}
                        <button
                          type="button"
                          onclick={() => locateReportOnMap(r.id)}
                          class="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-medium border border-white/20 transition touch-manipulation cursor-pointer"
                          aria-label="Locate this report on the map"
                          title="Locate on map"
                        >
                          Locate
                        </button>
                      {/if}
                      <button
                        type="button"
                        onclick={() => focusReportOnMap(r.id)}
                        class="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-medium border border-white/20 transition touch-manipulation cursor-pointer"
                        aria-label="View this report on the map"
                        title="View details"
                      >
                        View
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if activeSidebarPanel === 'guest-login'}
        <div class="w-[340px] md:w-[420px] bg-[#081c29] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-[#0C212F]">
            <span class="text-white text-sm font-semibold">{guestRestrictedPanelTarget === 'notifications' ? 'Notifications' : 'Your Contributions'}</span>
            <button onclick={() => (activeSidebarPanel = null)} class="text-white/50 hover:text-white transition cursor-pointer text-base leading-none" aria-label="Close">&#x2715;</button>
          </div>
          <div class="flex-1 overflow-y-auto sidebar-scroll p-4">
            <div class="rounded-xl border border-white/10 bg-white/5 p-4">
              <p class="text-white/80 text-sm">
                You need to
                <a href="/login" class="font-bold text-white hover:text-amber-300 underline transition">Login</a>
                to access this section.
              </p>
              <p class="mt-2 text-white/55 text-xs">
                No account yet?
                <a href="/signup/resident" class="font-semibold text-cyan-300 hover:text-cyan-200 underline transition">Register here</a>.
              </p>
            </div>
          </div>
        </div>
      {/if}

      <!-- ── Your Contributions sub-panel ── -->
      {#if activeSidebarPanel === 'contributions'}
        <div class="w-[340px] md:w-[420px] bg-[#081c29] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-[#0C212F]">
            <span class="text-white text-sm font-semibold">Your Contributions</span>
            <button type="button" onclick={() => (activeSidebarPanel = null)} class="text-white/50 hover:text-white transition cursor-pointer text-base leading-none p-1" aria-label="Close" title="Close">&#x2715;</button>
          </div>
          <div class="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-4">
            <!-- Sort -->
            <div class="flex items-center gap-2">
              <label for="contribution-sort" class="text-white/50 text-[10px] shrink-0 cursor-pointer">Sort by</label>
              <select
                id="contribution-sort"
                bind:value={contributionSort}
                class="contribution-sort-select rounded-lg bg-white/10 text-white text-xs px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 cursor-pointer"
              >
                <option value="date-desc" class="text-gray-900 bg-white">Newest first</option>
                <option value="date-asc" class="text-gray-900 bg-white">Oldest first</option>
                <option value="engagement" class="text-gray-900 bg-white">Most relevant</option>
              </select>
            </div>

            {#if sortedContributions.length === 0}
              <div class="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <div class="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-white/30">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                  </svg>
                </div>
                <div>
                  <p class="text-white/50 text-xs font-medium">No contributions yet</p>
                  <p class="text-white/25 text-[11px] mt-1">Reports you submit will appear here.</p>
                </div>
              </div>
            {:else}
              <div class="space-y-3">
                {#each sortedContributions as r (r.id)}
                  <div class="bg-white/5 border border-white/10 rounded-xl p-3.5 flex gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-white/50 text-[10px] mb-0.5">
                        {formatContributionDate(r.createdAt)}
                        {#if isReportEdited(r)}
                          <span class="text-amber-400/90"> (edited)</span>
                        {/if}
                      </p>
                      <p class="text-white/40 text-[10px] mb-2">{r.barangayName}{r.municipalityName ? `, ${r.municipalityName}` : ''}</p>
                      <p class="text-white/90 text-xs font-medium line-clamp-1 mb-1.5">{r.title ?? 'Untitled'}</p>
                      {#if r.description}
                        <p class="text-white/70 text-xs font-medium leading-snug line-clamp-3 mb-2">{r.description}</p>
                      {/if}
                      {#if (r.photoUrls?.length ?? 0) > 0 || (r.videoUrls?.length ?? 0) > 0}
                        <div class="flex gap-1.5 mb-2 flex-wrap">
                          {#each (r.photoUrls ?? []).slice(0, 3) as url}
                            <img src={url} alt="" class="w-12 h-12 rounded object-cover border border-white/10 shrink-0" loading="lazy" />
                          {/each}
                          {#each (r.videoUrls ?? []).slice(0, 1) as url}
                            <div class="w-12 h-12 rounded bg-black/30 border border-white/10 flex items-center justify-center shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          {/each}
                        </div>
                      {/if}
                      <div class="flex items-center gap-3 text-white/40 text-[10px]">
                        <span>{(r.upvoteCount ?? 0)} upvote{(r.upvoteCount ?? 0) !== 1 ? 's' : ''}</span>
                        <span>{(r.commentCount ?? 0)} comment{(r.commentCount ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div class="flex flex-col items-end justify-start gap-1 shrink-0">
                      {#if r.gpsLat != null && r.gpsLng != null}
                        <button
                          type="button"
                          onclick={() => locateReportOnMap(r.id)}
                          class="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-medium border border-white/20 transition touch-manipulation cursor-pointer"
                          aria-label="Locate this report on the map"
                          title="Locate on map"
                        >
                          Locate
                        </button>
                      {/if}
                      <button
                        type="button"
                        onclick={() => focusReportOnMap(r.id)}
                        class="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-medium border border-white/20 transition touch-manipulation cursor-pointer"
                        aria-label="View this report on the map"
                        title="View details"
                      >
                        View
                      </button>
                      <button type="button" onclick={() => openContributionEdit(r)} class="p-1 rounded hover:bg-white/15 text-white/60 hover:text-white transition cursor-pointer" aria-label="Edit" title="Edit">&#9998;</button>
                      <button type="button" onclick={() => openContributionDelete(r)} class="p-1 rounded hover:bg-white/15 text-white/60 hover:text-red-400 transition cursor-pointer" aria-label="Delete" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Removed "View all in Feed" to keep residents inside the dashboard -->
          </div>
        </div>
      {/if}

      <!-- Edit contribution modal -->
      {#if contributionEditReport}
        <div class="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <button class="absolute inset-0 cursor-pointer" onclick={closeContributionEdit} aria-label="Close"></button>
          <div class="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#0C212F] rounded-xl border border-white/10 shadow-2xl p-4" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} tabindex="-1" role="presentation">
            <h3 class="text-white font-semibold text-sm mb-3">Edit report</h3>
            {#if contributionError}<p class="text-amber-400 text-xs mb-2">{contributionError}</p>{/if}
            <label for="contribution-edit-title" class="block text-white/60 text-[10px] mb-1">Title</label>
            <input id="contribution-edit-title" type="text" bind:value={contributionEditTitle} class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 mb-3" />
            <label for="contribution-edit-desc" class="block text-white/60 text-[10px] mb-1">Description</label>
            <textarea id="contribution-edit-desc" bind:value={contributionEditDescription} rows="4" class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 resize-none mb-3"></textarea>
            <div class="mb-3">
              <p class="text-white/60 text-[10px] mb-1.5">Photos</p>
              <div class="flex flex-wrap gap-2 mb-2">
                {#each contributionEditPhotoUrls as url, i}
                  <div class="relative shrink-0">
                    <img src={url} alt="" class="w-14 h-14 rounded-lg object-cover border border-white/20" />
                    <button type="button" onclick={() => removeContributionEditPhoto(i)} class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600" aria-label="Remove photo">&times;</button>
                  </div>
                {/each}
                <label class="w-14 h-14 rounded-lg border border-dashed border-white/30 bg-white/5 flex items-center justify-center cursor-pointer hover:bg-white/10 transition">
                  <input type="file" accept="image/*" multiple class="hidden" onchange={addContributionEditPhotos} />
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                </label>
              </div>
            </div>
            <div class="mb-4">
              <p class="text-white/60 text-[10px] mb-1.5">Videos</p>
              <div class="flex flex-wrap gap-2 mb-2">
                {#each contributionEditVideoUrls as url, i}
                  <div class="relative shrink-0">
                    <div class="w-14 h-14 rounded-lg bg-black/30 border border-white/20 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                    <button type="button" onclick={() => removeContributionEditVideo(i)} class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600" aria-label="Remove video">&times;</button>
                  </div>
                {/each}
                <label class="w-14 h-14 rounded-lg border border-dashed border-white/30 bg-white/5 flex items-center justify-center cursor-pointer hover:bg-white/10 transition">
                  <input type="file" accept="video/*" multiple class="hidden" onchange={addContributionEditVideos} />
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                </label>
              </div>
            </div>
            <div class="flex gap-2 justify-end">
              <button type="button" onclick={closeContributionEdit} class="px-3 py-1.5 rounded-lg bg-white/10 text-white/80 text-xs hover:bg-white/20">Cancel</button>
              <button type="button" onclick={saveContributionEdit} disabled={contributionSaving} class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs hover:bg-amber-500 disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Delete contribution confirmation -->
      {#if contributionDeleteReport}
        <div class="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <button class="absolute inset-0 cursor-pointer" onclick={closeContributionDelete} aria-label="Close"></button>
          <div class="relative z-10 w-full max-w-sm bg-[#0C212F] rounded-xl border border-white/10 shadow-2xl p-4" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} tabindex="-1" role="presentation">
            <h3 class="text-white font-semibold text-sm mb-2">Delete report?</h3>
            <p class="text-white/70 text-xs mb-4">This cannot be undone. The report "{contributionDeleteReport.title ?? 'Untitled'}" will be permanently removed.</p>
            {#if contributionDeleteError}<p class="text-amber-400 text-xs mb-3">{contributionDeleteError}</p>{/if}
            <div class="flex gap-2 justify-end">
              <button type="button" onclick={closeContributionDelete} class="px-3 py-1.5 rounded-lg bg-white/10 text-white/80 text-xs hover:bg-white/20">Cancel</button>
              <button type="button" onclick={confirmContributionDelete} disabled={contributionDeleting} class="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:bg-red-500 disabled:opacity-50">Delete</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- ── Map Legend sub-panel ── -->
      {#if activeSidebarPanel === 'legend'}
        <div class="w-[340px] md:w-[420px] bg-[#081c29] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-[#0C212F]">
            <span class="text-white text-sm font-semibold">Map Legend</span>
            <button onclick={() => (activeSidebarPanel = null)} class="text-white/50 hover:text-white transition cursor-pointer text-base leading-none" aria-label="Close">&#x2715;</button>
          </div>
          <!-- Scrollable body: legend items + announcement placeholder -->
          <div class="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-4">
            <div>
              <p class="text-white/50 mb-2 uppercase tracking-wider text-[10px]">Barangay Status</p>
              <div class="space-y-2">
                {#each Object.entries(BARANGAY_STATUS_COLORS) as [status, color]}
                  <div class="flex items-center gap-2">
                    <span class="w-4 h-4 rounded-sm shrink-0 border border-white/20" style="background-color: {color}"></span>
                    <span class="text-white/80 text-xs">{BARANGAY_STATUS_LABELS[status as BarangayStatusEnum]}</span>
                  </div>
                {/each}
              </div>
            </div>
            <div>
              <p class="text-white/50 mb-2 uppercase tracking-wider text-[10px]">Hazard Types</p>
              <div class="space-y-2">
                {#each HAZARD_LAYERS as config}
                  <div class="flex items-center gap-2">
                    <span class="w-4 h-4 rounded-sm shrink-0 border border-white/20" style="background-color: {config.color}"></span>
                    <span class="text-white/80 text-xs">{config.label}</span>
                  </div>
                {/each}
              </div>
            </div>
            <div>
              <p class="text-white/50 mb-2 uppercase tracking-wider text-[10px]">Risk Level</p>
              <div class="space-y-2">
                <div class="flex items-center gap-2"><span class="w-4 h-4 rounded-sm bg-white/55 border border-white/20 shrink-0"></span><span class="text-white/80 text-xs">High risk</span></div>
                <div class="flex items-center gap-2"><span class="w-4 h-4 rounded-sm bg-white/35 border border-white/20 shrink-0"></span><span class="text-white/80 text-xs">Moderate risk</span></div>
                <div class="flex items-center gap-2"><span class="w-4 h-4 rounded-sm bg-white/18 border border-white/20 shrink-0"></span><span class="text-white/80 text-xs">Low risk</span></div>
              </div>
            </div>
            <div>
              <p class="text-white/50 mb-2 uppercase tracking-wider text-[10px]">Markers</p>
              <div class="flex flex-col gap-2">
                <div class="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 20 26" class="shrink-0">
                    <path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#1B2E3A" stroke="white" stroke-width="1.5"/>
                    <circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/>
                  </svg>
                  <span class="text-white/80 text-xs">Current Location</span>
                </div>
                <div class="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 20 26" class="shrink-0">
                    <path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#7c3aed" stroke="white" stroke-width="1.5"/>
                    <circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/>
                  </svg>
                  <span class="text-white/80 text-xs">Search Result</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-4 h-4 rounded-full bg-red-600 border-2 border-white shrink-0" style="box-shadow:0 2px 6px rgba(0,0,0,0.35)"></span>
                  <span class="text-white/80 text-xs">Hazard / Disaster Report</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- ── Hazard Layers sub-panel ── -->
      {#if activeSidebarPanel === 'hazard'}
        <div class="w-[340px] md:w-[420px] bg-[#081c29] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-[#0C212F]">
            <span class="text-white text-sm font-semibold">Hazard Layers</span>
            <button onclick={() => (activeSidebarPanel = null)} class="text-white/50 hover:text-white transition cursor-pointer text-base leading-none" aria-label="Close">&#x2715;</button>
          </div>
          <!-- Scrollable body: layer toggles + risk legend + announcement placeholder -->
          <div class="flex-1 overflow-y-auto sidebar-scroll">
            <div class="p-3 space-y-0.5">
              {#each HAZARD_LAYERS as config}
                <button
                  onclick={() => toggleHazardLayer(config.type)}
                  class="w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors cursor-pointer text-left touch-manipulation {isHazardActive(config.type) ? 'bg-white/10' : 'hover:bg-white/5'}"
                >
                  <span class="w-3.5 h-3.5 rounded-sm shrink-0 border border-white/20" style="background-color:{config.color};opacity:{isHazardActive(config.type) ? 1 : 0.4}"></span>
                  <span class="text-white/80 text-xs flex-1">{config.label}</span>
                  {#if loadingHazards[config.type]}
                    <svg class="animate-spin h-4 w-4 text-white/50 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  {:else if isHazardActive(config.type)}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 text-green-400 shrink-0">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
            <div class="px-4 py-3 border-t border-white/10">
              <p class="text-white/40 text-xs mb-2">Risk Level (opacity)</p>
              <div class="flex flex-wrap gap-3">
                <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-white/55 shrink-0"></span><span class="text-white/50 text-xs">High</span></div>
                <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-white/35 shrink-0"></span><span class="text-white/50 text-xs">Moderate</span></div>
                <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-white/18 shrink-0"></span><span class="text-white/50 text-xs">Low</span></div>
              </div>
            </div>
          </div>
        </div>
      {/if}

    </div>
  {/if}

  <div class="flex-1 relative min-h-0 map-dashboard-wrapper" onclick={handleMapContainerClick} role="presentation">
    <div bind:this={mapElement} class="absolute inset-0 z-0"></div>

    {#if mode === 'lgu'}
    <div class="absolute top-3 left-3 right-3 md:left-auto md:right-4 md:w-72 z-[1000]">
      <div class="relative">
        <input
          type="search"
          bind:value={searchQuery}
          oninput={scheduleSearch}
          onfocus={() => searchQuery && (searchDropdownOpen = true)}
          placeholder="Search place in Philippines…"
          class="w-full h-10 md:h-9 pl-10 pr-4 rounded-xl bg-[#0C212F]/95 text-white placeholder-white/40 border border-white/20 focus:border-white/40 text-sm shadow-lg backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-white/20"
          aria-label="Search for a place"
        />
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        {#if isSearching}
          <svg class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        {/if}
      </div>
      {#if searchDropdownOpen && (searchResults.length > 0 || isSearching)}
        <div class="absolute top-full left-0 right-0 mt-1 rounded-xl bg-[#0C212F]/95 border border-white/20 shadow-xl backdrop-blur-sm overflow-hidden z-[1001]" role="listbox">
          {#if isSearching}
            <div class="px-4 py-3 text-white/50 text-sm">Searching…</div>
          {:else}
            {#each searchResults as result}
              <button
                type="button"
                class="w-full px-4 py-3 text-left text-sm text-white/90 hover:bg-white/10 transition truncate focus:outline-none focus:bg-white/10 touch-manipulation"
                onclick={() => goToSearchResult(result)}
                role="option"
                aria-selected="false"
              >
                {result.displayName}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    {/if}

    {#if searchDropdownOpen}
      <!-- z-[49] keeps this below the header stacking context (z-50) so the
           resident search dropdown inside the header remains clickable. -->
      <button class="fixed inset-0 z-[49] cursor-default" onclick={() => (searchDropdownOpen = false)} aria-label="Close search"></button>
    {/if}

    <div class="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 md:right-4 flex flex-col-reverse gap-2 z-[1000] pointer-events-none">
      <!-- items-end aligns Get My Location to the bottom of the zoom+fullscreen column in resident mode -->
      <div class="flex flex-wrap gap-2 pointer-events-auto justify-end md:justify-start items-end">
        {#if mode === 'lgu'}
        <button
          onclick={toggleMinglanillaBorder}
          class="flex items-center gap-2 px-4 py-3 md:px-4 md:py-2.5 bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white text-sm font-medium rounded-xl shadow-lg backdrop-blur-sm transition-all cursor-pointer touch-manipulation min-h-[44px] md:min-h-0 {minglanillaBorderVisible ? 'ring-2 ring-blue-400' : ''}"
          aria-pressed={minglanillaBorderVisible}
          aria-label={minglanillaBorderVisible ? 'Hide Minglanilla border' : 'Show Minglanilla border'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
          </svg>
          <span class="hidden sm:inline">Minglanilla Border</span>
        </button>
        {/if}

        <button
          onclick={getMyLocation}
          disabled={isLocating}
          aria-label="Get My Location"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] disabled:bg-gray-600 text-white text-sm font-medium shadow-lg backdrop-blur-sm transition-all cursor-pointer disabled:cursor-not-allowed touch-manipulation min-h-[44px] md:min-h-0"
        >
          {#if isLocating}
            <svg class="animate-spin w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span>Locating…</span>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span>Get My Location</span>
          {/if}
        </button>

        {#if mode === 'resident'}
          <!-- Resident: zoom in, zoom out, then fullscreen — all stacked in one column
               so the order bottom-to-top reads: fullscreen → zoom− → zoom+.
               Fullscreen is at the very bottom, zoom controls sit just above it. -->
          <div class="flex flex-col gap-1">
            <button
              onclick={() => map?.zoomIn()}
              class="p-3 md:p-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white shadow-lg backdrop-blur-sm transition-all touch-manipulation min-h-[44px] md:min-h-[36px] min-w-[44px] md:min-w-[36px] flex items-center justify-center"
              aria-label="Zoom in"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              onclick={() => map?.zoomOut()}
              class="p-3 md:p-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white shadow-lg backdrop-blur-sm transition-all touch-manipulation min-h-[44px] md:min-h-[36px] min-w-[44px] md:min-w-[36px] flex items-center justify-center"
              aria-label="Zoom out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" />
              </svg>
            </button>
            <button
              onclick={toggleFullscreen}
              class="p-3 md:p-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white shadow-lg backdrop-blur-sm transition-all touch-manipulation min-h-[44px] md:min-h-[36px] min-w-[44px] md:min-w-[36px] flex items-center justify-center"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {#if isFullscreen}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m5.25-5.25h4.5m0 4.5V9m0 10.5v-4.5m4.5 4.5H9m10.5 0v-4.5m0 4.5L15 15" />
                </svg>
              {/if}
            </button>
          </div>
        {:else if mode === 'lgu'}
          <!-- Non-resident: standalone fullscreen button as before -->
          <button
            onclick={toggleFullscreen}
            class="p-3 md:p-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white shadow-lg backdrop-blur-sm transition-all touch-manipulation min-h-[44px] md:min-h-0 min-w-[44px] md:min-w-0"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {#if isFullscreen}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m5.25-5.25h4.5m0 4.5V9m0 10.5v-4.5m4.5 4.5H9m10.5 0v-4.5m0 4.5L15 15" />
              </svg>
            {/if}
          </button>
        {/if}

        {#if mode === 'lgu'}
        <button
          onclick={() => (hazardPanelOpen = !hazardPanelOpen)}
          class="p-3 md:p-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white shadow-lg backdrop-blur-sm transition-all touch-manipulation flex items-center gap-1.5 min-h-[44px] md:min-h-0"
          aria-label="Hazard layers"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0l4.179 2.25L12 17.25 2.25 12l4.179-2.25m11.142 0l4.179 2.25L12 22.5l-9.75-5.25 4.179-2.25" />
          </svg>
          {#if activeLayerCount() > 0}
            <span class="bg-white/20 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{activeLayerCount()}</span>
          {/if}
        </button>

        <button
          onclick={() => (legendOpen = !legendOpen)}
          class="p-3 md:p-2.5 rounded-xl bg-[#0C212F]/90 hover:bg-[#1B2E3A] text-white shadow-lg backdrop-blur-sm transition-all touch-manipulation min-h-[44px] md:min-h-0 min-w-[44px] md:min-w-0"
          aria-label="Toggle legend"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
        </button>
        {/if}
      </div>
      {#if mode === 'lgu' && lguBarangayInfo?.id}
        <div class="flex justify-end pointer-events-auto w-full md:w-auto">
          <button
            onclick={openReportPanel}
            class="flex items-center gap-2 px-4 py-3 md:px-4 md:py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-xl shadow-lg backdrop-blur-sm transition-all cursor-pointer touch-manipulation min-h-[44px] md:min-h-0"
            aria-label="Report hazard or disaster"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <span>Report</span>
          </button>
        </div>
      {/if}
    </div>

    {#if mode === 'lgu' && pendingRequest}
      <div class="absolute top-16 left-1/2 -translate-x-1/2 z-[1001] bg-amber-600/90 text-white text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-[90vw] md:max-w-md text-center backdrop-blur-sm">
        Boundary request for {pendingRequest.barangayName}, {pendingRequest.municipalityName} is pending municipal approval.
      </div>
    {/if}

    {#if mapAreaPanelOpen}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden border border-white/10">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Map your barangay area</span>
          <button onclick={() => (mapAreaPanelOpen = false)} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 space-y-3">
          <p class="text-white/70 text-[11px]">Create a new barangay by selecting your municipality, entering the name, and drawing the boundary. To join an existing barangay instead, use "Join Existing Barangay" below.</p>
          <div>
            <label for="map-area-municipality" class="block text-white/60 text-[10px] mb-1">Municipality</label>
            <select
              id="map-area-municipality"
              bind:value={selectedMunicipalityId}
              onchange={(e) => onMunicipalityChange((e.target as HTMLSelectElement).value)}
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 focus:border-white/40 focus:outline-none"
            >
              <option value="">— Select —</option>
              {#each municipalities as m}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="map-area-barangay-name" class="block text-white/60 text-[10px] mb-1">New barangay name</label>
            <input
              id="map-area-barangay-name"
              type="text"
              bind:value={newBarangayName}
              placeholder="e.g. Tunghaan"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none"
            />
          </div>
          <div>
            <label for="map-area-email" class="block text-white/60 text-[10px] mb-1">Contact Email <span class="text-amber-400">*</span></label>
            <input
              id="map-area-email"
              type="email"
              bind:value={boundaryContactEmail}
              placeholder="e.g. name@example.com"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none"
            />
          </div>
          <div>
            <label for="map-area-phone" class="block text-white/60 text-[10px] mb-1">Contact Number <span class="text-amber-400">*</span></label>
            <input
              id="map-area-phone"
              type="tel"
              bind:value={boundaryContactPhone}
              placeholder="09XXXXXXXXX"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none"
            />
          </div>
          <div>
            <label for="map-area-desc" class="block text-white/60 text-[10px] mb-1">Description (optional)</label>
            <textarea
              id="map-area-desc"
              bind:value={boundaryDescription}
              placeholder="e.g. Official barangay boundaries as per LGU records"
              rows="2"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none"
            ></textarea>
          </div>
          <button
            onclick={() => startDrawBoundary()}
            class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg cursor-pointer transition"
          >
            Draw on Map
          </button>
        </div>
      </div>
    {/if}

    {#if isDrawingBoundary}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-64 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg p-3">
        <p class="text-white text-xs mb-2">Draw your barangay boundary on the map. Click points to shape the polygon, then double-click to finish.</p>
        <button onclick={cancelDrawBoundary} class="w-full py-2 bg-red-600/80 hover:bg-red-500 text-white text-sm rounded-lg font-medium cursor-pointer">Cancel</button>
      </div>
    {/if}

    {#if statusPanelOpen && lguBarangayInfo?.isApproved}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-64 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Barangay Status — {lguBarangayInfo.name}</span>
          <button onclick={() => { statusPanelOpen = false; cancelStatusForm(); }} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        {#if pendingStatus}
          <div class="p-3 space-y-3">
            <p class="text-white/70 text-[11px]">
              Describe why <strong>{BARANGAY_STATUS_LABELS[pendingStatus!]}</strong> (required). Photos optional.
            </p>
            <textarea
              bind:value={statusDescription}
              placeholder="e.g. Flood damage, roads blocked, need relief goods..."
              rows="3"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none"
            ></textarea>
            <div>
              <label for="status-photos" class="block text-white/60 text-[10px] mb-1">Photos (optional)</label>
              <input
                id="status-photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onchange={handleStatusPhotoSelect}
                class="w-full text-white/70 text-[11px] file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-white/20 file:text-white"
              />
              {#if statusPhotoError}
                <p class="text-amber-400 text-[10px] mt-1">{statusPhotoError}</p>
              {/if}
            </div>
            <div class="flex gap-2">
              <button
                onclick={cancelStatusForm}
                class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onclick={saveBarangayStatusWithDetails}
                disabled={isSavingStatus || statusDescription.trim().length < 5}
                class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 text-white text-xs font-medium rounded-lg transition cursor-pointer disabled:cursor-not-allowed"
              >
                {isSavingStatus ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        {:else}
          <div class="p-2 space-y-1">
            {#each STATUS_OPTIONS as statusKey}
              <button
                onclick={() => selectStatus(statusKey)}
                disabled={isSavingStatus}
                class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors cursor-pointer text-left disabled:opacity-60 hover:bg-white/10 touch-manipulation"
              >
                <span class="w-3 h-3 rounded-sm shrink-0 border border-white/20" style="background-color: {BARANGAY_STATUS_COLORS[statusKey]}"></span>
                <span class="text-white/80 text-xs flex-1">{BARANGAY_STATUS_LABELS[statusKey]}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if brochurePanelOpen && lguBarangayInfo}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Barangay Description — {lguBarangayInfo.name}</span>
          <button onclick={closeBrochurePanel} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 space-y-3">
          <p class="text-white/60 text-[11px]">
            Add your barangay's specialty or description. Photos and text are shown when users click your barangay on the map.
          </p>
          <div>
            <label for="brochure-desc" class="block text-white/60 text-[10px] mb-1">Description</label>
            <textarea
              id="brochure-desc"
              bind:value={brochureDescription}
              placeholder="e.g. Coastal barangay known for fishing; evacuation center at multi-purpose hall..."
              rows="4"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none"
            ></textarea>
          </div>
          <div>
            <label for="brochure-photos" class="block text-white/60 text-[10px] mb-1">Photos ({brochureExistingUrls.length + brochurePhotoFiles.length} selected)</label>
            {#if brochureExistingUrls.length > 0 || brochurePhotoFiles.length > 0}
              <div class="flex flex-wrap gap-2 mb-2">
                {#each brochureExistingUrls as url, i}
                  <div class="relative">
                    <img src={url} alt="" class="w-16 h-16 object-cover rounded-lg" />
                    <button
                      type="button"
                      onclick={() => removeBrochurePhoto(i)}
                      class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none flex items-center justify-center"
                      aria-label="Remove photo"
                    >&times;</button>
                  </div>
                {/each}
                {#each brochurePhotoFiles as _, i}
                  <div class="relative w-16 h-16 bg-white/10 rounded-lg flex items-center justify-center text-white/50 text-[10px]">
                    New
                    <button
                      type="button"
                      onclick={() => removeBrochurePhotoFile(i)}
                      class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none flex items-center justify-center"
                      aria-label="Remove"
                    >&times;</button>
                  </div>
                {/each}
              </div>
            {/if}
            <input
              id="brochure-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onchange={handleBrochurePhotoSelect}
              class="w-full text-white/70 text-[11px] file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-white/20 file:text-white"
            />
            {#if brochurePhotoError}
              <p class="text-amber-400 text-[10px] mt-1">{brochurePhotoError}</p>
            {/if}
          </div>
          <div class="flex gap-2">
            <button
              onclick={closeBrochurePanel}
              class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onclick={saveBrochure}
              disabled={isSavingBrochure}
              class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 text-white text-xs font-medium rounded-lg transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isSavingBrochure ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if reportPanelOpen && (lguBarangayInfo || mode === 'resident' || mode === 'guest')}
      <div
        class="fixed inset-0 z-[1100] flex items-center justify-center p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-create-title"
        tabindex="-1"
        onkeydown={(e) => e.key === 'Escape' && closeReportPanel()}
      >
        <!-- Full-screen scrim: pointer-events-auto so only the dimmed area closes; card stays clickable above. -->
        <button
          type="button"
          class="absolute inset-0 z-0 cursor-pointer border-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
          onclick={closeReportPanel}
          aria-label="Close dialog"
        ></button>
        <div
          class="relative z-10 w-full max-w-md max-h-[90vh] flex flex-col bg-[#0C212F] rounded-xl shadow-2xl border border-white/10 overflow-hidden pointer-events-auto"
          role="document"
        >
          <button
            type="button"
            onclick={closeReportPanel}
            class="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition cursor-pointer"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div class="relative min-h-[100px] overflow-hidden">
            <div
              class="absolute inset-0 bg-cover bg-center"
              style={reportCreateProfile?.brochurePhotoUrls?.[0]
                ? `background-image: url('${reportCreateProfile.brochurePhotoUrls[0]}'); filter: brightness(0.75);`
                : 'background-image: linear-gradient(135deg, #1B2E3A 0%, #0C212F 100%); filter: brightness(0.75);'}
            ></div>
            <div class="absolute inset-0 bg-gradient-to-t from-[#0C212F] via-[#0C212F]/80 to-transparent"></div>
            <div class="relative p-4 pt-10">
              <h2 id="report-create-title" class="text-white font-semibold text-base">Report Hazard / Disaster</h2>
              <p class="text-white/70 text-xs mt-0.5">
                {#if mode === 'resident' || mode === 'guest'}
                  {reportBarangayId
                    ? reportBarangayName + ', Minglanilla'
                    : 'Not within a barangay boundary'}
                {:else}
                  {(lguBarangayInfo?.name ?? '') + ', ' + (lguMunicipalityName || 'Minglanilla')}
                {/if}
              </p>
            </div>
          </div>
          <div class="p-4 overflow-y-auto flex-1 space-y-3 max-h-[60vh] scrollbar-hide">
            {#if latitude == null || longitude == null}
              <p class="text-amber-400 text-[11px]">
                {#if isLocating}
                  Getting your location…
                {:else}
                  Location is required. Please allow location access and try again.
                {/if}
              </p>
            {:else}
              <p class="text-white/60 text-[11px]">Location captured. Complete the form below.</p>
              <div class="flex items-center gap-2">
                <div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                  {userInitials || 'L'}
                </div>
                <span class="text-white/90 text-xs font-medium">{userLabel}</span>
              </div>
            {/if}
            <div>
              <label for="report-title" class="block text-white/60 text-[10px] mb-1">Title</label>
              <input
                id="report-title"
                type="text"
                bind:value={reportTitle}
                placeholder="e.g. Flooding at Delima Drive"
                class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none"
              />
            </div>
            <div>
              <label for="report-desc" class="block text-white/60 text-[10px] mb-1">Description</label>
              <p class="mb-1 text-[10px] text-white/55">Please describe the situation (at least 5 characters).</p>
              <div class="rounded-lg border border-white/20 bg-white/5 overflow-hidden">
                <textarea
                  id="report-desc"
                  bind:value={reportDescription}
                  placeholder="Describe the situation in detail..."
                  rows="4"
                  class="w-full bg-transparent text-white text-xs px-3 py-2 placeholder-white/40 focus:outline-none resize-none border-none"
                ></textarea>
                <div class="px-3 pb-3 pt-3 flex flex-wrap items-center gap-2 border-t border-white/10">
                  <input
                    id="report-photos"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onchange={handleReportPhotoSelect}
                    class="hidden"
                  />
                  <input
                    id="report-videos"
                    type="file"
                    accept="video/*"
                    capture="environment"
                    multiple
                    onchange={handleReportVideoSelect}
                    class="hidden"
                  />
                  <button
                    type="button"
                    onclick={() => document.getElementById('report-photos')?.click()}
                    class="report-media-btn w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/80 transition-colors cursor-pointer border border-transparent hover:bg-amber-500/25 hover:border-amber-400/40 hover:text-amber-300"
                    aria-label="Add photos"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </button>
                  <button
                    type="button"
                    onclick={() => document.getElementById('report-videos')?.click()}
                    class="report-media-btn w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/80 transition-colors cursor-pointer border border-transparent hover:bg-amber-500/25 hover:border-amber-400/40 hover:text-amber-300"
                    aria-label="Add videos"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                  {#if reportPhotoFiles.length > 0 || reportVideoFiles.length > 0}
                    <div class="flex flex-wrap gap-2 ml-1">
                      {#each reportPhotoFiles as _, i}
                        <div class="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-white/20">
                          <img src={reportPhotoPreviewUrls[i] || ''} alt="" class="w-full h-full object-cover" />
                          <button type="button" onclick={() => removeReportPhoto(i)} class="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500/90 hover:bg-red-500 text-white rounded-full text-xs leading-none flex items-center justify-center" aria-label="Remove">&times;</button>
                        </div>
                      {/each}
                      {#each reportVideoFiles as _, i}
                        <div class="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-white/20 bg-black/30">
                          <video src={reportVideoPreviewUrls[i] || ''} class="w-full h-full object-cover" muted playsinline preload="metadata"></video>
                          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white/80" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                          <button type="button" onclick={() => removeReportVideo(i)} class="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500/90 hover:bg-red-500 text-white rounded-full text-xs leading-none flex items-center justify-center pointer-events-auto" aria-label="Remove">&times;</button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              {#if reportDescription.trim().length > 0 && reportDescription.trim().length < 5}
                <p class="text-amber-400 text-[10px] mt-1">Please describe the situation (at least 5 characters).</p>
              {/if}
              {#if reportMediaError}
                <p class="text-amber-400 text-[10px] mt-1">{reportMediaError}</p>
              {/if}
            </div>
            <div class="rounded-lg border border-white/15 bg-white/5 px-3 py-2">
              <p class="text-[10px] text-white/65">Required attachment: add at least one photo or video.</p>
              <p class="text-[10px] mt-1 {reportPhotoFiles.length + reportVideoFiles.length > 0 ? 'text-emerald-300' : 'text-amber-400'}">
                {reportPhotoFiles.length + reportVideoFiles.length > 0
                  ? `Attached ${reportPhotoFiles.length + reportVideoFiles.length} file(s).`
                  : 'No attachments yet.'}
              </p>
            </div>
            <div class="flex gap-2 pt-2">
              <button
                type="button"
                onclick={closeReportPanel}
                class="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onclick={() => void submitReport()}
                disabled={isSubmittingReport || latitude == null || longitude == null || reportTitle.trim().length < 2 || reportDescription.trim().length < 5 || (reportPhotoFiles.length + reportVideoFiles.length) < 1 || ((mode === 'resident' || mode === 'guest') && !reportBarangayId)}
                title={isSubmittingReport || latitude == null || longitude == null
                  ? 'Waiting for location…'
                  : reportTitle.trim().length < 2 || reportDescription.trim().length < 5
                    ? 'Enter a title (2+ chars) and describe the situation (5+ chars).'
                    : (reportPhotoFiles.length + reportVideoFiles.length) < 1
                      ? 'Attach at least one photo or video.'
                    : (mode === 'resident' || mode === 'guest') && !reportBarangayId
                      ? 'Move inside a barangay boundary on the map, then open Report again.'
                      : 'Submit this report'}
                class="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:opacity-70 text-white text-xs font-medium rounded-lg transition enabled:cursor-pointer disabled:cursor-not-allowed"
              >
                {isSubmittingReport ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if assistancePanelOpen && assistanceBarangay}
      {@const isViewingOwnBarangay = lguBarangayInfo?.id === assistanceBarangay.id}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-96 md:max-h-[70vh] z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden flex flex-col">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10 shrink-0">
          <span class="text-white text-xs font-semibold">{isViewingOwnBarangay ? 'Assistance Received' : 'Provide Assistance'} — {assistanceBarangay.name}</span>
          <button onclick={closeAssistancePanel} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 overflow-y-auto flex-1 space-y-3">
          {#if !isViewingOwnBarangay}
            <p class="text-white/70 text-[11px]">
              Describe what you will provide (goods, manpower, etc.) and when it is expected to arrive.
            </p>
            <textarea
              bind:value={assistanceDescription}
              placeholder="e.g. 50 boxes of relief goods, water, blankets..."
              rows="3"
              class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none"
            ></textarea>
            <div>
              <label for="assistance-photo" class="block text-white/60 text-[10px] mb-1">Photo (optional)</label>
              <input
                id="assistance-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onchange={handleAssistancePhotoSelect}
                class="w-full text-white/70 text-[11px] file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-white/20 file:text-white"
              />
              {#if assistancePhotoError}
                <p class="text-amber-400 text-[10px] mt-1">{assistancePhotoError}</p>
              {/if}
            </div>
            <div>
              <label for="assistance-expected-arrival" class="block text-white/60 text-[10px] mb-1">Expected arrival (optional)</label>
              <input
                id="assistance-expected-arrival"
                type="datetime-local"
                bind:value={assistanceExpectedArrival}
                class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 focus:border-white/40 focus:outline-none"
              />
            </div>
            <button
              onclick={submitAssistance}
              disabled={isSubmittingAssistance || assistanceDescription.trim().length < 3}
              class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 text-white text-sm font-medium rounded-lg transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isSubmittingAssistance ? 'Submitting…' : 'Submit Offer'}
            </button>
          {/if}
          <div class="border-t border-white/10 pt-3">
            <p class="text-white/60 text-[10px] uppercase tracking-wider mb-2">Assistance log</p>
            {#if assistanceLog.length === 0}
              <p class="text-white/40 text-[11px]">No assistance offers yet.</p>
            {:else}
              <div class="space-y-2 max-h-40 overflow-y-auto">
                {#each assistanceLog as offer}
                  {@const orgLabel = offer.helpingMunicipalityName ? 'Municipal' : (offer.helpingBarangayName ?? '')}
                  {@const displayName = offer.creatorName !== 'Unknown' ? `${offer.creatorName} (${orgLabel || 'LGU'})` : (offer.helpingMunicipalityName ? `Municipality of ${offer.helpingMunicipalityName}` : offer.helpingBarangayName) ?? 'Unknown'}
                  {@const canMarkDelivered = (lguBarangayInfo?.id === offer.helpingBarangayId) || (lguMunicipalityId && offer.helpingMunicipalityId === lguMunicipalityId)}
                  <div class="bg-white/5 rounded-lg p-2 text-[11px]">
                    <p class="text-white/90 font-medium">{displayName}</p>
                    <p class="text-white/60 mt-0.5">{offer.description}</p>
                    {#if offer.assistanceImageUrl}
                      <img src={offer.assistanceImageUrl} alt="" class="mt-2 rounded-lg max-h-24 object-cover w-full" loading="lazy" />
                    {/if}
                    <p class="text-white/40 text-[10px] mt-0.5">
                      {offer.expectedArrivalAt ? `Expected: ${new Date(offer.expectedArrivalAt).toLocaleString()}` : ''}
                      {#if offer.deliveredAt}
                        <span class="text-green-400"> — Delivered {new Date(offer.deliveredAt).toLocaleString()}</span>
                      {:else if canMarkDelivered}
                        <button
                          onclick={() => handleMarkAssistanceDelivered(offer.id)}
                          class="ml-2 text-cyan-400 hover:text-cyan-300 underline"
                        >
                          Mark delivered
                        </button>
                      {/if}
                    </p>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if joinPanelOpen}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Join Existing Barangay</span>
          <button onclick={() => (joinPanelOpen = false)} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 max-h-64 overflow-y-auto">
          <p class="text-white/60 text-[11px] mb-2">Select a barangay to join. You can leave and join another later.</p>
          {#if joinableBarangays.length === 0}
            <p class="text-white/50 text-xs">No barangays available to join.</p>
          {:else}
            <div class="space-y-1.5">
              {#each joinableBarangays as b}
                <button
                  onclick={() => handleJoinBarangay(b.id)}
                  disabled={isJoining}
                  class="w-full text-left px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs transition cursor-pointer disabled:opacity-60"
                >
                  <span class="font-medium">{b.name}</span>
                  <span class="text-white/50 block text-[10px]">{b.municipalityName}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if municipalApprovalPanelOpen}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden border border-white/10">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Approve Boundary Requests</span>
          <button onclick={() => { municipalApprovalPanelOpen = false; closeRejectPanel(); clearMunicipalBoundaryPreview(); }} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 max-h-[70vh] overflow-y-auto">
          <p class="text-white/60 text-[11px] mb-3">Barangay responders submitted these boundary mappings. Review details, locate on map, then approve or reject.</p>
          {#if municipalPendingRequests.length === 0}
            <p class="text-white/50 text-xs">No pending boundary requests.</p>
          {:else}
            <div class="space-y-3">
              {#each municipalPendingRequests as req}
                <div class="px-3 py-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                  <p class="text-white font-semibold text-xs">{req.barangayName}, {req.municipalityName}</p>
                  <div class="text-white/80 text-[11px] space-y-0.5">
                    <p><span class="text-white/50">Creator:</span> {req.requesterName}</p>
                    <p><span class="text-white/50">Email:</span> {req.contactEmail}</p>
                    <p><span class="text-white/50">Contact:</span> {req.contactPhone}</p>
                    <p><span class="text-white/50">Submitted:</span> {new Date(req.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <div class="flex flex-wrap gap-2 pt-1">
                    <button
                      onclick={() => locateBoundaryOnMap(req.boundaryGeojson)}
                      type="button"
                      class="px-3 py-1.5 bg-cyan-600/80 hover:bg-cyan-500 text-white text-[11px] font-medium rounded-lg transition cursor-pointer"
                      title="Show creator&#39;s mapped boundary on the map"
                    >
                      Locate
                    </button>
                    <button
                      onclick={() => handleApproveBoundaryRequest(req.id)}
                      disabled={isApprovingRequestId === req.id}
                      class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-[11px] font-medium rounded-lg transition cursor-pointer"
                    >
                      {#if isApprovingRequestId === req.id}Approving…{:else}Approve{/if}
                    </button>
                    <button
                      onclick={() => openRejectPanel(req.id)}
                      disabled={isRejectingRequestId === req.id}
                      class="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 disabled:opacity-60 text-white text-[11px] font-medium rounded-lg transition cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if rejectingRequestId}
      <div class="absolute inset-0 z-[1001] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="reject-dialog-title">
        <div class="w-full max-w-sm rounded-xl bg-[#0C212F]/98 border border-white/10 shadow-xl p-4">
          <h2 id="reject-dialog-title" class="text-white text-sm font-semibold mb-2">Reject Boundary Request</h2>
          <p class="text-white/70 text-[11px] mb-3">Provide a reason for rejection. The requester will see this feedback.</p>
          <textarea
            bind:value={rejectReason}
            placeholder="e.g. Boundary overlaps with existing barangay; incorrect area; needs revision..."
            rows="4"
            class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none mb-3"
          ></textarea>
          <div class="flex gap-2">
            <button onclick={closeRejectPanel} class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer">Cancel</button>
            <button onclick={handleRejectBoundaryRequest} disabled={isRejectingRequestId === rejectingRequestId} class="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition cursor-pointer">
              {#if isRejectingRequestId === rejectingRequestId}Rejecting…{:else}Reject{/if}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if leavePanelOpen}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Leave Barangay</span>
          <button onclick={() => (leavePanelOpen = false)} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 space-y-3">
          <p class="text-white/60 text-[11px]">You joined this barangay. Provide a reason (optional) and confirm to leave. You can join another barangay afterward.</p>
          <textarea
            bind:value={leaveReason}
            placeholder="e.g. Transferred to another area..."
            rows="2"
            class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none"
          ></textarea>
          <div class="flex gap-2">
            <button onclick={() => (leavePanelOpen = false)} class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer">Cancel</button>
            <button onclick={handleLeaveBarangay} disabled={isLeaving} class="flex-1 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition cursor-pointer">Leave</button>
          </div>
        </div>
      </div>
    {/if}

    {#if deleteRequestPanelOpen}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Request Barangay Deletion</span>
          <button onclick={() => (deleteRequestPanelOpen = false)} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 space-y-3">
          <p class="text-white/60 text-[11px]">You created this barangay. Submit a delete request. Admin must approve. Provide a reason (optional).</p>
          <textarea
            bind:value={deleteReason}
            placeholder="e.g. Duplicate, wrong area..."
            rows="2"
            class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none resize-none"
          ></textarea>
          <div class="flex gap-2">
            <button onclick={() => (deleteRequestPanelOpen = false)} class="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer">Cancel</button>
            <button onclick={handleRequestBarangayDelete} disabled={isRequestingDelete} class="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition cursor-pointer">Submit Request</button>
          </div>
        </div>
      </div>
    {/if}

    {#if hazardPanelOpen && mode !== 'resident'}
      <div class="absolute bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-56 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold tracking-wide">Hazard Layers</span>
          <button onclick={() => (hazardPanelOpen = false)} class="text-white/50 hover:text-white transition cursor-pointer text-sm" aria-label="Close">&times;</button>
        </div>
        <div class="p-2 space-y-0.5 max-h-48 overflow-y-auto">
          {#each HAZARD_LAYERS as config}
            <button
              onclick={() => toggleHazardLayer(config.type)}
              class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors cursor-pointer text-left {isHazardActive(config.type) ? 'bg-white/10' : 'hover:bg-white/5'} touch-manipulation"
            >
              <span class="w-3 h-3 rounded-sm shrink-0 border border-white/20" style="background-color: {config.color}; opacity: {isHazardActive(config.type) ? 1 : 0.4}"></span>
              <span class="text-white/80 text-xs flex-1">{config.label}</span>
              {#if loadingHazards[config.type]}
                <svg class="animate-spin h-3.5 w-3.5 text-white/50" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              {:else if isHazardActive(config.type)}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3.5 h-3.5 text-green-400">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              {/if}
            </button>
          {/each}
        </div>
        <div class="px-3 py-2 border-t border-white/10">
          <p class="text-white/40 text-[10px] mb-1.5">Risk Level (opacity)</p>
          <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-white/55"></span><span class="text-white/50 text-[10px]">High</span></div>
            <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-white/35"></span><span class="text-white/50 text-[10px]">Moderate</span></div>
            <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-white/18"></span><span class="text-white/50 text-[10px]">Low</span></div>
          </div>
        </div>
      </div>
    {/if}

    {#if legendOpen && mode !== 'resident'}
      <div class="absolute bottom-24 md:bottom-4 left-4 right-4 md:right-auto md:w-52 z-[1000] bg-[#0C212F]/95 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden border border-white/10">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <span class="text-white text-xs font-semibold">Map Legend</span>
          <button onclick={() => (legendOpen = false)} class="text-white/50 hover:text-white transition text-sm cursor-pointer" aria-label="Close">&times;</button>
        </div>
        <div class="p-3 space-y-3 text-xs">
          <div>
            <p class="text-white/50 mb-2 uppercase tracking-wider">Barangay Status</p>
            <div class="space-y-1.5">
              {#each Object.entries(BARANGAY_STATUS_COLORS) as [status, color]}
                <div class="flex items-center gap-2">
                  <span class="w-4 h-4 rounded-sm shrink-0 border border-white/20" style="background-color: {color}"></span>
                  <span class="text-white/80">{BARANGAY_STATUS_LABELS[status as BarangayStatusEnum]}</span>
                </div>
              {/each}
            </div>
          </div>
          <div>
            <p class="text-white/50 mb-2 uppercase tracking-wider">Hazard Types</p>
            <div class="space-y-1.5">
              {#each HAZARD_LAYERS as config}
                <div class="flex items-center gap-2">
                  <span class="w-4 h-4 rounded-sm shrink-0 border border-white/20" style="background-color: {config.color}"></span>
                  <span class="text-white/80">{config.label}</span>
                </div>
              {/each}
            </div>
          </div>
          <div>
            <p class="text-white/50 mb-2 uppercase tracking-wider">Risk Level</p>
            <div class="space-y-1.5">
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-sm bg-white/55 border border-white/20"></span>
                <span class="text-white/80">High risk</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-sm bg-white/35 border border-white/20"></span>
                <span class="text-white/80">Moderate risk</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-sm bg-white/18 border border-white/20"></span>
                <span class="text-white/80">Low risk</span>
              </div>
            </div>
          </div>
          <div>
            <p class="text-white/50 mb-2 uppercase tracking-wider">Markers</p>
            <div class="flex flex-col gap-2">
              <!-- Current location pin: system navy teardrop -->
              <div class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="18" viewBox="0 0 20 26" class="shrink-0">
                  <path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#1B2E3A" stroke="white" stroke-width="1.5"/>
                  <circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/>
                </svg>
                <span class="text-white/80">Current Location</span>
              </div>
              <!-- Search result pin: violet teardrop -->
              <div class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="18" viewBox="0 0 20 26" class="shrink-0">
                  <path d="M10 0C4.477 0 0 4.477 0 10c0 6.627 10 16 10 16s10-9.373 10-16C20 4.477 15.523 0 10 0z" fill="#7c3aed" stroke="white" stroke-width="1.5"/>
                  <circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.85"/>
                </svg>
                <span class="text-white/80">Search Result</span>
              </div>
              <!-- Hazard / Disaster report: small red circle -->
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-full bg-red-600 border-2 border-white shrink-0" style="box-shadow: 0 2px 6px rgba(0,0,0,0.35)"></span>
                <span class="text-white/80">Hazard / Disaster Report</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if selectedReport}
      <div
        class="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-detail-title"
        tabindex="-1"
        onkeydown={(e) => e.key === 'Escape' && closeReportDetail()}
      >
        <button
          class="absolute inset-0 cursor-pointer"
          onclick={closeReportDetail}
          aria-label="Close dialog"
        ></button>
        <div
          class="relative z-10 w-full max-w-xl max-h-[90vh] flex flex-col bg-[#1B2E3A] rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
          role="document"
        >
          <button
            onclick={closeReportDetail}
            class="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition cursor-pointer"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          <!-- Feed-style header: icon + name, then location + publish date -->
          <div class="p-4 pb-3">
            <div class="flex items-start gap-3">
              {#if selectedReport.publisherAvatarUrl}
                <img src={selectedReport.publisherAvatarUrl} alt="" class="w-10 h-10 rounded-full border border-white/10 object-cover shrink-0" />
              {:else}
                <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold border border-white/10 shrink-0">
                  {initialsFromName(selectedReport.publisherName)}
                </div>
              {/if}
              <div class="flex-1 min-w-0">
                <h2 id="report-detail-title" class="text-white text-sm font-semibold leading-tight truncate">{selectedReport.publisherName}</h2>
                <p class="text-white/50 text-[11px] mt-0.5 truncate">
                  {selectedReport.barangayName}{selectedReport.municipalityName ? `, ${selectedReport.municipalityName}` : ''}
                  <span class="mx-1 text-white/30">·</span>
                  {timeAgo(selectedReport.createdAt)}
                  {#if isReportEdited(selectedReport)}
                    <span class="ml-1 text-amber-300 text-[10px] font-medium">(edited)</span>
                  {/if}
                </p>
              </div>
            </div>
            {#if selectedReport.title || selectedReport.description}
              <div class="mt-3">
                {#if selectedReport.title}
                  <p class="text-white text-sm font-medium mb-1">{selectedReport.title}</p>
                {/if}
                {#if selectedReport.description}
                  <p class="text-white/70 text-sm leading-relaxed">{selectedReport.description}</p>
                {/if}
              </div>
            {/if}
            {#if selectedReport.photoUrls.length > 0 || selectedReport.videoUrls.length > 0}
              <div class="mt-3 space-y-2">
                {#if selectedReport.photoUrls.length > 0}
                  <div class="flex flex-wrap gap-2">
                    {#each selectedReport.photoUrls as url}
                      <a href={url} target="_blank" rel="noopener noreferrer" class="block">
                        <img src={url} alt="" class="w-20 h-20 object-cover rounded-lg border border-white/10 hover:border-white/30 transition" loading="lazy" />
                      </a>
                    {/each}
                  </div>
                {/if}
                {#if selectedReport.videoUrls.length > 0}
                  {#each selectedReport.videoUrls as url}
                    <video src={url} controls class="w-full max-h-40 rounded-lg border border-white/10" preload="metadata" aria-label="Report video"><track kind="captions" src="" srclang="en" label="No captions" /></video>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>

          <div class="mx-4 border-t border-white/10"></div>

          <!-- Comments: 2 initial top-level, View more (+5); 2 replies per comment, View more replies (+5) -->
          {#if getSelectedReportTopLevelNotes().length > 0}
            <div class="px-4 pt-3 pb-1 space-y-2 overflow-y-auto flex-1 min-h-0 sidebar-scroll">
              {#each getSelectedReportTopLevelNotes().slice(0, selectedReportCommentVisibleTopCount) as note (note.id)}
                <div class="space-y-1.5">
                  <div class="flex items-start gap-2">
                    <div class="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
                      {initialsFromName(note.authorName)}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 text-[11px]">
                        <span class="text-white/90 font-medium truncate max-w-[140px]">{note.authorName}</span>
                        <span class="text-white/30 text-[10px]">{timeAgo(note.createdAt)}</span>
                      </div>
                      <p class="text-white/80 text-xs leading-snug mt-0.5 break-words">{note.body}</p>
                      {#if note.photoUrls?.length}
                        <div class="mt-1 flex flex-wrap gap-1.5">
                          {#each note.photoUrls as url}
                            <a href={url} target="_blank" rel="noopener noreferrer" class="block">
                              <img src={url} alt="" class="w-14 h-14 rounded-md border border-white/10 object-cover hover:border-white/30 transition" loading="lazy" />
                            </a>
                          {/each}
                        </div>
                      {/if}
                      {#if canCommentSelectedReport}
                        <button
                          type="button"
                          class="mt-1 text-[10px] font-medium text-white/50 hover:text-white/80 transition touch-manipulation cursor-pointer"
                          onclick={() => startSelectedReportReply(note.id)}
                        >
                          Reply
                        </button>
                      {/if}
                    </div>
                  </div>
                  {#each getSelectedReportRepliesForNote(note.id).slice(0, selectedReportReplyVisibleCounts[note.id] ?? 2) as reply (reply.id)}
                    <div class="mt-1 ml-8 pl-3 border-l border-white/10 flex items-start gap-2">
                      <div class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white text-[9px] font-semibold shrink-0">
                        {initialsFromName(reply.authorName)}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 text-[10px]">
                          <span class="text-white/85 font-medium truncate max-w-[120px]">{reply.authorName}</span>
                          <span class="text-white/30">{timeAgo(reply.createdAt)}</span>
                        </div>
                        <p class="text-white/80 text-[11px] leading-snug mt-0.5 break-words">{reply.body}</p>
                        {#if reply.photoUrls?.length}
                          <div class="mt-1 flex flex-wrap gap-1.5">
                            {#each reply.photoUrls as url}
                              <a href={url} target="_blank" rel="noopener noreferrer" class="block">
                                <img src={url} alt="" class="w-12 h-12 rounded-md border border-white/10 object-cover hover:border-white/30 transition" loading="lazy" />
                              </a>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                  {#if selectedReportReplyTarget === note.id && canCommentSelectedReport}
                    <div class="mt-1 ml-8 pl-3 flex items-start gap-2">
                      <div class="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-white text-[9px] font-semibold shrink-0">
                        {userInitials || 'R'}
                      </div>
                      <div class="flex-1 min-w-0">
                        <input
                          type="text"
                          placeholder="Reply to {note.authorName}…"
                          value={selectedReportReplyDrafts[note.id] ?? ''}
                          oninput={(e) => {
                            const v = (e.target as HTMLInputElement).value;
                            selectedReportReplyDrafts = { ...selectedReportReplyDrafts, [note.id]: v };
                          }}
                          class="w-full bg-[#0C212F]/60 text-white/80 placeholder-white/30 text-[11px] px-3 py-1.5 rounded-full border border-white/10 focus:outline-none focus:border-white/30"
                          aria-label="Write a reply"
                          onkeydown={(event) => {
                            const e = event as KeyboardEvent;
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              const draft = (selectedReportReplyDrafts[note.id] ?? '').trim();
                              if (draft.length >= 2 && !selectedReportSubmittingReplyFor) void submitSelectedReportReply(note.id);
                            }
                          }}
                        />
                        {#if (selectedReportReplyPhotos[note.id]?.length ?? 0) > 0}
                          <div class="mt-1 flex flex-wrap gap-1">
                            {#each selectedReportReplyPhotos[note.id] ?? [] as url (url)}
                              <div class="relative w-9 h-9 rounded-md overflow-hidden border border-white/10">
                                <img src={url} alt="" class="w-full h-full object-cover" loading="lazy" />
                                <button
                                  type="button"
                                  class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] flex items-center justify-center hover:bg-black"
                                  aria-label="Remove attached photo"
                                  onclick={() => removeSelectedReportReplyPhoto(note.id, url)}
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
                            onchange={async (event) => {
                              const input = event.target as HTMLInputElement;
                              const files = Array.from(input.files ?? []);
                              input.value = '';
                              for (const file of files) {
                                const url = await uploadReportPhoto(file);
                                if (url) selectedReportReplyPhotos = { ...selectedReportReplyPhotos, [note.id]: [...(selectedReportReplyPhotos[note.id] ?? []), url] };
                              }
                            }}
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
                          disabled={selectedReportSubmittingReplyFor === note.id}
                          onclick={() => submitSelectedReportReply(note.id)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  {/if}
                  {#if getSelectedReportRepliesForNote(note.id).length > (selectedReportReplyVisibleCounts[note.id] ?? Math.min(2, getSelectedReportRepliesForNote(note.id).length))}
                    <button
                      type="button"
                      class="mt-1 ml-8 pl-3 text-[9px] font-medium text-white/55 hover:text-white/85 transition touch-manipulation cursor-pointer"
                      onclick={() => showMoreSelectedReportReplies(note.id)}
                    >
                      View more replies
                    </button>
                  {/if}
                </div>
              {/each}
              {#if getSelectedReportTopLevelNotes().length > selectedReportCommentVisibleTopCount}
                <button
                  type="button"
                  class="mt-1 mb-2 text-[10px] font-medium text-white/60 hover:text-white/85 transition touch-manipulation cursor-pointer"
                  onclick={showMoreSelectedReportComments}
                >
                  View more comments
                </button>
              {/if}
            </div>
          {/if}

          <!-- Bottom action bar: comment input + comment count + photo + upvote (same as feed; always allow when signed in) -->
          <div class="p-4 pt-3 border-t border-white/10 flex items-center gap-2">
            {#if canCommentSelectedReport}
              <div class={selectedReportActiveCommentFocus ? 'basis-4/5' : 'basis-2/3'}>
                <input
                  type="text"
                  placeholder="Write a comment…"
                  bind:value={selectedReportCommentDraft}
                  class="w-full bg-[#0C212F]/60 text-white/80 placeholder-white/30 text-xs px-4 py-2 rounded-full border border-white/10 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition"
                  aria-label="Write a comment"
                  onfocus={() => (selectedReportActiveCommentFocus = true)}
                  onblur={() => {
                    if (!selectedReportCommentDraft.trim()) selectedReportActiveCommentFocus = false;
                  }}
                  onkeydown={(event) => {
                    const e = event as KeyboardEvent;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (selectedReportCommentDraft.trim().length >= 2 && !selectedReportSubmitting) void submitSelectedReportComment();
                    }
                  }}
                />
                {#if selectedReportCommentPhotos.length > 0}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each selectedReportCommentPhotos as url (url)}
                      <div class="relative w-10 h-10 rounded-md overflow-hidden border border-white/10">
                        <img src={url} alt="" class="w-full h-full object-cover" loading="lazy" />
                        <button
                          type="button"
                          class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] flex items-center justify-center hover:bg-black"
                          aria-label="Remove attached photo"
                          onclick={() => removeSelectedReportCommentPhoto(url)}
                        >
                          ×
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="flex items-center justify-start gap-1 ml-2 shrink-0">
                {#if !selectedReportActiveCommentFocus}
                  <div class="flex items-center gap-0.5">
                    <button
                      class="p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation text-white/60 hover:text-white/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                      aria-label="Submit comment"
                      title="Comment"
                      disabled={selectedReportSubmitting}
                      onclick={() => submitSelectedReportComment()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                      </svg>
                    </button>
                    <span class="text-white/50 text-[10px]">{selectedReportComments.length}</span>
                  </div>
                {/if}
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
                    onchange={async (event) => {
                      const input = event.target as HTMLInputElement;
                      const files = Array.from(input.files ?? []);
                      input.value = '';
                      for (const file of files) {
                        const url = await uploadReportPhoto(file);
                        if (url) selectedReportCommentPhotos = [...selectedReportCommentPhotos, url];
                      }
                    }}
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h12a2.25 2.25 0 012.25 2.25v9.75A2.25 2.25 0 0118 18.75H6A2.25 2.25 0 013.75 16.5V6.75z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12.75l2.9-2.9a1.5 1.5 0 012.12 0l2.9 2.9M13.5 11.25l1.15-1.15a1.5 1.5 0 012.12 0l1.73 1.73" />
                  </svg>
                </label>
                {#if canUpvoteSelectedReport}
                  <button
                    class="flex items-center gap-0.5 p-1.5 rounded-full hover:bg-white/10 transition touch-manipulation disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer {selectedReportHasUpvoted ? 'text-amber-300' : 'text-white/60 hover:text-orange-400'}"
                    aria-label="Upvotes"
                    title="Upvotes"
                    disabled={selectedReportTogglingUpvote}
                    onclick={() => toggleSelectedReportUpvote()}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                    </svg>
                    <span class="text-[10px]">{selectedReport.upvoteCount ?? 0}</span>
                  </button>
                {/if}
              </div>
            {:else}
              <p class="text-white/50 text-[11px]">
                {mode === 'guest'
                  ? 'Log in to comment and upvote.'
                  : 'Sign in to upvote or comment.'}
              </p>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if locationError}
      <div class="absolute top-16 left-1/2 -translate-x-1/2 z-[1200] bg-red-600/90 text-white text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-[90vw] md:max-w-xs text-center backdrop-blur-sm flex items-center gap-2">
        <span class="flex-1">{locationError}</span>
        <button onclick={() => (locationError = '')} class="font-bold hover:text-red-200 cursor-pointer shrink-0 touch-manipulation">✕</button>
      </div>
    {/if}
    {#if locationSuccess}
      <div class="absolute top-16 left-1/2 -translate-x-1/2 z-[1200] bg-emerald-600/90 text-white text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-[90vw] md:max-w-xs text-center backdrop-blur-sm flex items-center gap-2">
        <span class="flex-1">{locationSuccess}</span>
        <button onclick={() => (locationSuccess = '')} class="font-bold hover:text-emerald-200 cursor-pointer shrink-0 touch-manipulation">✕</button>
      </div>
    {/if}

    {#if mode === 'guest' && latitude !== null && longitude !== null}
      <div class="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-[#0C212F]/80 text-white/80 text-[10px] md:text-xs rounded-lg px-3 py-2 shadow-md backdrop-blur-sm font-mono">
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </div>
    {/if}
  </div>
</div>
