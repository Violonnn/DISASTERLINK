<script lang="ts">
  /**
   * MapDashboard — shared map view for guest-dashboard and lgu-responder.
   * Shows hazard layers, search, GPS, barangay status layer (realtime), and LGU-specific draw/status controls.
   */
  import { onMount, onDestroy } from 'svelte';
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
  import { fetchNotifications, countUnreadNotifications, markAllNotificationsRead, type Notification } from '$lib/services/notifications';
  import { searchPlace, reverseGeocode, type GeocodeResult } from '$lib/services/geocode';
  import {
    fetchBarangayProfile,
    updateBarangayProfile,
    uploadBrochurePhoto,
    validateBrochurePhoto
  } from '$lib/services/barangay-profile';
  import {
    fetchReportTypes,
    fetchAllHazardReports,
    createHazardReport,
    uploadReportPhoto,
    uploadReportVideo,
    validateReportPhoto,
    validateReportVideo,
    subscribeReportsRealtime,
    type ReportType,
    type HazardReport
  } from '$lib/services/hazard-report';

  interface Props {
    mode: 'guest' | 'lgu';
    userLabel?: string;
    userInitials?: string;
    locationLabel?: string;
    menuItems?: { label: string; href?: string; action?: () => void }[];
    pfpMenuItems?: { label: string; href?: string; action?: () => void }[];
    hamburgerMenuItems?: { label: string; href?: string; action?: () => void }[];
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
  }

  let {
    mode = 'guest',
    userLabel = mode === 'guest' ? 'Guest User' : 'LGU',
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
    currentUserId
  }: Props = $props();

  const signedInUserId = $derived(
    ((currentUserId ?? (mode === 'lgu' ? lguUserId : '')) || '').trim() || null
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

  let searchQuery = $state('');
  let searchResults = $state<GeocodeResult[]>([]);
  let isSearching = $state(false);
  let searchDropdownOpen = $state(false);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let hazardPanelOpen = $state(false);
  let activeHazardLayers = $state<Record<string, L.GeoJSON>>({});
  let loadingHazards = $state<Record<string, boolean>>({});

  let legendOpen = $state(false);
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

  let barangayMgmtExpanded = $state(false);

  let brochurePanelOpen = $state(false);
  let brochureDescription = $state('');
  let brochureExistingUrls = $state<string[]>([]);
  let brochurePhotoFiles = $state<File[]>([]);
  let brochurePhotoError = $state('');
  let isSavingBrochure = $state(false);

  /* Hazard report state — LGU can report disasters with location, photos, videos */
  let reportPanelOpen = $state(false);
  let reportTypes = $state<ReportType[]>([]);
  let reportTitle = $state('');
  let reportDescription = $state('');
  let reportTypeId = $state('');
  let reportPhotoFiles = $state<File[]>([]);
  let reportVideoFiles = $state<File[]>([]);
  let reportMediaError = $state('');
  let isSubmittingReport = $state(false);
  let hazardReports = $state<HazardReport[]>([]);
  let reportMarkersLayer = $state<L.LayerGroup | null>(null);
  let reportsChannel: ReturnType<typeof subscribeReportsRealtime> | null = null;
  let selectedReport = $state<HazardReport | null>(null);
  let reportCreateProfile = $state<{ brochurePhotoUrls: string[] } | null>(null);
  let reportPhotoPreviewUrls = $state<string[]>([]);
  let reportVideoPreviewUrls = $state<string[]>([]);

  const DEFAULT_CENTER: [number, number] = [10.3157, 123.8854];
  const DEFAULT_ZOOM = 13;

  function toggle(name: string) {
    notificationsOpen = false;
    openMenu = openMenu === name ? null : name;
  }
  function close() {
    openMenu = null;
    notificationsOpen = false;
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
    searchMarker = leaflet.marker([lat, lon]).addTo(map).bindPopup(displayName).openPopup();
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
    html += `</div>`;
    return html;
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

    const layer = createBarangayStatusLayer(leaflet, data, buildBarangayPopupHtml);
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

  function handleMapContainerClick(e: MouseEvent) {
    const assistBtn = (e.target as HTMLElement).closest?.('.provide-assistance-btn');
    const viewBtn = (e.target as HTMLElement).closest?.('.view-assistance-received-btn');
    const setStatusBtn = (e.target as HTMLElement).closest?.('.set-status-btn');
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
    openMenu = null;
    notificationsOpen = true;
    await loadNotifications();
  }

  async function handleMarkAllNotificationsRead() {
    if (!lguUserId) return;
    await markAllNotificationsRead(lguUserId);
    await loadNotifications();
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
      marker = leaflet
        .marker([lat, lon])
        .addTo(map)
        .bindPopup('Locating address…')
        .openPopup();
      const address = await reverseGeocode(lat, lon);
      locationText = address;
      marker.setPopupContent(address);
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

  /* ── Hazard report: open panel, capture location first, then show form ── */
  async function openReportPanel() {
    if (!lguBarangayInfo?.id || !lguUserId) return;
    reportPanelOpen = true;
    reportTitle = '';
    reportDescription = '';
    reportTypeId = '';
    reportPhotoFiles = [];
    reportVideoFiles = [];
    reportMediaError = '';
    reportCreateProfile = null;
    if (lguBarangayInfo?.id) {
      const profile = await fetchBarangayProfile(lguBarangayInfo.id);
      reportCreateProfile = profile ? { brochurePhotoUrls: profile.brochurePhotoUrls } : null;
    }
    if (reportTypes.length === 0) reportTypes = await fetchReportTypes();
    if (reportTypes.length > 0) reportTypeId = reportTypes[0].id;
    /* Capture location immediately when opening */
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
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
      if (map && marker) map.removeLayer(marker);
      marker = leaflet!.marker([latitude!, longitude!]).addTo(map!).bindPopup('Report location').openPopup();
      map?.flyTo([latitude!, longitude!], 16, { duration: 1 });
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
    reportTitle = '';
    reportDescription = '';
    reportTypeId = '';
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
    if (!lguBarangayInfo?.id || !lguUserId || latitude == null || longitude == null) return;
    const title = reportTitle.trim();
    if (title.length < 2) {
      locationError = 'Please enter a title (at least 2 characters).';
      return;
    }
    if (reportDescription.trim().length < 5) {
      locationError = 'Please add a description (at least 5 characters).';
      return;
    }
    if (!reportTypeId) {
      locationError = 'Please select a hazard type.';
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
      const { id, error } = await createHazardReport({
        barangayId: lguBarangayInfo.id,
        reporterId: lguUserId,
        reportTypeId,
        title,
        description: reportDescription.trim(),
        gpsLat: latitude,
        gpsLng: longitude,
        photoUrls,
        videoUrls
      });
      if (error) locationError = error;
      else if (id) {
        closeReportPanel();
        locationSuccess = 'Report submitted successfully.';
        await refreshReportMarkers();
      }
    } finally {
      isSubmittingReport = false;
    }
  }

  function openReportDetail(r: HazardReport) {
    selectedReport = r;
  }

  function closeReportDetail() {
    selectedReport = null;
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
    if (hazardReports.length === 0) return;
    const hazardIcon = leaflet.divIcon({
      className: 'hazard-report-marker',
      html: '<div style="width:24px;height:24px;background:#dc2626;border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    const group = leaflet.layerGroup();
    for (const r of hazardReports) {
      if (r.gpsLat == null || r.gpsLng == null) continue;
      const m = leaflet.marker([r.gpsLat, r.gpsLng], { icon: hazardIcon });
      m.on('click', () => openReportDetail(r));
      m.bindTooltip(buildReportTooltipHtml(r), { direction: 'top', className: 'hazard-marker-tooltip', offset: [0, -8] });
      group.addLayer(m);
    }
    group.addTo(map);
    reportMarkersLayer = group;
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
      L.control.zoom({ position: 'topleft' }).addTo(map);

      try {
        await refreshBarangayStatusLayer();
        realtimeChannel = subscribeBarangayStatusRealtime(() => refreshBarangayStatusLayer());
        reportsChannel = subscribeReportsRealtime(() => refreshReportMarkers());
        if (mode === 'lgu' && lguUserId) {
          unreadCount = await countUnreadNotifications(lguUserId);
        }
      } catch {
        /* Barangay layer may fail if tables not set up; map still works */
      }
    })();

    return teardownFullscreen;
  });

  onDestroy(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    realtimeChannel?.unsubscribe?.();
    assistanceChannel?.unsubscribe?.();
    reportsChannel?.unsubscribe?.();
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
  :global(.hazard-marker-tooltip .report-tooltip-with-img) {
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
</style>

<div id={mapRootId} class="fixed inset-0 flex flex-col bg-[#0C212F]">
  <header class="h-12 md:h-14 shrink-0 bg-[#0C212F]/95 shadow-md z-50 border-b border-white/10">
    <div class="h-full mx-auto flex items-center justify-between gap-2 px-3 md:px-4 max-w-screen-xl relative">
      <div class="flex items-center gap-2 md:gap-3 relative z-20 shrink-0">
        {#if openMenu || notificationsOpen}
          <button class="fixed inset-0 z-10 cursor-default" onclick={close} aria-label="Close menu"></button>
        {/if}
        <div class="flex items-center gap-2 bg-[#768391]/10 rounded-full px-2 md:px-3 py-1 relative z-20">
          <div class="relative">
            <button
              class="bg-white/20 text-white rounded-full w-7 h-7 md:w-8 md:h-8 flex items-center justify-center text-[10px] md:text-xs font-bold hover:bg-white/30 transition cursor-pointer touch-manipulation"
              onclick={() => toggle('pfp')}
            >
              {userInitials || userLabel.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
            </button>
            {#if openMenu === 'pfp'}
              <div class="absolute left-0 mt-3 w-48 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30">
                <p class="px-3 py-2 text-[10px] text-gray-400 border-b border-gray-100">{userLabel}</p>
                <div class="p-2">
                  {#each (mode === 'lgu' && pfpMenuItems ? pfpMenuItems : menuItems) as item}
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
                          <a href={n.link ?? '#'} class="block px-3 py-2.5 hover:bg-gray-50 transition {n.readAt ? 'opacity-70' : ''}" onclick={() => (notificationsOpen = false)}>
                            <p class="text-[#1B2E3A] text-xs font-medium">{n.title}</p>
                            <p class="text-gray-600 text-[10px] mt-0.5 line-clamp-2">{n.body}</p>
                            <p class="text-gray-400 text-[10px] mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                          </a>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          <div class="relative">
            <button class="cursor-pointer p-1 touch-manipulation" onclick={() => toggle('menu')} aria-label="Menu">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            {#if openMenu === 'menu'}
              <div class="absolute left-0 mt-3 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30 min-w-[200px] md:min-w-[220px]">
                <div class="p-2">
                  <div class="grid grid-cols-3 gap-1">
                    {#each (mode === 'lgu' && hamburgerMenuItems ? hamburgerMenuItems : menuItems) as item}
                      {#if item.href}
                        <a href={item.href} class="flex flex-col items-center px-3 py-3 hover:bg-gray-50 rounded-lg text-center touch-manipulation">
                          <div class="w-7 h-7 bg-gray-100 rounded-full mb-1.5"></div>
                          <span class="text-[10px] text-[#1B2E3A] font-medium">{item.label}</span>
                        </a>
                      {:else if item.action}
                        <button
                          class="flex flex-col items-center px-3 py-3 hover:bg-gray-50 rounded-lg text-center touch-manipulation w-full"
                          onclick={() => { item.action?.(); close(); }}
                        >
                          <div class="w-7 h-7 bg-gray-100 rounded-full mb-1.5"></div>
                          <span class="text-[10px] text-[#1B2E3A] font-medium">{item.label}</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                  {#if mode === 'lgu' && (!pendingRequest || lguRole === 'municipal_responder')}
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
                          {#if lguRole === 'municipal_responder'}
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
                          {:else if lguRole !== 'municipal_responder'}
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
        {#if mode === 'lgu'}
          <p class="text-white text-[10px] sm:text-xs text-center whitespace-nowrap overflow-hidden max-w-[90vw] md:max-w-md text-ellipsis" title="Current Location: {isLocating ? 'Locating…' : locationText} · {lguRole === 'municipal_responder' ? 'Affiliated Municipality' : 'Affiliated Barangay'}: {lguRole === 'municipal_responder' ? (lguMunicipalityName || '—') : (lguBarangayInfo?.name ?? '—')}">
            <span class="text-white/70">Current Location:</span>
            <span class="text-white/95">{#if isLocating}Locating…{:else}{locationText}{/if}</span>
            <span class="text-white/50 mx-1.5">·</span>
            <span class="text-white/70">{lguRole === 'municipal_responder' ? 'Affiliated Municipality:' : 'Affiliated Barangay:'}</span>
            <span class="text-white/95">{lguRole === 'municipal_responder' ? (lguMunicipalityName || '—') : (lguBarangayInfo?.name ?? '—')}</span>
          </p>
        {/if}
      </div>
      {#if mode !== 'lgu'}
        <p class="text-white/70 text-[10px] md:text-xs truncate max-w-[100px] sm:max-w-[140px] md:max-w-xs text-right shrink-0 ml-auto">
          {#if isLocating}Locating…{:else}{locationLabel || locationText}{/if}
        </p>
      {:else}
        <div class="w-[1px] shrink-0" aria-hidden="true"></div>
      {/if}
    </div>
  </header>

  <div class="flex-1 relative min-h-0 map-dashboard-wrapper" onclick={handleMapContainerClick} role="presentation">
    <div bind:this={mapElement} class="absolute inset-0 z-0"></div>

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

    {#if searchDropdownOpen}
      <button class="fixed inset-0 z-[999] cursor-default" onclick={() => (searchDropdownOpen = false)} aria-label="Close search"></button>
    {/if}

    <div class="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 md:right-4 flex flex-col-reverse gap-2 z-[1000] pointer-events-none">
      <div class="flex flex-wrap gap-2 pointer-events-auto justify-end md:justify-start">
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

        <button
          onclick={getMyLocation}
          disabled={isLocating}
          class="flex items-center gap-2 px-4 py-3 md:px-5 md:py-2.5 bg-[#0C212F]/90 hover:bg-[#1B2E3A] disabled:bg-gray-600 text-white text-sm font-medium rounded-xl shadow-lg backdrop-blur-sm transition-all cursor-pointer disabled:cursor-not-allowed touch-manipulation min-h-[44px] md:min-h-0"
        >
          {#if isLocating}
            <svg class="animate-spin h-5 w-5 md:h-4 md:w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span>Locating…</span>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 md:w-4 md:h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span class="hidden sm:inline">Get My Location</span>
          {/if}
        </button>

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

    {#if reportPanelOpen && lguBarangayInfo}
      <div
        class="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-create-title"
        tabindex="-1"
        onkeydown={(e) => e.key === 'Escape' && closeReportPanel()}
      >
        <button
          class="absolute inset-0 cursor-pointer"
          onclick={closeReportPanel}
          aria-label="Close dialog"
        ></button>
        <div
          class="relative z-10 w-full max-w-md max-h-[90vh] flex flex-col bg-[#0C212F] rounded-xl shadow-2xl border border-white/10 overflow-hidden"
          onclick={(e) => e.stopPropagation()}
          role="document"
        >
          <button
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
              <p class="text-white/70 text-xs mt-0.5">{lguBarangayInfo.name}, {lguMunicipalityName || 'Minglanilla'}</p>
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
              <label for="report-title" class="block text-white/60 text-[10px] mb-1">Title <span class="text-amber-400">*</span></label>
              <input
                id="report-title"
                type="text"
                bind:value={reportTitle}
                placeholder="e.g. Flooding at Delima Drive"
                class="w-full rounded-lg bg-white/10 text-white text-xs px-3 py-2 border border-white/20 placeholder-white/40 focus:border-white/40 focus:outline-none"
              />
            </div>
            <div>
              <label for="report-desc" class="block text-white/60 text-[10px] mb-1">Description <span class="text-amber-400">*</span></label>
              <div class="rounded-lg border border-white/20 bg-white/5 overflow-hidden">
                <textarea
                  id="report-desc"
                  bind:value={reportDescription}
                  placeholder="Describe the situation in detail..."
                  rows="4"
                  class="w-full bg-transparent text-white text-xs px-3 py-2 placeholder-white/40 focus:outline-none resize-none border-none"
                ></textarea>
                <div class="px-3 pb-3 pt-0 flex flex-wrap items-center gap-2 border-t border-white/10">
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
                    class="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 transition"
                    aria-label="Add photos"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </button>
                  <button
                    type="button"
                    onclick={() => document.getElementById('report-videos')?.click()}
                    class="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 transition"
                    aria-label="Add videos"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
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
              {#if reportMediaError}
                <p class="text-amber-400 text-[10px] mt-1">{reportMediaError}</p>
              {/if}
            </div>
            <div class="flex gap-2 pt-2">
              <button
                onclick={closeReportPanel}
                class="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onclick={submitReport}
                disabled={isSubmittingReport || latitude == null || longitude == null || reportTitle.trim().length < 2 || reportDescription.trim().length < 5}
                class="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition cursor-pointer"
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

    {#if hazardPanelOpen}
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

    {#if legendOpen}
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
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2">
                <img src="https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png" alt="" class="w-4 h-6 object-contain" />
                <span class="text-white/80">Your location / Search result</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-4 h-4 rounded-full bg-red-600 border-2 border-white shrink-0" style="box-shadow: 0 1px 3px rgba(0,0,0,0.3)"></span>
                <span class="text-white/80">Hazard / Disaster report</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if selectedReport}
      {@const canInteract = signedInUserId && signedInUserId !== selectedReport.reporterId}
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
          class="relative z-10 w-full max-w-md max-h-[90vh] flex flex-col bg-[#0C212F] rounded-xl shadow-2xl border border-white/10 overflow-hidden"
          onclick={(e) => e.stopPropagation()}
          role="document"
        >
          <button
            onclick={closeReportDetail}
            class="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition cursor-pointer"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
            <div class="relative min-h-[120px] overflow-hidden">
              <div
                class="absolute inset-0 bg-cover bg-center"
                style={selectedReport.profileImageUrl
                  ? `background-image: url('${selectedReport.profileImageUrl}'); filter: brightness(0.75);`
                  : 'background-image: linear-gradient(135deg, #1B2E3A 0%, #0C212F 100%); filter: brightness(0.75);'}
              ></div>
            <div class="absolute inset-0 bg-gradient-to-t from-[#0C212F] via-[#0C212F]/80 to-transparent"></div>
            <div class="relative p-4 pt-12">
              <h2 id="report-detail-title" class="text-white font-semibold text-base">{selectedReport.title ?? 'Report'}</h2>
              <p class="text-white/70 text-xs mt-0.5">{selectedReport.barangayName}, {selectedReport.municipalityName}</p>
              <span class="text-white/50 text-[10px]">{new Date(selectedReport.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <div class="p-4 overflow-y-auto flex-1 space-y-4 scrollbar-hide">
            <div class="flex items-center gap-2">
              {#if selectedReport.publisherAvatarUrl}
                <img src={selectedReport.publisherAvatarUrl} alt="" class="w-9 h-9 rounded-full border-2 border-white/30 object-cover shrink-0" />
              {:else}
                <div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                  {selectedReport.publisherName.charAt(0).toUpperCase()}
                </div>
              {/if}
              <span class="text-white/90 text-xs font-medium">{selectedReport.publisherName}</span>
            </div>
            {#if selectedReport.description}
              <p class="text-white/80 text-sm leading-relaxed">{selectedReport.description}</p>
            {/if}
            {#if selectedReport.photoUrls.length > 0 || selectedReport.videoUrls.length > 0}
              <div class="space-y-2">
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
                  <div class="space-y-2">
                    {#each selectedReport.videoUrls as url}
                      <video src={url} controls class="w-full max-h-40 rounded-lg border border-white/10" preload="metadata" aria-label="Report video"><track kind="captions" src="" srclang="en" label="No captions" /></video>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            <div class="flex items-center gap-4 pt-2 border-t border-white/10">
              {#if !signedInUserId}
                <p class="text-white/50 text-xs">Sign up to upvote or comment.</p>
              {:else if !canInteract}
                <p class="text-white/50 text-xs">You can't upvote or comment your own report.</p>
              {:else}
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-white/70 hover:text-white/90 transition text-xs"
                  aria-label="Upvote"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                  <span>Upvote</span>
                </button>
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-white/70 hover:text-white/90 transition text-xs"
                  aria-label="Comment"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                  <span>Comment</span>
                </button>
              {/if}
            </div>
            {#if canInteract}
              <div class="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                <p class="text-white/40 text-[11px]">Add a comment… (coming soon)</p>
              </div>
            {/if}
            <button
              type="button"
              class="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/90 text-xs font-medium transition border border-white/10"
            >
              Show local feed report
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if locationError}
      <div class="absolute top-16 left-1/2 -translate-x-1/2 z-[1001] bg-red-600/90 text-white text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-[90vw] md:max-w-xs text-center backdrop-blur-sm flex items-center gap-2">
        <span class="flex-1">{locationError}</span>
        <button onclick={() => (locationError = '')} class="font-bold hover:text-red-200 cursor-pointer shrink-0 touch-manipulation">✕</button>
      </div>
    {/if}
    {#if locationSuccess}
      <div class="absolute top-16 left-1/2 -translate-x-1/2 z-[1001] bg-emerald-600/90 text-white text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-[90vw] md:max-w-xs text-center backdrop-blur-sm flex items-center gap-2">
        <span class="flex-1">{locationSuccess}</span>
        <button onclick={() => (locationSuccess = '')} class="font-bold hover:text-emerald-200 cursor-pointer shrink-0 touch-manipulation">✕</button>
      </div>
    {/if}

    {#if mode !== 'lgu' && latitude !== null && longitude !== null}
      <div class="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-[#0C212F]/80 text-white/80 text-[10px] md:text-xs rounded-lg px-3 py-2 shadow-md backdrop-blur-sm font-mono">
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </div>
    {/if}
  </div>
</div>
