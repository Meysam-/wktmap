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

/**
 * Calculate the spherical area of a polygon ring using proper spherical trigonometry
 * This uses the spherical excess method which is correct for great circle arcs
 * @param {Array} ring - Array of [longitude, latitude] coordinates
 * @returns {number} Signed spherical area (positive for clockwise, negative for counter-clockwise)
 */
function calculateSphericalSignedArea(ring) {
  if (ring.length < 3) {
    return 0;
  }

  // Ensure the ring is closed and get coordinates
  const coords = ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1] 
    ? ring.slice(0, -1) 
    : ring;

  const n = coords.length;
  
  if (n < 3) {
    return 0;
  }

  // Use the spherical excess method for calculating the area
  // This method properly accounts for great circle arcs
  let sphericalExcess = -(n - 2) * Math.PI; // Start with the polygon defect
  
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const curr = i;
    const next = (i + 1) % n;
    
    const lon1 = toRadians(coords[prev][0]);
    const lat1 = toRadians(coords[prev][1]);
    const lon2 = toRadians(coords[curr][0]);
    const lat2 = toRadians(coords[curr][1]);
    const lon3 = toRadians(coords[next][0]);
    const lat3 = toRadians(coords[next][1]);
    
    // Calculate the spherical angle at vertex i
    // This is the angle between the great circle from prev->curr and curr->next
    const angle = calculateSphericalAngle(lon1, lat1, lon2, lat2, lon3, lat3);
    sphericalExcess += angle;
  }
  
  // Area = spherical excess * R²
  const R = 6378137; // Earth radius in meters (WGS84)
  const area = Math.abs(sphericalExcess) * R * R;
  
  // The sign of the spherical excess determines winding order
  // Positive spherical excess = counter-clockwise
  // Negative spherical excess = clockwise
  return sphericalExcess > 0 ? area : -area;
}

/**
 * Calculate the spherical angle between three points on a sphere
 * This calculates the angle at point B when going from A to B to C
 * @param {number} lonA - Longitude of point A in radians
 * @param {number} latA - Latitude of point A in radians
 * @param {number} lonB - Longitude of point B in radians
 * @param {number} latB - Latitude of point B in radians
 * @param {number} lonC - Longitude of point C in radians
 * @param {number} latC - Latitude of point C in radians
 * @returns {number} Spherical angle in radians
 */
function calculateSphericalAngle(lonA, latA, lonB, latB, lonC, latC) {
  // Convert to Cartesian coordinates
  const x1 = Math.cos(latA) * Math.cos(lonA);
  const y1 = Math.cos(latA) * Math.sin(lonA);
  const z1 = Math.sin(latA);
  
  const x2 = Math.cos(latB) * Math.cos(lonB);
  const y2 = Math.cos(latB) * Math.sin(lonB);
  const z2 = Math.sin(latB);
  
  const x3 = Math.cos(latC) * Math.cos(lonC);
  const y3 = Math.cos(latC) * Math.sin(lonC);
  const z3 = Math.sin(latC);
  
  // Calculate vectors from B to A and B to C
  const ba_x = x1 - x2;
  const ba_y = y1 - y2;
  const ba_z = z1 - z2;
  
  const bc_x = x3 - x2;
  const bc_y = y3 - y2;
  const bc_z = z3 - z2;
  
  // Calculate the cross products to get normal vectors to the great circle planes
  const n1_x = y2 * z1 - z2 * y1; // Normal to plane containing origin, B, A
  const n1_y = z2 * x1 - x2 * z1;
  const n1_z = x2 * y1 - y2 * x1;
  
  const n2_x = y2 * z3 - z2 * y3; // Normal to plane containing origin, B, C
  const n2_y = z2 * x3 - x2 * z3;
  const n2_z = x2 * y3 - y2 * x3;
  
  // Calculate the dot product and magnitudes
  const dot = n1_x * n2_x + n1_y * n2_y + n1_z * n2_z;
  const mag1 = Math.sqrt(n1_x * n1_x + n1_y * n1_y + n1_z * n1_z);
  const mag2 = Math.sqrt(n2_x * n2_x + n2_y * n2_y + n2_z * n2_z);
  
  if (mag1 === 0 || mag2 === 0) {
    return 0; // Degenerate case
  }
  
  // Calculate the angle between the normal vectors
  const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  
  // Calculate the cross product to determine the sign
  const cross_x = n1_y * n2_z - n1_z * n2_y;
  const cross_y = n1_z * n2_x - n1_x * n2_z;
  const cross_z = n1_x * n2_y - n1_y * n2_x;
  
  // Check if the cross product points in the same direction as the position vector of B
  const sign = (cross_x * x2 + cross_y * y2 + cross_z * z2) >= 0 ? 1 : -1;
  
  return sign * Math.acos(cosAngle);
}

export {
  calculateDistance,
  interpolateGreatCircle,
  generateGreatCircleArc,
  calculateSegments,
  transformLineStringToGreatCircle,
  transformPolygonToGreatCircle,
  transformGeometryToGreatCircle,
  transformGeoJSONToGreatCircle,
  calculateSphericalSignedArea
};
