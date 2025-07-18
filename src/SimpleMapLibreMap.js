import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

const SimpleMapLibreMap = forwardRef(({
  onMapLoad,
  onDrawStop,
  center = [0, 10],
  zoom = 1
}, ref) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const draw = useRef(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(null);

  // Expose map methods to parent component
  useImperativeHandle(ref, () => ({
    getMap: () => map.current,
    getDraw: () => draw.current,
    clearVisualization: () => {
      console.log('Clear visualization called');
      if (map.current) {
        // Clear vertex markers
        clearVertexMarkers();
        
        // Clear visualization source
        if (map.current.getSource('visualization')) {
          map.current.getSource('visualization').setData({ type: 'FeatureCollection', features: [] });
        }
        
        // Clear winding warnings
        if (map.current.getSource('winding-warnings')) {
          map.current.getSource('winding-warnings').setData({ type: 'FeatureCollection', features: [] });
        }
      }
    },
    clearDrawing: () => {
      console.log('Clear drawing called');
      if (draw.current) {
        draw.current.deleteAll();
      }
    },
    visualizeGeometry: (geojson) => {
      console.log('Visualize geometry called with:', geojson);
      if (!map.current || !isMapLoaded) {
        console.log('Map not ready for visualization');
        return;
      }

      try {
        // Clear previous vertex markers
        clearVertexMarkers();
        
        // Add source and layers for visualization if they don't exist
        if (!map.current.getSource('visualization')) {
          map.current.addSource('visualization', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });

          // Add fill layer for polygons
          map.current.addLayer({
            id: 'visualization-fill',
            type: 'fill',
            source: 'visualization',
            paint: {
              'fill-color': '#0080ff',
              'fill-opacity': 0.3
            },
            filter: ['==', '$type', 'Polygon']
          });

          // Add stroke layer for all geometries
          map.current.addLayer({
            id: 'visualization-stroke',
            type: 'line',
            source: 'visualization',
            paint: {
              'line-color': '#0080ff',
              'line-width': 2
            },
            filter: ['in', '$type', 'Polygon', 'LineString']
          });

          // Add points layer
          map.current.addLayer({
            id: 'visualization-points',
            type: 'circle',
            source: 'visualization',
            paint: {
              'circle-color': '#0080ff',
              'circle-radius': 5,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
          });
        }

        // Add winding order visualization layers if they don't exist
        if (!map.current.getSource('winding-warnings')) {
          map.current.addSource('winding-warnings', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });

          // Yellow fill for incorrect winding order
          map.current.addLayer({
            id: 'winding-warnings-fill',
            type: 'fill',
            source: 'winding-warnings',
            paint: {
              'fill-color': '#ffff00',
              'fill-opacity': 0.4
            }
          });

          // Yellow stroke for incorrect winding order
          map.current.addLayer({
            id: 'winding-warnings-stroke',
            type: 'line',
            source: 'winding-warnings',
            paint: {
              'line-color': '#ffff00',
              'line-width': 3
            }
          });
        }

        // Prepare feature collection
        let featureCollection;
        if (geojson.type === 'Feature') {
          featureCollection = { type: 'FeatureCollection', features: [geojson] };
        } else if (geojson.type === 'FeatureCollection') {
          featureCollection = geojson;
        } else {
          // Direct geometry object
          featureCollection = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: geojson, properties: {} }]
          };
        }

        // Update the source data
        map.current.getSource('visualization').setData(featureCollection);

        // Add vertex markers
        addVertexMarkers(featureCollection);

        // Calculate bounding box and fit the map
        if (featureCollection.features.length > 0) {
          const coordinates = [];
          
          function extractCoordinates(geometry) {
            if (geometry.type === 'Point') {
              coordinates.push(geometry.coordinates);
            } else if (geometry.type === 'LineString') {
              coordinates.push(...geometry.coordinates);
            } else if (geometry.type === 'Polygon') {
              coordinates.push(...geometry.coordinates[0]);
            } else if (geometry.type === 'MultiPoint') {
              coordinates.push(...geometry.coordinates);
            } else if (geometry.type === 'MultiLineString') {
              geometry.coordinates.forEach(line => coordinates.push(...line));
            } else if (geometry.type === 'MultiPolygon') {
              geometry.coordinates.forEach(polygon => coordinates.push(...polygon[0]));
            } else if (geometry.type === 'GeometryCollection') {
              geometry.geometries.forEach(extractCoordinates);
            }
          }

          featureCollection.features.forEach(feature => {
            if (feature.geometry) {
              extractCoordinates(feature.geometry);
            }
          });

          if (coordinates.length > 0) {
            const bounds = coordinates.reduce((bounds, coord) => {
              return bounds.extend(coord);
            }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

            map.current.fitBounds(bounds, { padding: 50 });
          }
        }

        console.log('Geometry visualization added successfully');
      } catch (error) {
        console.error('Error visualizing geometry:', error);
      }
    },
    visualizeWindingOrderWarnings: (warningFeatures) => {
      console.log('Visualizing winding order warnings:', warningFeatures);
      if (!map.current || !isMapLoaded) {
        console.log('Map not ready for winding order visualization');
        return;
      }

      try {
        if (map.current.getSource('winding-warnings')) {
          map.current.getSource('winding-warnings').setData({
            type: 'FeatureCollection',
            features: warningFeatures || []
          });
        }
      } catch (error) {
        console.error('Error visualizing winding order warnings:', error);
      }
    }
  }), [isMapLoaded]); // Add isMapLoaded as dependency

  // Store vertex markers for cleanup
  const vertexMarkers = useRef([]);

  // Function to clear vertex markers
  const clearVertexMarkers = () => {
    vertexMarkers.current.forEach(marker => marker.remove());
    vertexMarkers.current = [];
  };

  // Function to add vertex markers with numbered labels
  const addVertexMarkers = (featureCollection) => {
    featureCollection.features.forEach(feature => {
      if (feature.geometry) {
        addVerticesForGeometry(feature.geometry);
      }
    });
  };

  // Function to add vertices for a specific geometry
  const addVerticesForGeometry = (geometry) => {
    if (geometry.type === 'Polygon') {
      // Red markers for exterior ring
      geometry.coordinates[0].forEach((coord, index) => {
        if (index < geometry.coordinates[0].length - 1) { // Skip last coordinate (same as first)
          addVertexMarker(coord, index, 'red');
        }
      });
      
      // Orange markers for holes
      for (let i = 1; i < geometry.coordinates.length; i++) {
        geometry.coordinates[i].forEach((coord, index) => {
          if (index < geometry.coordinates[i].length - 1) { // Skip last coordinate (same as first)
            addVertexMarker(coord, index, 'orange');
          }
        });
      }
    } else if (geometry.type === 'LineString') {
      // Blue markers for line vertices
      geometry.coordinates.forEach((coord, index) => {
        addVertexMarker(coord, index, 'blue');
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach(polygon => {
        addVerticesForGeometry({ type: 'Polygon', coordinates: polygon });
      });
    } else if (geometry.type === 'MultiLineString') {
      geometry.coordinates.forEach(line => {
        addVerticesForGeometry({ type: 'LineString', coordinates: line });
      });
    } else if (geometry.type === 'GeometryCollection') {
      geometry.geometries.forEach(geom => {
        addVerticesForGeometry(geom);
      });
    }
  };

  // Function to add a single vertex marker
  const addVertexMarker = (coord, index, color) => {
    // Create a DOM element for the marker
    const el = document.createElement('div');
    el.className = 'vertex-marker';
    el.style.cssText = `
      background-color: ${color};
      color: white;
      border: 2px solid white;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      font-family: Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      line-height: 1;
      text-align: center;
      user-select: none;
      pointer-events: auto;
    `;
    el.textContent = index.toString();

    // Add click handler
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log(`Vertex ${index} clicked at [${coord[0]}, ${coord[1]}]`);
    });

    // Create and add marker
    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'center'
    })
      .setLngLat(coord)
      .addTo(map.current);

    vertexMarkers.current.push(marker);
  };

  useEffect(() => {
    if (map.current) return; // Initialize map only once

    console.log('Initializing MapLibre map...');
    console.log('MapLibre GL version:', maplibregl.version);
    console.log('Container element:', mapContainer.current);

    // Check if the container exists
    if (!mapContainer.current) {
      console.error('Map container not found');
      setMapError('Map container not found');
      return;
    }

    try {
      // Create a simple map style using OpenStreetMap tiles with globe support
      const mapStyle = {
        version: 8,
        name: 'OpenStreetMap Globe',
        projection: {
          type: 'globe'
        },
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ],
        fog: {
          'range': [0.8, 8],
          'color': '#ffffff',
          'horizon-blend': 0.5
        }
      };

      console.log('Creating map with style:', mapStyle);

      // Create map with globe projection from the start
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: mapStyle,
        center: center,
        zoom: zoom,
        projection: 'globe', // Set globe projection during initialization
        attributionControl: true,
        hash: false,
        transformRequest: (url, resourceType) => {
          console.log('Loading resource:', url, resourceType);
          return { url };
        }
      });

      console.log('Map instance created:', map.current);

      // Add navigation control
      map.current.addControl(new maplibregl.NavigationControl(), 'top-left');

      // Initialize drawing tools
      draw.current = new MapboxDraw({
        displayControlsDefault: false,
        controls: {
          polygon: true,
          line_string: true,
          point: true,
          trash: true
        },
        defaultMode: 'simple_select',
        styles: [
          // Style for drawing lines and polygons
          {
            'id': 'gl-draw-line',
            'type': 'line',
            'filter': ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
            'layout': {
              'line-cap': 'round',
              'line-join': 'round'
            },
            'paint': {
              'line-color': '#D20C0C',
              'line-dasharray': [0.2, 2],
              'line-width': 2
            }
          },
          // Style for drawing polygon fills
          {
            'id': 'gl-draw-polygon-fill',
            'type': 'fill',
            'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            'paint': {
              'fill-color': '#D20C0C',
              'fill-outline-color': '#D20C0C',
              'fill-opacity': 0.1
            }
          },
          // Style for drawing polygon strokes
          {
            'id': 'gl-draw-polygon-stroke-active',
            'type': 'line',
            'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            'layout': {
              'line-cap': 'round',
              'line-join': 'round'
            },
            'paint': {
              'line-color': '#D20C0C',
              'line-dasharray': [0.2, 2],
              'line-width': 2
            }
          },
          // Style for drawing points
          {
            'id': 'gl-draw-point',
            'type': 'circle',
            'filter': ['all', ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
            'paint': {
              'circle-radius': 5,
              'circle-color': '#D20C0C'
            }
          }
        ]
      });
      
      map.current.addControl(draw.current, 'top-right');

      // Add draw event handlers
      map.current.on('draw.create', (e) => {
        console.log('Draw create event:', e);
        console.log('Created features:', e.features);
        if (onDrawStop) {
          setTimeout(() => onDrawStop(), 100); // Small delay to ensure draw is complete
        }
      });

      map.current.on('draw.update', (e) => {
        console.log('Draw update event:', e);
        console.log('Updated features:', e.features);
        if (onDrawStop) {
          setTimeout(() => onDrawStop(), 100);
        }
      });

      map.current.on('draw.delete', (e) => {
        console.log('Draw delete event:', e);
        console.log('Deleted features:', e.features);
        if (onDrawStop) {
          setTimeout(() => onDrawStop(), 100);
        }
      });

      // Add mode change handler for debugging
      map.current.on('draw.modechange', (e) => {
        console.log('Draw mode changed to:', e.mode);
      });

      // Add selection change handler
      map.current.on('draw.selectionchange', (e) => {
        console.log('Draw selection changed:', e.features);
      });

      // Add load event handler
      map.current.on('load', () => {
        console.log('Map loaded successfully with globe projection');
        setIsMapLoaded(true);
        setMapError(null);
        
        if (onMapLoad) {
          onMapLoad(map.current);
        }
      });

      // Add error event handler
      map.current.on('error', (e) => {
        console.error('Map error:', e);
        setMapError(e.error?.message || 'Map failed to load');
      });

      // Add sourcedata event to debug tile loading
      map.current.on('sourcedata', (e) => {
        if (e.isSourceLoaded) {
          console.log('Source loaded:', e.sourceId);
        }
      });

      // Add idle event
      map.current.on('idle', () => {
        console.log('Map is idle');
      });

    } catch (error) {
      console.error('Error initializing map:', error);
      setMapError(error.message);
    }

    return () => {
      if (map.current) {
        console.log('Cleaning up map');
        map.current.remove();
        map.current = null;
      }
    };
  }, []); // Empty dependency array - initialize only once

  return (
    <div style={{ position: 'relative', width: '100%', height: '50vh', minHeight: '400px' }}>
      <style>{`
        .mapbox-gl-draw_ctrl-draw-btn {
          background-color: #fff !important;
          border: 1px solid #ccc !important;
          border-radius: 2px !important;
          cursor: pointer !important;
          display: block !important;
          float: left !important;
          height: 29px !important;
          width: 29px !important;
          background-repeat: no-repeat !important;
          background-position: center !important;
          pointer-events: auto !important;
        }
        
        .mapbox-gl-draw_ctrl-draw-btn:hover {
          background-color: #f8f8f8 !important;
        }
        
        .mapbox-gl-draw_ctrl-draw-btn.active {
          background-color: #4264fb !important;
        }
        
        .maplibregl-ctrl-group {
          background: #fff !important;
          border-radius: 4px !important;
          box-shadow: 0 0 0 2px rgba(0,0,0,.1) !important;
        }
        
        .vertex-marker {
          z-index: 1000 !important;
        }
      `}</style>
      <div
        ref={mapContainer}
        style={{
          width: '100%',
          height: '100%',
          border: '1px solid #ccc'
        }}
      />
      {mapError && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(255, 0, 0, 0.8)',
          color: 'white',
          padding: '10px',
          borderRadius: '4px',
          zIndex: 1000
        }}>
          Map Error: {mapError}
        </div>
      )}
      {!isMapLoaded && !mapError && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '10px',
          borderRadius: '4px',
          zIndex: 1000
        }}>
          Loading map...
        </div>
      )}
    </div>
  );
});

SimpleMapLibreMap.displayName = 'SimpleMapLibreMap';

export default SimpleMapLibreMap;
