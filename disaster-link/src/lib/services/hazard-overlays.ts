/**
 * Hazard Overlay Service
 * ──────────────────────
 * Reusable functions for loading PhilGIS / NAMRIA GeoJSON hazard data
 * and rendering color-coded overlays on a Leaflet map.
 *
 * Supports three hazard types: flood, landslide, storm surge.
 * Each feature's "risk_level" property controls fill opacity so
 * high-risk zones appear darkest and low-risk zones appear lightest.
 */

import type L from 'leaflet';

/* ── Public types ── */

export type HazardType = 'flood' | 'landslide' | 'storm-surge';
export type RiskLevel = 'high' | 'moderate' | 'low';

export interface HazardLayerConfig {
  type: HazardType;
  label: string;
  geojsonPath: string;
  color: string;
  fillOpacity: Record<RiskLevel, number>;
}

/* ── Layer configuration (one entry per hazard type) ── */

export const HAZARD_LAYERS: HazardLayerConfig[] = [
  {
    type: 'flood',
    label: 'Flood Hazard',
    geojsonPath: '/geojson/flood-hazard.geojson',
    color: '#2563eb',
    fillOpacity: { high: 0.55, moderate: 0.35, low: 0.18 }
  },
  {
    type: 'landslide',
    label: 'Landslide Hazard',
    geojsonPath: '/geojson/landslide-hazard.geojson',
    color: '#ea580c',
    fillOpacity: { high: 0.55, moderate: 0.35, low: 0.18 }
  },
  {
    type: 'storm-surge',
    label: 'Storm Surge',
    geojsonPath: '/geojson/storm-surge-hazard.geojson',
    color: '#7c3aed',
    fillOpacity: { high: 0.55, moderate: 0.35, low: 0.18 }
  }
];

/* ── Internal cache so repeated toggles don't re-fetch ── */

const cache = new Map<string, GeoJSON.FeatureCollection>();

/* ── Fetch and cache a GeoJSON file ── */

export async function loadHazardGeoJSON(
  path: string
): Promise<GeoJSON.FeatureCollection> {
  const cached = cache.get(path);
  if (cached) return cached;

  const res = await fetch(path);

  if (!res.ok) {
    throw new Error(`Failed to load hazard data from ${path} (${res.status})`);
  }

  const data: GeoJSON.FeatureCollection = await res.json();
  cache.set(path, data);
  return data;
}

/* ── Create a styled Leaflet GeoJSON layer from hazard data ── */

export function createHazardLayer(
  leafletLib: typeof L,
  geojsonData: GeoJSON.FeatureCollection,
  config: HazardLayerConfig
): L.GeoJSON {
  return leafletLib.geoJSON(geojsonData, {
    /* Style each polygon — supports risk_level, RISK, GEN, Var (NOAH), etc. */
    style: (feature) => {
      const p = feature?.properties ?? {};
      let risk = (p.risk_level ?? p.risk ?? p.RISK ?? p.GEN ?? p.descript) as string | number | undefined;
      if (risk == null && typeof p.Var === 'number') {
        risk = p.Var >= 1.5 ? 'high' : p.Var >= 0.5 ? 'moderate' : 'low';
      }
      const str = String(risk ?? '').toLowerCase();
      const valid: RiskLevel =
        str.includes('high') ? 'high'
          : str.includes('mod') || str.includes('med') ? 'moderate'
            : 'low';

      return {
        fillColor: config.color,
        fillOpacity: config.fillOpacity[valid] ?? 0.2,
        color: config.color,
        weight: 1.5,
        opacity: 0.7
      };
    },

    /* Attach a popup — supports name, NAME, GEN, descript, etc. */
    onEachFeature: (feature, layer) => {
      const p = feature.properties ?? {};
      const name = p.name ?? p.NAME ?? p.GEN ?? p.Label ?? p.label ?? 'Unnamed Zone';
      const risk: string = String(p.risk_level ?? p.RISK ?? p.risk ?? p.GEN ?? p.descript ?? 'unknown');
      const desc: string = String(p.description ?? p.DESCRIPTION ?? p.desc ?? '');

      const html =
        `<div style="font-size:13px;line-height:1.5">` +
        `<strong>${config.label}</strong><br/>` +
        `<span style="color:${config.color};font-weight:600;text-transform:capitalize">${risk} Risk</span><br/>` +
        `${name}` +
        (desc ? `<br/><span style="color:#666">${desc}</span>` : '') +
        `</div>`;

      layer.bindPopup(html);
    }
  });
}
