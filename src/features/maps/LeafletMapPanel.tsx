import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LatLng = {
  lat: number;
  lng: number;
};

type Destination = LatLng & {
  label?: string;
};

type LeafletMapPanelProps = {
  currentLocation: LatLng | null;
};

const makeMarkerIcon = (color: string) => `
  <div style="width:16px;height:16px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 0 16px ${color};"></div>
`;

const LeafletMapPanel: React.FC<LeafletMapPanelProps> = ({ currentLocation }) => {
  const mapRef = useRef<any>(null);
  const currentMarkerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    let cancelled = false;

    const init = () => {
      if (!containerRef.current) {
        setStatus('fallback');
        return;
      }

      try {
        if (!mapRef.current) {
          const center: [number, number] = currentLocation
            ? [currentLocation.lat, currentLocation.lng]
            : [28.6139, 77.2090];

          mapRef.current = L.map(containerRef.current, {
            zoomControl: true,
            attributionControl: true,
          }).setView(center, currentLocation ? 15 : 12);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
          }).addTo(mapRef.current);
        }

        setStatus('ready');
        window.setTimeout(() => mapRef.current?.invalidateSize?.(), 50);
      } catch {
        setStatus('fallback');
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [currentLocation]);

  useEffect(() => {
    if (!mapRef.current || status !== 'ready') return;

    if (currentLocation) {
      const currentIcon = L.divIcon({
        className: '',
        html: makeMarkerIcon('#06b6d4'),
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      if (!currentMarkerRef.current) {
        currentMarkerRef.current = L.marker([currentLocation.lat, currentLocation.lng], { icon: currentIcon }).addTo(mapRef.current);
      } else {
        currentMarkerRef.current.setLatLng([currentLocation.lat, currentLocation.lng]);
        currentMarkerRef.current.setIcon(currentIcon);
      }
      mapRef.current.setView([currentLocation.lat, currentLocation.lng], 15);
    } else if (currentMarkerRef.current) {
      currentMarkerRef.current.remove();
      currentMarkerRef.current = null;
    }
  }, [currentLocation, status]);

  return (
    <div className="relative w-full h-72 rounded-2xl overflow-hidden border border-white/10 bg-gray-900">
      {status === 'fallback' ? (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white p-4">
          <div className="text-sm font-semibold text-cyan-300">Live Map</div>
          <p className="text-xs text-white/70 mt-1">
            Interactive map failed to load. Check your internet connection.
          </p>
          <div className="mt-4 text-sm text-white/90 font-mono space-y-1">
            <div>Current: {currentLocation ? `${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)}` : 'Not available'}</div>
          </div>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="absolute inset-0" />
        </>
      )}
    </div>
  );
};

export default LeafletMapPanel;