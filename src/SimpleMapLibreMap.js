import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { transformGeoJSONToGreatCircle } from './greatcircle';
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
  const [layersInitialized, setLayersInitialized] = useState(false);

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
        
        // Clear drawing great circles
        clearDrawingGreatCircles();
        
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
      // Also clear drawing great circles
      clearDrawingGreatCircles();
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
        
        // Add source and layers for great circle visualization if they don't exist
        if (!map.current.getSource('visualization')) {
          map.current.addSource('visualization', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });

          // Add great circle fill layer for polygons
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

          // Add great circle stroke layer - this shows the curved lines
          map.current.addLayer({
            id: 'visualization-stroke',
            type: 'line',
            source: 'visualization',
            paint: {
              'line-color': '#0080ff',
              'line-width': 3
            },
            filter: ['in', '$type', 'Polygon', 'LineString']
          });

          // Add great circle points layer
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

        // Transform geometry to great circle arcs and use as primary visualization
        const greatCircleCollection = transformGeoJSONToGreatCircle(featureCollection);
        map.current.getSource('visualization').setData(greatCircleCollection);

        // Add vertex markers (use original coordinates, not great circle interpolated ones)
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
  }), [isMapLoaded, layersInitialized]); // Include both loading states as dependencies

  // Store vertex markers for cleanup
  const vertexMarkers = useRef([]);
  
  // Track drawing update state to prevent conflicts
  const drawingUpdateInProgress = useRef(false);

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

  // Functions for drawing great circle visualization - memoized to prevent stale closures
  const clearDrawingGreatCircles = useCallback(() => {
    try {
      if (map.current && map.current.getSource && map.current.getSource('drawing-great-circle')) {
        map.current.getSource('drawing-great-circle').setData({ type: 'FeatureCollection', features: [] });
      }
    } catch (error) {
      console.error('Error clearing drawing great circles:', error);
    }
  }, []);

  const updateDrawingGreatCircles = useCallback(() => {
    // Prevent concurrent updates
    if (drawingUpdateInProgress.current) {
      console.log('updateDrawingGreatCircles: Update already in progress, skipping');
      return;
    }
    
    if (!draw.current || !map.current || !isMapLoaded || !layersInitialized) {
      console.log('updateDrawingGreatCircles: Not ready - draw:', !!draw.current, 'map:', !!map.current, 'loaded:', isMapLoaded, 'layers:', layersInitialized);
      return;
    }
    
    drawingUpdateInProgress.current = true;
    
    try {
      const data = draw.current.getAll();
      console.log('updateDrawingGreatCircles: Draw data:', data);
      
      if (data.features.length > 0) {
        // Filter out incomplete geometries and validate coordinates
        const validFeatures = data.features.filter(feature => {
          if (!feature.geometry || !feature.geometry.coordinates) return false;
          
          // Check if geometry has valid coordinates
          if (feature.geometry.type === 'Polygon') {
            // For polygons, we need at least 4 points (including closing point) to form a valid polygon
            return feature.geometry.coordinates.length > 0 && 
                   feature.geometry.coordinates[0].length >= 4;
          } else if (feature.geometry.type === 'LineString') {
            return feature.geometry.coordinates.length >= 2; // At least 2 points for a line
          } else if (feature.geometry.type === 'Point') {
            return feature.geometry.coordinates.length === 2; // Valid point coordinates
          }
          
          return true;
        });

        // Also include incomplete polygons if they have at least 2 points for preview
        const previewFeatures = data.features.filter(feature => {
          if (!feature.geometry || !feature.geometry.coordinates) return false;
          
          if (feature.geometry.type === 'Polygon') {
            // For preview, show even incomplete polygons with 2+ points as LineString
            if (feature.geometry.coordinates.length > 0 && 
                feature.geometry.coordinates[0].length >= 2 &&
                feature.geometry.coordinates[0].length < 4) {
              // Convert incomplete polygon to LineString for preview
              return true;
            }
          }
          
          return false;
        });

        console.log('updateDrawingGreatCircles: Valid features:', validFeatures.length, 'Preview features:', previewFeatures.length);

        const allFeaturesToShow = [...validFeatures];
        
        // Convert incomplete polygons to LineString for preview
        previewFeatures.forEach(feature => {
          if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates[0].length < 4) {
            allFeaturesToShow.push({
              ...feature,
              geometry: {
                type: 'LineString',
                coordinates: feature.geometry.coordinates[0]
              }
            });
          }
        });

        if (allFeaturesToShow.length > 0) {
          const validData = {
            type: 'FeatureCollection',
            features: allFeaturesToShow
          };
          
          // Transform drawing data to great circle and show it
          const greatCircleData = transformGeoJSONToGreatCircle(validData);
          console.log('updateDrawingGreatCircles: Great circle data:', greatCircleData);
          
          // Update the pre-created drawing great circle source
          if (map.current.getSource('drawing-great-circle')) {
            map.current.getSource('drawing-great-circle').setData(greatCircleData);
            console.log('updateDrawingGreatCircles: Updated great circle visualization');
          } else {
            console.warn('updateDrawingGreatCircles: drawing-great-circle source not found');
          }
        } else {
          console.log('updateDrawingGreatCircles: No valid or preview features, clearing');
          clearDrawingGreatCircles();
        }
      } else {
        console.log('updateDrawingGreatCircles: No features, clearing');
        clearDrawingGreatCircles();
      }
    } catch (error) {
      console.error('Error updating drawing great circles:', error);
      // Don't show error to user for drawing updates, just clear the preview
      clearDrawingGreatCircles();
    } finally {
      // Always reset the lock
      drawingUpdateInProgress.current = false;
    }
  }, [isMapLoaded, layersInitialized, clearDrawingGreatCircles]);

  // Initialize drawing great circle layers - moved to separate effect with proper dependencies
  useEffect(() => {
    if (!map.current || !isMapLoaded || layersInitialized) {
      return;
    }

    console.log('Initializing drawing great circle layers');
    
    const initializeLayers = () => {
      if (map.current && !map.current.getSource('drawing-great-circle')) {
        try {
          map.current.addSource('drawing-great-circle', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });
          
          // Add drawing great circle stroke layer (brighter and thicker than main visualization)
          map.current.addLayer({
            id: 'drawing-great-circle-stroke',
            type: 'line',
            source: 'drawing-great-circle',
            paint: {
              'line-color': '#0080ff',
              'line-width': 4, // Thicker for drawing feedback
              'line-opacity': 1 // Full opacity
            },
            filter: ['in', '$type', 'Polygon', 'LineString']
          });
          
          // Add drawing great circle fill layer
          map.current.addLayer({
            id: 'drawing-great-circle-fill',
            type: 'fill',
            source: 'drawing-great-circle',
            paint: {
              'fill-color': '#0080ff',
              'fill-opacity': 0.3
            },
            filter: ['==', '$type', 'Polygon']
          });
          
          setLayersInitialized(true);
          console.log('Drawing great circle layers initialized successfully');
        } catch (error) {
          console.error('Error initializing drawing great circle layers:', error);
        }
      }
    };

    // Initialize immediately if map is ready, otherwise wait a bit
    if (map.current.isStyleLoaded && map.current.isStyleLoaded()) {
      initializeLayers();
    } else {
      setTimeout(initializeLayers, 100);
    }
  }, [isMapLoaded, layersInitialized]);

  // Handle draw event listeners - separate effect to update when handlers change
  useEffect(() => {
    if (!map.current || !draw.current || !layersInitialized) {
      return;
    }

    console.log('Setting up draw event handlers');

    // Create throttled update function to prevent excessive updates
    let renderUpdateTimeout = null;
    const throttledUpdate = () => {
      if (renderUpdateTimeout) {
        clearTimeout(renderUpdateTimeout);
      }
      renderUpdateTimeout = setTimeout(() => {
        updateDrawingGreatCircles();
        renderUpdateTimeout = null;
      }, 25);
    };

    let mouseMoveTimeout = null;
    let lastUpdateTime = 0;
    const throttledMouseUpdate = () => {
      if (draw.current) {
        const mode = draw.current.getMode();
        if (mode !== 'simple_select' && mode !== 'direct_select') {
          const now = Date.now();
          if (now - lastUpdateTime > 100) {
            lastUpdateTime = now;
            
            if (mouseMoveTimeout) {
              clearTimeout(mouseMoveTimeout);
            }
            
            mouseMoveTimeout = setTimeout(() => {
              updateDrawingGreatCircles();
              mouseMoveTimeout = null;
            }, 50);
          }
        }
      }
    };

    const handleCreate = (e) => {
      console.log('Draw create event:', e);
      clearDrawingGreatCircles();
      if (onDrawStop) {
        setTimeout(() => onDrawStop(), 150);
      }
    };

    const handleUpdate = (e) => {
      console.log('Draw update event:', e);
      setTimeout(() => updateDrawingGreatCircles(), 10);
      if (onDrawStop) {
        setTimeout(() => onDrawStop(), 150);
      }
    };

    const handleDelete = (e) => {
      console.log('Draw delete event:', e);
      clearDrawingGreatCircles();
      if (onDrawStop) {
        setTimeout(() => onDrawStop(), 150);
      }
    };

    const handleModeChange = (e) => {
      console.log('Draw mode changed to:', e.mode);
      if (e.mode === 'simple_select') {
        clearDrawingGreatCircles();
      } else {
        setTimeout(() => updateDrawingGreatCircles(), 100);
      }
    };

    const handleSelectionChange = (e) => {
      console.log('Draw selection changed:', e.features);
      setTimeout(() => updateDrawingGreatCircles(), 30);
    };

    const handleClick = () => {
      if (draw.current) {
        const mode = draw.current.getMode();
        if (mode !== 'simple_select' && mode !== 'direct_select') {
          setTimeout(() => updateDrawingGreatCircles(), 50);
        }
      }
    };

    // Add event listeners
    map.current.on('draw.create', handleCreate);
    map.current.on('draw.update', handleUpdate);
    map.current.on('draw.delete', handleDelete);
    map.current.on('draw.modechange', handleModeChange);
    map.current.on('draw.selectionchange', handleSelectionChange);
    map.current.on('draw.render', throttledUpdate);
    map.current.on('click', handleClick);
    map.current.on('mousemove', throttledMouseUpdate);

    // Cleanup function
    return () => {
      if (map.current) {
        map.current.off('draw.create', handleCreate);
        map.current.off('draw.update', handleUpdate);
        map.current.off('draw.delete', handleDelete);
        map.current.off('draw.modechange', handleModeChange);
        map.current.off('draw.selectionchange', handleSelectionChange);
        map.current.off('draw.render', throttledUpdate);
        map.current.off('click', handleClick);
        map.current.off('mousemove', throttledMouseUpdate);
      }
      
      // Clear timeouts
      if (renderUpdateTimeout) {
        clearTimeout(renderUpdateTimeout);
      }
      if (mouseMoveTimeout) {
        clearTimeout(mouseMoveTimeout);
      }
    };
  }, [layersInitialized, updateDrawingGreatCircles, clearDrawingGreatCircles, onDrawStop]);

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

      // Initialize drawing tools with invisible drawing styles - only show great circle preview
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
          // Make drawing lines completely invisible - only show great circle arcs
          {
            'id': 'gl-draw-line',
            'type': 'line',
            'filter': ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
            'layout': {
              'line-cap': 'round',
              'line-join': 'round'
            },
            'paint': {
              'line-color': 'transparent',
              'line-width': 0,
              'line-opacity': 0
            }
          },
          // Make drawing polygon fills completely invisible
          {
            'id': 'gl-draw-polygon-fill',
            'type': 'fill',
            'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            'paint': {
              'fill-color': 'transparent',
              'fill-opacity': 0
            }
          },
          // Make drawing polygon strokes completely invisible
          {
            'id': 'gl-draw-polygon-stroke-active',
            'type': 'line',
            'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            'layout': {
              'line-cap': 'round',
              'line-join': 'round'
            },
            'paint': {
              'line-color': 'transparent',
              'line-width': 0,
              'line-opacity': 0
            }
          },
          // Keep drawing points visible for vertex placement
          {
            'id': 'gl-draw-point',
            'type': 'circle',
            'filter': ['all', ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
            'paint': {
              'circle-radius': 6,
              'circle-color': '#0080ff',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2
            }
          },
          // Keep drawing vertices visible (while drawing) - make them more prominent
          {
            'id': 'gl-draw-polygon-and-line-vertex-active',
            'type': 'circle',
            'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
            'paint': {
              'circle-radius': 5,
              'circle-color': '#ffffff',
              'circle-stroke-color': '#0080ff',
              'circle-stroke-width': 3
            }
          },
          // Add midpoint vertices for easier editing
          {
            'id': 'gl-draw-polygon-midpoint',
            'type': 'circle',
            'filter': ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
            'paint': {
              'circle-radius': 3,
              'circle-color': '#0080ff',
              'circle-opacity': 0.6
            }
          }
        ]
      });
      
      map.current.addControl(draw.current, 'top-right');

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
        // Clear any timeouts
        clearVertexMarkers();
        map.current.remove();
        map.current = null;
        setLayersInitialized(false);
      }
    };
  }, []); // Empty dependency array - initialize only once

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
