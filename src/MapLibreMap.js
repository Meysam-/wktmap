import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import * as turf from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { transformGeoJSONToGreatCircle } from './greatcircle';

const MapLibreMap = forwardRef(({
  onDrawStop,
  onMapLoad,
  center = [0, 10],
  zoom = 1
}, ref) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const draw = useRef(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);

  // Expose map methods to parent component
  useImperativeHandle(ref, () => ({
    getMap: () => map.current,
    getDraw: () => draw.current,
    clearVisualization: () => {
      if (map.current) {
        // Remove all visualization layers
        const layers = ['wkt-geometry', 'wkt-geometry-fill', 'vertex-markers', 'incorrect-winding'];
        layers.forEach(layerId => {
          if (map.current.getLayer(layerId)) {
            map.current.removeLayer(layerId);
          }
        });
        
        // Remove all visualization sources
        const sources = ['wkt-data', 'vertex-data', 'incorrect-winding-data'];
        sources.forEach(sourceId => {
          if (map.current.getSource(sourceId)) {
            map.current.removeSource(sourceId);
          }
        });
      }
    },
    clearDrawing: () => {
      if (draw.current) {
        draw.current.deleteAll();
      }
    },
    visualizeGeometry: (geojson) => {
      if (!map.current || !isMapLoaded) return;
      
      // Clear previous visualization
      ref.current.clearVisualization();
      
      // Transform geometry to use great circle arcs
      const greatCircleGeometry = transformGeoJSONToGreatCircle(geojson);
      
      // Add the main geometry source and layers
      map.current.addSource('wkt-data', {
        type: 'geojson',
        data: greatCircleGeometry
      });
      
      // Add fill layer for polygons
      map.current.addLayer({
        id: 'wkt-geometry-fill',
        type: 'fill',
        source: 'wkt-data',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#3388ff',
          'fill-opacity': 0.2
        }
      });
      
      // Add line layer for all geometries
      map.current.addLayer({
        id: 'wkt-geometry',
        type: 'line',
        source: 'wkt-data',
        paint: {
          'line-color': '#3388ff',
          'line-width': 3,
          'line-opacity': 1
        }
      });
      
      // Add vertex markers
      addVertexMarkers(geojson);
      
      // Add incorrect winding overlays
      addIncorrectWindingOverlays(geojson);
      
      // Fit bounds to geometry
      try {
        const bbox = turf.bbox(greatCircleGeometry);
        map.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
          padding: 50,
          maxZoom: 14
        });
      } catch (e) {
        console.warn('Could not fit bounds to geometry');
      }
    },
    flyTo: (center, zoom) => {
      if (map.current) {
        map.current.flyTo({ center, zoom });
      }
    }
  }));

  // Function to add vertex markers
  const addVertexMarkers = (geojson) => {
    const vertexFeatures = [];
    
    const processGeometry = (geometry) => {
      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach((ring, ringIndex) => {
          ring.forEach((coord, coordIndex) => {
            // Skip the last coordinate as it's the same as the first
            if (coordIndex < ring.length - 1) {
              vertexFeatures.push({
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: coord
                },
                properties: {
                  index: coordIndex,
                  ringType: ringIndex === 0 ? 'exterior' : 'hole',
                  color: ringIndex === 0 ? '#ff0000' : '#ff8800'
                }
              });
            }
          });
        });
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => {
          processGeometry({ type: 'Polygon', coordinates: polygon });
        });
      } else if (geometry.type === 'LineString') {
        geometry.coordinates.forEach((coord, coordIndex) => {
          vertexFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: coord
            },
            properties: {
              index: coordIndex,
              ringType: 'line',
              color: '#0000ff'
            }
          });
        });
      } else if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach(line => {
          processGeometry({ type: 'LineString', coordinates: line });
        });
      } else if (geometry.type === 'GeometryCollection') {
        geometry.geometries.forEach(geom => {
          processGeometry(geom);
        });
      }
    };

    if (geojson.type === 'Feature') {
      processGeometry(geojson.geometry);
    } else if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(feature => {
        processGeometry(feature.geometry);
      });
    } else if (geojson.type && geojson.coordinates) {
      processGeometry(geojson);
    }

    if (vertexFeatures.length > 0) {
      // Add vertex markers source and layer
      map.current.addSource('vertex-data', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: vertexFeatures
        }
      });

      // Add vertex markers as symbols with text
      map.current.addLayer({
        id: 'vertex-markers',
        type: 'symbol',
        source: 'vertex-data',
        layout: {
          'text-field': ['get', 'index'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 10,
          'text-offset': [0, 0],
          'text-anchor': 'center'
        },
        paint: {
          'text-color': 'white',
          'text-halo-color': ['get', 'color'],
          'text-halo-width': 8
        }
      });
    }
  };

  // Function to add incorrect winding overlays
  const addIncorrectWindingOverlays = (geojson) => {
    const calculateSignedArea = (ring) => {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
      }
      return area / 2;
    };

    const incorrectWindingFeatures = [];

    const processGeometry = (geometry) => {
      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach((ring, ringIndex) => {
          const signedArea = calculateSignedArea(ring);
          const isClockwise = signedArea > 0;

          let hasIncorrectWinding = false;
          if (ringIndex === 0) {
            hasIncorrectWinding = isClockwise;
          } else {
            hasIncorrectWinding = !isClockwise;
          }

          if (hasIncorrectWinding) {
            const ringGeometry = {
              type: 'Polygon',
              coordinates: [ring]
            };
            
            const greatCircleRingGeometry = transformGeoJSONToGreatCircle(ringGeometry);
            incorrectWindingFeatures.push(greatCircleRingGeometry);
          }
        });
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => {
          processGeometry({ type: 'Polygon', coordinates: polygon });
        });
      } else if (geometry.type === 'GeometryCollection') {
        geometry.geometries.forEach(geom => {
          processGeometry(geom);
        });
      }
    };

    if (geojson.type === 'Feature') {
      processGeometry(geojson.geometry);
    } else if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(feature => {
        processGeometry(feature.geometry);
      });
    } else if (geojson.type && geojson.coordinates) {
      processGeometry(geojson);
    }

    if (incorrectWindingFeatures.length > 0) {
      map.current.addSource('incorrect-winding-data', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: incorrectWindingFeatures
        }
      });

      map.current.addLayer({
        id: 'incorrect-winding',
        type: 'line',
        source: 'incorrect-winding-data',
        paint: {
          'line-color': '#ffaa00',
          'line-width': 4,
          'line-opacity': 1
        }
      });
    }
  };

  useEffect(() => {
    if (map.current) return; // Initialize map only once

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19
          }
        ]
      },
      center: center,
      zoom: zoom,
      pitch: 0,
      bearing: 0
    });

    // Add fullscreen control
    map.current.addControl(new maplibregl.FullscreenControl(), 'top-left');

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
      styles: [
        // Style for polygon fills
        {
          id: 'gl-draw-polygon-fill-inactive',
          type: 'fill',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': '#3388ff',
            'fill-outline-color': '#3388ff',
            'fill-opacity': 0.2
          }
        },
        {
          id: 'gl-draw-polygon-fill-active',
          type: 'fill',
          filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
          paint: {
            'fill-color': '#3388ff',
            'fill-outline-color': '#3388ff',
            'fill-opacity': 0.2
          }
        },
        // Style for polygon strokes
        {
          id: 'gl-draw-polygon-stroke-inactive',
          type: 'line',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#3388ff',
            'line-width': 3
          }
        },
        {
          id: 'gl-draw-polygon-stroke-active',
          type: 'line',
          filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#3388ff',
            'line-width': 3
          }
        },
        // Style for line strings
        {
          id: 'gl-draw-line-inactive',
          type: 'line',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#3388ff',
            'line-width': 3
          }
        },
        {
          id: 'gl-draw-line-active',
          type: 'line',
          filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'LineString']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#3388ff',
            'line-width': 3
          }
        },
        // Style for points
        {
          id: 'gl-draw-point-point-stroke-inactive',
          type: 'circle',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 4,
            'circle-opacity': 1,
            'circle-color': '#3388ff'
          }
        },
        {
          id: 'gl-draw-point-point-stroke-active',
          type: 'circle',
          filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
          paint: {
            'circle-radius': 4,
            'circle-opacity': 1,
            'circle-color': '#3388ff'
          }
        }
      ]
    });

    map.current.addControl(draw.current, 'top-right');

    // Handle drawing events
    map.current.on('draw.create', onDrawStop);
    map.current.on('draw.update', onDrawStop);

    map.current.on('load', () => {
      setIsMapLoaded(true);
      if (onMapLoad) {
        onMapLoad(map.current);
      }
      
      // Enable globe mode after the map loads
      // Note: Only enable this if the MapLibre version supports it
      try {
        map.current.setProjection('globe');
      } catch (error) {
        console.warn('Globe projection not supported in this MapLibre version:', error);
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [center, zoom, onDrawStop, onMapLoad]);

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100%',
        height: '50vh',
        minHeight: '400px'
      }}
    />
  );
});

MapLibreMap.displayName = 'MapLibreMap';

export default MapLibreMap;
