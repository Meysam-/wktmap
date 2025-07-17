import "bootstrap/dist/css/bootstrap.min.css";
import { Navbar, Container, Button, Form, Row, Col, Alert, InputGroup, Dropdown } from "react-bootstrap";
import { MapContainer, TileLayer, FeatureGroup, LayersControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { React, useState, useMemo, useEffect, useRef } from "react";
import examples from "./examples";
import { Twitter } from "react-bootstrap-icons";
import FullscreenControl from "./FullscreenControl";
import CRC32 from "crc-32";
import { EditControl } from "react-leaflet-draw";
import ReactGA from "react-ga4";
import { transformInput, ValueError, getBbox, layerGroupToWkt } from "./wkt";
import { transformGeoJSONToGreatCircle } from "./greatcircle";
import toast, { Toaster } from "react-hot-toast";

const DEFAULT_EPSG = "4326";

const formats = {
  "wkt": "WKT",
  "wkb": "WKB",
  "ewkb": "EWKB",
  "bbox": "BBOX",
  "geojson": "GeoJSON"
};

function createCircleMarker(feature, latlng) {
  let options = {
    radius: 4
  }
  return L.circleMarker(latlng, options);
}

function App() {

  const [map, setMap] = useState(null);
  const [error, setError] = useState(null);
  const [epsg, setEpsg] = useState("");
  const [wkt, setWkt] = useState("");
  const [wkb, setWkb] = useState("");
  const [ewkb, setEwkb] = useState("");
  const [json, setJson] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);

  const groupRef = useRef();
  const visualizationLayerRef = useRef();

  const ensureResize = function (mapRef) {
    const resizeObserver = new ResizeObserver(() => {
      mapRef.invalidateSize();
    });
    const container = document.getElementById("map");
    if (container) {
      resizeObserver.observe(container);
    }
  }

  const displayMap = useMemo(
    () => {
      return <MapContainer
        id="map"
        whenReady={(mapRef) => ensureResize(mapRef.target)}
        center={[10, 0]}
        zoom={1}
        scrollWheelZoom={true}
        ref={setMap}
      >
        <LayersControl>
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Humanitarian">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
              url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Esri World Imagery">
            <TileLayer
              attribution='Esri, Maxar, Earthstar Geographics, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
          <LayersControl.Overlay name="OpenSeaMap">
            <TileLayer
              attribution='&copy; <a href="http://www.openseamap.org">OpenSeaMap contributors</a>'
              url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
            />
          </LayersControl.Overlay>
        </LayersControl>
        <FullscreenControl />
        <FeatureGroup ref={groupRef}>
          <EditControl
            position="topright"
            onDrawStop={handleDrawStop}
            edit={{ edit: false, remove: false }}
            draw={{
              rectangle: {
                shapeOptions: {
                  opacity: 1,
                  fillOpacity: 0.2,
                  weight: 3,
                  color: "#3388ff",
                  fill: "#3388ff"
                }
              },
              marker: false,
              circle: false,
              polygon: {
                shapeOptions: {
                  opacity: 1,
                  fillOpacity: 0.2,
                  weight: 3,
                  color: "#3388ff",
                  fill: "#3388ff"
                }
              },
              circlemarker: {
                opacity: 1,
                fillOpacity: 0.2,
                weight: 3,
                radius: 4,
                color: "#3388ff",
                fill: "#3388ff"
              },
              polyline: {
                shapeOptions: {
                  opacity: 1,
                  weight: 3,
                  color: "#3388ff",
                  fill: false
                }
              }
            }}
          />
        </FeatureGroup>
        <FeatureGroup ref={visualizationLayerRef}>
          {/* This layer group is for visualization only (great circle arcs, vertex markers, etc.) */}
        </FeatureGroup>
      </MapContainer>
    }, [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    async function fetchWkt(hash) {
      const res = await fetch("https://xpjpbiqaa3.execute-api.us-east-1.amazonaws.com/prod/wkt/" + hash);
      if (res.status === 200) {
        const data = await res.json();
        let paramWkt = data.wkt ? data.wkt : "";
        let paramEpsg = data.epsg ? data.epsg : DEFAULT_EPSG;
        setWkt(paramWkt);
        setEpsg(paramEpsg);
        processInput({
          wkt: paramWkt,
          epsg: paramEpsg
        });
      }
    }
    const urlSearchParams = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(urlSearchParams.entries());
    if (Object.keys(params).length === 0) {
      loadExample();
    } else {
      const hash = Object.keys(params)[0];
      fetchWkt(hash);
    }
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDrawStop() {
    const wktDraw = layerGroupToWkt(groupRef.current);
    setEpsg(4326);
    clearHash();
    if (wktDraw) {
      setWkt(wktDraw);
      // Process input and visualize to show vertices for drawn polygons
      processInput({
        epsg: 4326,
        wkt: wktDraw
      }, true);
    }
  }

  function handleCopy(format) {
    if (!error) {
      let text = "";
      if (format === "wkt") {
        text = wkt;
      } else if (format === "wkb") {
        text = wkb;
      } else if (format === "ewkb") {
        text = ewkb;
      } else if (format === "geojson") {
        text = json;
      } else if (format === "bbox") {
        text = getBbox(wkt);
      }
      navigator.clipboard.writeText(text);
      toast("Copied geometry as " + formats[format], { icon: "📎" })
    }
  }

  function handleWktClear() {
    clearHash();
    setWkt("");
    
    // Clear both drawing and visualization layers
    if (groupRef.current) {
      groupRef.current.clearLayers();
    }
    if (visualizationLayerRef.current) {
      visualizationLayerRef.current.clearLayers();
    }
    
    processInput({
      epsg: epsg,
      wkt: ""
    });
  }

  function trimWkt(wkt) {
    return wkt.replace(/\s+/g, " ").trim();
  }

  function handleWktChange(e) {
    clearHash();
    const wkt = trimWkt(e.target.value)
    setWkt(wkt);
    processInput({
      wkt: wkt,
      epsg: epsg
    });
  }

  function handleEpsgChange(e) {
    clearHash();
    setEpsg(e.target.value);
    processInput({
      wkt: wkt,
      epsg: e.target.value
    });
  }

  function handleShare() {
    let crc = CRC32.str(wkt + epsg);
    let hash = (crc >>> 0).toString(16).padStart(8, "0");
    fetch("https://xpjpbiqaa3.execute-api.us-east-1.amazonaws.com/prod/wkt", {
      method: "POST",
      body: JSON.stringify({
        id: hash,
        wkt: wkt,
        epsg: epsg
      }),
      headers: {
        "Content-Type": "application/json"
      }
    }).catch(error => console.error(error));
    window.history.replaceState(null, null, "?" + hash);
    navigator.clipboard.writeText(window.location.href);
    toast("Generated URL for sharing and copied to clipboard")
    ReactGA.event({
      category: "wkt",
      action: "wkt_share",
      label: hash,
    });
  }

  function loadExample() {
    clearHash();
    const example = examples[exampleIndex];
    setWkt(example[0]);
    setEpsg(example[1]);
    processInput({
      wkt: example[0],
      epsg: example[1]
    });
    const newIndex = exampleIndex < examples.length - 1 ? exampleIndex + 1 : 0;
    setExampleIndex(newIndex);
  }

  async function processInput(input, doVisualize = true) {
    setError(null);
    try {
      input = await transformInput(input);
    } catch (error) {
      if (error instanceof ValueError) {
        setError(error.message);
      }
    }
    setWkt(input.wkt);
    setEpsg(input.epsg);
    setWkb(input.wkb);
    setEwkb(input.ewkb);
    setJson(input.json ? JSON.stringify(input.json, null, 2) : null);
    if (doVisualize) {
      visualize(input);
    }
  }

  function clearHash() {
    const url = new URL(window.location);
    url.search = "";
    window.history.replaceState(null, null, url);
  }

  async function visualize(spatial) {
    // Clear the visualization layer
    if (visualizationLayerRef.current) {
      visualizationLayerRef.current.clearLayers();
    }
    
    // Hide the drawn geometries while showing the great circle visualization
    if (groupRef.current) {
      groupRef.current.eachLayer(layer => {
        if (layer instanceof L.Path) {
          // Hide the original drawn geometries
          layer.setStyle({ opacity: 0, fillOpacity: 0 });
        }
      });
    }
    
    if (spatial.json && visualizationLayerRef.current) {
      // Transform the geometry to use great circle arcs for visualization
      const greatCircleGeometry = transformGeoJSONToGreatCircle(spatial.json);
      
      // First, add the geometry with great circle arcs and default styling
      const conf = {
        pointToLayer: createCircleMarker,
        style: {
          opacity: 1,
          fillOpacity: 0.2,
          weight: 3,
          color: "#3388ff",
          fillColor: "#3388ff"
        }
      };

      let newLayer = L.geoJSON(greatCircleGeometry, conf).addTo(visualizationLayerRef.current);

      // Then, add yellow overlays for rings with incorrect winding order
      // Note: We use the original geometry (not great circle) for winding order checks
      addIncorrectWindingOverlays(spatial.json, visualizationLayerRef.current);

      // Add vertex markers for polygons
      // Note: We use the original geometry (not great circle) for vertex markers
      addVertexMarkers(spatial.json, visualizationLayerRef.current);

      // Check winding order and show warnings
      checkAndWarnWindingOrder(spatial.json);

      if (map) map.flyToBounds(newLayer.getBounds(), { duration: 0.5, maxZoom: 14 });
    }
  }

  // Function to add yellow overlays for rings with incorrect winding order
  function addIncorrectWindingOverlays(geojson, layerGroup) {
    // Function to calculate the signed area of a ring (for winding order detection)
    function calculateSignedArea(ring) {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
      }
      return area / 2;
    }

    function processGeometry(geometry) {
      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach((ring, ringIndex) => {
          const signedArea = calculateSignedArea(ring);
          const isClockwise = signedArea > 0;

          let hasIncorrectWinding = false;
          if (ringIndex === 0) {
            // Exterior ring should be counter-clockwise
            hasIncorrectWinding = isClockwise;
          } else {
            // Interior rings (holes) should be clockwise
            hasIncorrectWinding = !isClockwise;
          }

          if (hasIncorrectWinding) {
            // Create a separate polygon for this specific ring with yellow styling
            const ringGeometry = {
              type: 'Polygon',
              coordinates: [ring]
            };

            // Transform the yellow overlay to use great circle arcs as well
            const greatCircleRingGeometry = transformGeoJSONToGreatCircle(ringGeometry);

            const yellowOverlay = L.geoJSON(greatCircleRingGeometry, {
              style: {
                opacity: 1,
                fillOpacity: 0, // No fill, only border
                weight: 4,
                color: "#ffaa00", // Yellow border
                fill: false
              }
            });

            layerGroup.addLayer(yellowOverlay);
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
    }

    if (geojson.type === 'Feature') {
      processGeometry(geojson.geometry);
    } else if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(feature => {
        processGeometry(feature.geometry);
      });
    } else if (geojson.type && geojson.coordinates) {
      processGeometry(geojson);
    }
  }

  // Function to check winding order and show warnings for any geometry
  function checkAndWarnWindingOrder(geojson) {
    // Function to calculate the signed area of a ring (for winding order detection)
    function calculateSignedArea(ring) {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
      }
      return area / 2;
    }

    // Function to check winding order of a geometry
    function checkWindingOrder(geometry) {
      const warnings = [];

      function checkPolygon(coordinates, polygonIndex = 0) {
        coordinates.forEach((ring, ringIndex) => {
          const signedArea = calculateSignedArea(ring);
          const isClockwise = signedArea > 0;

          if (ringIndex === 0) {
            // Exterior ring should be counter-clockwise (negative signed area)
            if (isClockwise) {
              warnings.push(`Polygon ${polygonIndex + 1} exterior ring has incorrect winding order (clockwise instead of counter-clockwise)`);
            }
          } else {
            // Interior rings (holes) should be clockwise (positive signed area)
            if (!isClockwise) {
              warnings.push(`Polygon ${polygonIndex + 1} hole ${ringIndex} has incorrect winding order (counter-clockwise instead of clockwise)`);
            }
          }
        });
      }

      if (geometry.type === 'Polygon') {
        checkPolygon(geometry.coordinates);
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((polygon, index) => {
          checkPolygon(polygon, index);
        });
      } else if (geometry.type === 'GeometryCollection') {
        geometry.geometries.forEach(geom => {
          warnings.push(...checkWindingOrder(geom));
        });
      }

      return warnings;
    }

    let allWarnings = [];

    if (geojson.type === 'Feature') {
      allWarnings = checkWindingOrder(geojson.geometry);
    } else if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(feature => {
        allWarnings.push(...checkWindingOrder(feature.geometry));
      });
    } else if (geojson.type && geojson.coordinates) {
      // Direct geometry object
      allWarnings = checkWindingOrder(geojson);
    }

    // Show warnings for incorrect winding order
    if (allWarnings.length > 0) {
      toast.error("The rings that are drawn on yellow have wrong winding order.", {
        icon: "⚠️",
        duration: 8000,
        style: {
          maxWidth: '500px'
        }
      });
    }
  }

  // Function to add vertex markers for polygon geometries
  function addVertexMarkers(geojson, layerGroup) {
    function processGeometry(geometry) {
      if (geometry.type === 'Polygon') {
        // Process exterior ring and holes
        geometry.coordinates.forEach((ring, ringIndex) => {
          ring.forEach((coord, coordIndex) => {
            // Skip the last coordinate as it's the same as the first (closing coordinate)
            if (coordIndex < ring.length - 1) {
              // Add vertex index as a DivIcon with number
              const indexLabel = L.divIcon({
                className: 'vertex-index-label',
                html: `<div style="
                  background: ${ringIndex === 0 ? '#ff0000' : '#ff8800'};
                  color: white;
                  border: 1px solid white;
                  border-radius: 50%;
                  width: 16px;
                  height: 16px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 10px;
                  font-weight: bold;
                  font-family: Arial, sans-serif;
                ">${coordIndex}</div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              });

              const indexMarker = L.marker([coord[1], coord[0]], { icon: indexLabel });
              layerGroup.addLayer(indexMarker);
            }
          });
        });
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => {
          processGeometry({ type: 'Polygon', coordinates: polygon });
        });
      } else if (geometry.type === 'LineString') {
        geometry.coordinates.forEach((coord, coordIndex) => {
          // Add vertex index as a DivIcon with number
          const indexLabel = L.divIcon({
            className: 'vertex-index-label',
            html: `<div style="
              background: #0000ff;
              color: white;
              border: 1px solid white;
              border-radius: 50%;
              width: 16px;
              height: 16px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 10px;
              font-weight: bold;
              font-family: Arial, sans-serif;
            ">${coordIndex}</div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });

          const indexMarker = L.marker([coord[1], coord[0]], { icon: indexLabel });
          layerGroup.addLayer(indexMarker);
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
    }

    if (geojson.type === 'Feature') {
      processGeometry(geojson.geometry);
    } else if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(feature => {
        processGeometry(feature.geometry);
      });
    } else if (geojson.type && geojson.coordinates) {
      // Direct geometry object
      processGeometry(geojson);
    }
  }

  return (
    <div id="app">

      <Toaster position="top-right" toastOptions={{ duration: 5000 }} />

      <Navbar bg="light" expand="lg">
        <Container>
          <Navbar.Brand href="/">
            Well-known Text (WKT) visualization
          </Navbar.Brand>
        </Container>
      </Navbar>

      {displayMap}

      <Container className="mt-3 mb-3">

        <Row>
          <Col lg={true} className="mb-3">
            <Form.Group className="mb-3" controlId="wkt">
              <Form.Label>WKT</Form.Label>
              <Form.Control className="font-monospace" as="textarea" rows={8} value={wkt} onChange={handleWktChange} />
            </Form.Group>
            <div className="d-flex d-md-block justify-content-between">
              <Button className="me-2" variant="light" onClick={loadExample}>Load example</Button>
              <Button className="me-2" variant="warning" onClick={handleWktClear}>Clear</Button>
              <Dropdown className="me-2 d-inline-block">
                <Dropdown.Toggle variant="light">Copy as</Dropdown.Toggle>
                <Dropdown.Menu>
                  {
                    Object.keys(formats).map(format => <Dropdown.Item key={format} disabled={error || !json} onClick={() => handleCopy(format)}>{formats[format]}</Dropdown.Item>)
                  }
                </Dropdown.Menu>
              </Dropdown>
              <Button className="me-2" variant="success" onClick={handleShare}>Share</Button>
            </div>
          </Col>
          <Col lg={true} className="mb-3">
            <Form.Group className="mb-3" controlId="epsg">
              <Form.Label>EPSG</Form.Label>
              <InputGroup>
                <InputGroup.Text id="basic-addon1">EPSG:</InputGroup.Text>
                <Form.Control value={epsg} onChange={handleEpsgChange} />
              </InputGroup>
            </Form.Group>
            {
              error && <Alert variant="danger">{error}</Alert>
            }
          </Col>
        </Row>
      </Container>

      <footer className="footer mt-auto pt-5 pb-4 bg-light">
        <Container>
          <p className="text-muted">This page parses, visualizes, and shares <a href="https://en.wikipedia.org/wiki/Well-known_text_representation_of_geometry" rel="noreferrer" className="text-muted" target="_blank">WKT</a> (ISO 13249) as well as <a href="https://opengeospatial.github.io/ogc-geosparql/geosparql11/spec.html#_rdfs_datatype_geowktliteral" target="blank" rel="noreferrer" className="text-muted">geo:wktLiteral</a> strings in a variety of coordinate reference systems. Built with <a href="https://openlayers.org/" target="blank" rel="noreferrer" className="text-muted">OpenLayers</a>, <a href="https://leafletjs.com/" target="blank" rel="noreferrer" className="text-muted">Leaflet</a>, <a href="https://trac.osgeo.org/proj4js" target="blank" rel="noreferrer" className="text-muted">Proj4js</a>, <a href="https://github.com/terraformer-js/terraformer" target="blank" rel="noreferrer" className="text-muted">terraformer</a>, and <a href="https://epsg.io/" target="blank" rel="noreferrer" className="text-muted">epsg.io</a>. Use the drawing tools to create your own geometries. Copy as Well-known Binary (WKB) or Extended Well-known Binary (EWKB). Also supports <a href="https://h3geo.org/" rel="noreferrer" className="text-muted" target="_blank">Uber H3</a>, <a href="https://en.wikipedia.org/wiki/Geohash" rel="noreferrer" className="text-muted" target="_blank">Geohash</a>, <a href="https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system" rel="noreferrer" className="text-muted" target="_blank">Quadkey</a>, WKB, and WFS BBOX conversion to WKT.</p>
          <p className="text-muted">Created by <Twitter className="mb-1" /> <a rel="noreferrer" className="text-muted" href="https://twitter.com/PieterPrvst" target="_blank">PieterPrvst</a></p>
        </Container>
      </footer>

    </div>
  );
}

export default App;