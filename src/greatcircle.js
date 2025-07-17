/**
 * Great Circle utilities for rendering curved lines on spherical surfaces
 */

// Convert degrees to radians
function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

// Convert radians to degrees
function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

/**
 * Calculate the great circle distance between two points
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Interpolate along a great circle between two points
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @param {number} fraction - Fraction along the path (0 to 1)
 * @returns {Array} [longitude, latitude] in degrees
 */
function interpolateGreatCircle(lat1, lon1, lat2, lon2, fraction) {
  const φ1 = toRadians(lat1);
  const λ1 = toRadians(lon1);
  const φ2 = toRadians(lat2);
  const λ2 = toRadians(lon2);

  // Calculate the angular distance
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const δ = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  // Handle the case where points are very close
  if (δ < 1e-6) {
    return [lon1, lat1];
  }

  const A = Math.sin((1 - fraction) * δ) / Math.sin(δ);
  const B = Math.sin(fraction * δ) / Math.sin(δ);

  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);

  const φ3 = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ3 = Math.atan2(y, x);

  return [toDegrees(λ3), toDegrees(φ3)];
}

/**
 * Generate intermediate points along a great circle arc
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @param {number} segments - Number of segments to divide the arc into
 * @returns {Array} Array of [longitude, latitude] coordinates
 */
function generateGreatCircleArc(lat1, lon1, lat2, lon2, segments = 20) {
  const points = [];
  
  // Always include the start point
  points.push([lon1, lat1]);
  
  // Generate intermediate points
  for (let i = 1; i < segments; i++) {
    const fraction = i / segments;
    const point = interpolateGreatCircle(lat1, lon1, lat2, lon2, fraction);
    points.push(point);
  }
  
  // Always include the end point
  points.push([lon2, lat2]);
  
  return points;
}

/**
 * Calculate appropriate number of segments based on distance
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {number} Number of segments
 */
function calculateSegments(lat1, lon1, lat2, lon2) {
  const distance = calculateDistance(lat1, lon1, lat2, lon2);
  
  // Use more segments for longer distances
  // Base segments on roughly 100km per segment, with min 3 and max 50
  const segments = Math.max(3, Math.min(50, Math.ceil(distance / 100)));
  
  return segments;
}

/**
 * Transform a LineString coordinate array to use great circle arcs
 * @param {Array} coordinates - Array of [longitude, latitude] coordinates
 * @returns {Array} Array of [longitude, latitude] coordinates with great circle interpolation
 */
function transformLineStringToGreatCircle(coordinates) {
  if (coordinates.length < 2) {
    return coordinates;
  }
  
  const result = [];
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];
    
    const segments = calculateSegments(lat1, lon1, lat2, lon2);
    const arcPoints = generateGreatCircleArc(lat1, lon1, lat2, lon2, segments);
    
    // Add all points except the last one (to avoid duplication)
    for (let j = 0; j < arcPoints.length - 1; j++) {
      result.push(arcPoints[j]);
    }
  }
  
  // Add the final point
  result.push(coordinates[coordinates.length - 1]);
  
  return result;
}

/**
 * Transform a Polygon coordinate array to use great circle arcs
 * @param {Array} coordinates - Array of rings, where each ring is an array of [longitude, latitude] coordinates
 * @returns {Array} Array of rings with great circle interpolation
 */
function transformPolygonToGreatCircle(coordinates) {
  return coordinates.map(ring => {
    // For polygons, we need to handle the closed ring properly
    if (ring.length < 3) {
      return ring;
    }
    
    // Create a LineString from the ring (excluding the duplicate last point)
    const lineCoords = ring.slice(0, -1);
    const transformedLine = transformLineStringToGreatCircle(lineCoords);
    
    // Close the ring by adding the first point as the last point
    transformedLine.push(transformedLine[0]);
    
    return transformedLine;
  });
}

/**
 * Transform any GeoJSON geometry to use great circle arcs
 * @param {Object} geometry - GeoJSON geometry object
 * @returns {Object} Transformed geometry with great circle interpolation
 */
function transformGeometryToGreatCircle(geometry) {
  if (!geometry || !geometry.type) {
    return geometry;
  }
  
  // Create a deep copy to avoid modifying the original
  const transformedGeometry = JSON.parse(JSON.stringify(geometry));
  
  switch (geometry.type) {
    case 'LineString':
      transformedGeometry.coordinates = transformLineStringToGreatCircle(geometry.coordinates);
      break;
      
    case 'Polygon':
      transformedGeometry.coordinates = transformPolygonToGreatCircle(geometry.coordinates);
      break;
      
    case 'MultiLineString':
      transformedGeometry.coordinates = geometry.coordinates.map(line => 
        transformLineStringToGreatCircle(line)
      );
      break;
      
    case 'MultiPolygon':
      transformedGeometry.coordinates = geometry.coordinates.map(polygon => 
        transformPolygonToGreatCircle(polygon)
      );
      break;
      
    case 'GeometryCollection':
      transformedGeometry.geometries = geometry.geometries.map(geom => 
        transformGeometryToGreatCircle(geom)
      );
      break;
      
    // Point and MultiPoint don't need transformation
    case 'Point':
    case 'MultiPoint':
    default:
      break;
  }
  
  return transformedGeometry;
}

/**
 * Transform a GeoJSON feature or feature collection to use great circle arcs
 * @param {Object} geojson - GeoJSON object (Feature, FeatureCollection, or geometry)
 * @returns {Object} Transformed GeoJSON with great circle interpolation
 */
function transformGeoJSONToGreatCircle(geojson) {
  if (!geojson || !geojson.type) {
    return geojson;
  }
  
  // Create a deep copy to avoid modifying the original
  const transformed = JSON.parse(JSON.stringify(geojson));
  
  switch (geojson.type) {
    case 'Feature':
      transformed.geometry = transformGeometryToGreatCircle(geojson.geometry);
      break;
      
    case 'FeatureCollection':
      transformed.features = geojson.features.map(feature => ({
        ...feature,
        geometry: transformGeometryToGreatCircle(feature.geometry)
      }));
      break;
      
    default:
      // Direct geometry object
      return transformGeometryToGreatCircle(geojson);
  }
  
  return transformed;
}

export {
  calculateDistance,
  interpolateGreatCircle,
  generateGreatCircleArc,
  calculateSegments,
  transformLineStringToGreatCircle,
  transformPolygonToGreatCircle,
  transformGeometryToGreatCircle,
  transformGeoJSONToGreatCircle
};
