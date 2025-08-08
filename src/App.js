import "bootstrap/dist/css/bootstrap.min.css";
import { Navbar, Container, Button, Form, Alert, InputGroup, Tabs, Tab, ButtonGroup } from "react-bootstrap";
import { React, useState, useEffect, useRef, useCallback } from "react";
import examples from "./examples";
import { Twitter } from "react-bootstrap-icons";
import CRC32 from "crc-32";
import ReactGA from "react-ga4";
import { transformInput, ValueError, getBbox, drawFeaturesToWkt, combineWktGeometries } from "./wkt";
import { geojsonToWKT } from "@terraformer/wkt";
import { calculateSphericalSignedArea } from "./greatcircle";
import toast, { Toaster } from "react-hot-toast";
import SimpleMapLibreMap from "./SimpleMapLibreMap";

const DEFAULT_EPSG = "4326";

const formats = {
  "wkt": "WKT",
  "wkb": "WKB",
  "ewkb": "EWKB",
  "bbox": "BBOX",
  "geojson": "GeoJSON"
};

function App() {

  const [map, setMap] = useState(null);
  const [error, setError] = useState(null);
  const [epsg, setEpsg] = useState("");
  const [wkt, setWkt] = useState("");
  const [wkb, setWkb] = useState("");
  const [ewkb, setEwkb] = useState("");
  const [json, setJson] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [showVertexNumbers, setShowVertexNumbers] = useState(true);
  const [activeFormatTab, setActiveFormatTab] = useState('wkt');
  const [darkMode, setDarkMode] = useState(false);
  const [highlightRange, setHighlightRange] = useState(null); // {start,end}

  const [metrics, setMetrics] = useState({
    type: '',
    vertices: 0,
    bbox: '',
    area: null,
    length: null
  });

  const mapRef = useRef();
  const wktTextareaRef = useRef(null);
  // Cache of parsed coordinate string ranges for current WKT (array of {index,start,end})
  const coordinateRangesRef = useRef([]);
  const previousWktRef = useRef("");

  // Parse WKT polygon/linestring coordinates to map vertex index -> character range
  const parseCoordinateRanges = useCallback((wktString) => {
    coordinateRangesRef.current = [];
    if (!wktString) return;
    // Capture coordinate pairs (assumes 2D coords in current representation)
    const re = /([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)[\s]+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let match;
    let idx = 0;
    while ((match = re.exec(wktString)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const lon = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      coordinateRangesRef.current.push({ index: idx, start, end, text: match[0], lon, lat });
      idx += 1;
    }
  }, []);

  // Re-parse coordinate ranges whenever WKT changes
  useEffect(() => {
    parseCoordinateRanges(wkt);
  }, [wkt, parseCoordinateRanges]);

  // Handle vertex click from map: highlight corresponding coordinate occurrence in textarea
  const handleVertexClick = useCallback(({ coord, index }) => {
    let range;
    if (coord && coord.length >= 2) {
      const [lon, lat] = coord;
      const EPS = 1e-9;
      range = coordinateRangesRef.current.find(r => Math.abs(r.lon - lon) < EPS && Math.abs(r.lat - lat) < EPS);
    }
    if (!range) range = coordinateRangesRef.current.find(r => r.index === index);
    if (!range) return;
  // Use exact coordinate range (no boundary padding) per user request
  setHighlightRange({ start: range.start, end: range.end });
    requestAnimationFrame(()=>{
      if (wktTextareaRef.current) {
        wktTextareaRef.current.focus();
        const span = wktTextareaRef.current.querySelector('span.coord-highlight');
        if (span && span.scrollIntoView) span.scrollIntoView({ block: 'nearest' });
      }
    });
  }, []); // wkt not directly referenced; ranges ref updates via effect

  useEffect(() => {
    if (!map) return; // Only run when map is ready
    
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

  function handleMapLoad(mapInstance) {
    setMap(mapInstance);
  }

  async function handleDrawStop() {
    const wktDraw = drawFeaturesToWkt(mapRef.current?.getDraw());
    clearHash();
  setHighlightRange(null); // reset highlight when new drawing applied
    if (wktDraw) {
      let existingWktIn4326 = wkt;
      
      // If current EPSG is not 4326, convert existing geometry to 4326 first
      if (epsg !== "4326" && wkt && wkt.trim() !== "") {
        try {
          // Transform existing geometry from current EPSG to 4326
          const transformedInput = await transformInput({
            wkt: wkt,
            epsg: epsg
          });
          
          if (transformedInput.json) {
            // Convert the transformed GeoJSON back to WKT
            if (transformedInput.json.type === 'Feature') {
              existingWktIn4326 = geojsonToWKT(transformedInput.json.geometry);
            } else if (transformedInput.json.type === 'FeatureCollection') {
              const geometries = transformedInput.json.features.map(f => f.geometry);
              if (geometries.length === 1) {
                existingWktIn4326 = geojsonToWKT(geometries[0]);
              } else {
                const wktGeometries = geometries.map(geojsonToWKT);
                existingWktIn4326 = "GEOMETRYCOLLECTION (" + wktGeometries.join(", ") + ")";
              }
            } else {
              // Direct geometry
              existingWktIn4326 = geojsonToWKT(transformedInput.json);
            }
          }
        } catch (error) {
          console.error("Error converting existing geometry to 4326:", error);
          // If conversion fails, just use the original WKT
          existingWktIn4326 = wkt;
        }
      }
      
      // Combine existing WKT (now in 4326) with newly drawn geometry (already in 4326)
      const combinedWkt = combineWktGeometries(existingWktIn4326, wktDraw);
      setWkt(combinedWkt);
      setEpsg(4326);
      
      // Process input and visualize to show vertices for drawn polygons
      processInput({
        epsg: 4326,
        wkt: combinedWkt
      }, true);
      
      // Clear the drawing data after processing to prevent duplicate display
      // The main visualization will show the great circle version
      // Increased delay to ensure processInput completes and map has time to render
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.clearDrawing();
        }
      }, 300); // Increased delay from 200ms to 300ms for better reliability
    }
  }

  function handleCopy(format) {
    if (error) return;
    let text = "";
    if (format === "wkt") text = wkt;
    else if (format === "wkb") text = wkb;
    else if (format === "ewkb") text = ewkb;
    else if (format === "geojson") text = json;
    else if (format === "bbox") text = getBbox(wkt);
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast(`Copied ${formats[format]} to clipboard`, { icon: "📎" });
  }

  function handleWktClear() {
    clearHash();
    setWkt("");
    
    // Clear both drawing and visualization layers
    if (mapRef.current) {
      mapRef.current.clearDrawing();
      mapRef.current.clearVisualization();
    }
    
    processInput({
      epsg: epsg,
      wkt: ""
    });
  }

  function trimWkt(wkt) {
    return wkt.replace(/\s+/g, " ").trim();
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Removed unused handleWktChange (direct contentEditable onInput now handles updates)

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
  setHighlightRange(null); // reset highlight when loading new example
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
    if (previousWktRef.current !== input.wkt) {
      setHighlightRange(null);
    }
    setWkt(input.wkt);
    previousWktRef.current = input.wkt;
    setEpsg(input.epsg);
    setWkb(input.wkb);
    setEwkb(input.ewkb);
    setJson(input.json ? JSON.stringify(input.json, null, 2) : null);
    if (doVisualize) {
      visualize(input);
    }
    // Update metrics
    computeMetrics(input);
  }

  function clearHash() {
    const url = new URL(window.location);
    url.search = "";
    window.history.replaceState(null, null, url);
  }

  async function visualize(spatial) {
    if (spatial.json && mapRef.current) {
      // Use the MapLibre map component's visualization method
      mapRef.current.visualizeGeometry(spatial.json);
      
      // Check winding order and show warnings
      checkAndWarnWindingOrder(spatial.json);
    }
  }

  // Great-circle distance (haversine) helper (meters)
  function gcDistance(a, b) {
    const R = 6371008.8; // mean Earth radius metres
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b[1]-a[1]);
    const dLon = toRad(b[0]-a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  function computeLength(geometry) {
    let len = 0;
    function addLine(coords) {
      for (let i=1;i<coords.length;i++) {
        len += gcDistance(coords[i-1], coords[i]);
      }
    }
    if (geometry.type === 'LineString') addLine(geometry.coordinates);
    else if (geometry.type === 'MultiLineString') geometry.coordinates.forEach(addLine);
    else if (geometry.type === 'Polygon') geometry.coordinates.forEach(addLine);
    else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(p => p.forEach(addLine));
    else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(g=> len += computeLength(g));
    return len;
  }

  function computeArea(geometry) {
    // Uses existing calculateSphericalSignedArea for each ring
    let area = 0;
    function polygonArea(coords) {
      if (!coords.length) return;
      // exterior
      area += Math.abs(calculateSphericalSignedArea(coords[0]));
      // subtract holes
      for (let i=1;i<coords.length;i++) {
        area -= Math.abs(calculateSphericalSignedArea(coords[i]));
      }
    }
    if (geometry.type === 'Polygon') polygonArea(geometry.coordinates);
    else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(polygonArea);
    else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(g=> area += computeArea(g));
    return area; // square meters approximately
  }

  function computeMetrics(input) {
    try {
      const bboxVal = input.wkt ? getBbox(input.wkt) : '';
      const geo = input.json?.type ? (input.json.type === 'Feature' ? input.json.geometry : (input.json.type === 'FeatureCollection' ? { type: 'GeometryCollection', geometries: input.json.features.map(f=>f.geometry) } : input.json)) : null;
      let area = null;
      let length = null;
      if (geo) {
        area = computeArea(geo);
        length = computeLength(geo);
      }
      setMetrics({
        type: geo ? geo.type : '',
        vertices: coordinateRangesRef.current.length,
        bbox: bboxVal,
        area: area && area > 0 ? area : null,
        length: length && length > 0 ? length : null
      });
    } catch (e) {
      // Silent fail - metrics are auxiliary
    }
  }

  // Function to check winding order and show warnings for any geometry
  function checkAndWarnWindingOrder(geojson) {
    // Function to calculate the signed area of a ring using spherical geometry
    function calculateSignedArea(ring) {
      return calculateSphericalSignedArea(ring);
    }

    // Function to check winding order of a geometry
    function checkWindingOrder(geometry) {
      const warnings = [];
      const warningFeatures = [];

      function checkPolygon(coordinates, polygonIndex = 0) {
        coordinates.forEach((ring, ringIndex) => {
          const signedArea = calculateSignedArea(ring);
          const isClockwise = signedArea > 0;

          if (ringIndex === 0) {
            // Exterior ring should be counter-clockwise (negative signed area)
            if (isClockwise) {
              warnings.push(`Polygon ${polygonIndex + 1} exterior ring has incorrect winding order (clockwise instead of counter-clockwise)`);
              // Add feature for yellow highlighting
              warningFeatures.push({
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [ring]
                },
                properties: {
                  warning: 'exterior-clockwise'
                }
              });
            }
          } else {
            // Interior rings (holes) should be clockwise (positive signed area)
            if (!isClockwise) {
              warnings.push(`Polygon ${polygonIndex + 1} hole ${ringIndex} has incorrect winding order (counter-clockwise instead of clockwise)`);
              // Add feature for yellow highlighting
              warningFeatures.push({
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [ring]
                },
                properties: {
                  warning: 'hole-counterclockwise'
                }
              });
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
          const result = checkWindingOrder(geom);
          warnings.push(...result.warnings);
          warningFeatures.push(...result.warningFeatures);
        });
      }

      return { warnings, warningFeatures };
    }

    let allWarnings = [];
    let allWarningFeatures = [];

    if (geojson.type === 'Feature') {
      const result = checkWindingOrder(geojson.geometry);
      allWarnings = result.warnings;
      allWarningFeatures = result.warningFeatures;
    } else if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(feature => {
        const result = checkWindingOrder(feature.geometry);
        allWarnings.push(...result.warnings);
        allWarningFeatures.push(...result.warningFeatures);
      });
    } else if (geojson.type && geojson.coordinates) {
      // Direct geometry object
      const result = checkWindingOrder(geojson);
      allWarnings = result.warnings;
      allWarningFeatures = result.warningFeatures;
    }

    // Visualize warnings with yellow highlighting
    if (mapRef.current && mapRef.current.visualizeWindingOrderWarnings) {
      mapRef.current.visualizeWindingOrderWarnings(allWarningFeatures);
    }

    // Show warnings for incorrect winding order
    if (allWarnings.length > 0) {
      toast.error("The rings that are drawn in yellow have wrong winding order.", {
        icon: "⚠️",
        duration: 8000,
        style: {
          maxWidth: '500px'
        }
      });
    }
  }

  return (
  <div id="app" className={darkMode ? 'dark-theme' : ''}>

      <Toaster position="top-right" toastOptions={{ duration: 5000 }} />

      <Navbar bg={darkMode ? 'dark' : 'light'} variant={darkMode ? 'dark' : 'light'} expand="lg" className="shadow-sm" sticky="top">
        <Container fluid>
          <Navbar.Brand href="/" className="fw-semibold d-flex align-items-center gap-2">
            <span className="brand-accent" /> WKT Visualization
          </Navbar.Brand>
          <div className="d-flex align-items-center gap-3">
            <Form.Check
              type="switch"
              id="theme-toggle"
              label={darkMode ? 'Dark' : 'Light'}
              checked={darkMode}
              onChange={()=>setDarkMode(!darkMode)}
            />
          </div>
        </Container>
      </Navbar>

      <div id="main-content">
        <div id="map-container">
          <SimpleMapLibreMap
            ref={mapRef}
            onMapLoad={handleMapLoad}
            onDrawStop={handleDrawStop}
            center={[0, 20]}
            zoom={1.5}
            showVertexNumbers={showVertexNumbers}
            onVertexClick={handleVertexClick}
            darkMode={darkMode}
          />
        </div>

        <div id="controls-container">
          <Container fluid className="p-3 h-100 d-flex flex-column">
            <div className="d-flex flex-column flex-grow-1 overflow-auto">
              <div className="mb-3 action-bar">
                <ButtonGroup className="w-100 mb-2">
                  <Button variant="outline-primary" onClick={loadExample} size="sm">Example</Button>
                  <Button variant="outline-success" onClick={handleShare} size="sm">Share</Button>
                </ButtonGroup>
                <div className="d-flex gap-2 flex-wrap small">
                  <Form.Group controlId="epsg" className="flex-grow-1">
                    <InputGroup size="sm">
                      <InputGroup.Text>EPSG</InputGroup.Text>
                      <Form.Control value={epsg} onChange={handleEpsgChange} />
                    </InputGroup>
                  </Form.Group>
                  <Form.Group controlId="vertexNumbersToggle" className="d-flex align-items-center">
                    <Form.Check
                      type="switch"
                      label="Vertices"
                      checked={showVertexNumbers}
                      onChange={(e) => setShowVertexNumbers(e.target.checked)}
                    />
                  </Form.Group>
                </div>
              </div>

              {error && <Alert variant="danger" className="py-1 small mb-2">{error}</Alert>}

              <Tabs activeKey={activeFormatTab} onSelect={(k)=> setActiveFormatTab(k || 'wkt')} justify className="mb-2 modern-tabs">
                <Tab eventKey="wkt" title={<span>WKT</span>}>
                  <div className="wkt-editor-wrapper mt-2">
                    <div
                      ref={wktTextareaRef}
                      className="font-monospace code-input wkt-editor"
                      contentEditable
                      suppressContentEditableWarning
                      role="textbox"
                      aria-label="WKT editor"
                      spellCheck={false}
                      onInput={(e)=>{
                        clearHash();
                        const text = trimWkt(e.currentTarget.innerText);
                        setHighlightRange(null);
                        setWkt(text);
                        processInput({ wkt: text, epsg });
                      }}
                      onClick={(e)=>{
                        const t = e.target;
                        if (t.classList && t.classList.contains('coord-highlight')) {
                          const txt = t.textContent.trim();
                          if (txt) {
                            navigator.clipboard.writeText(txt);
                            toast(`Copied coordinate ${txt}`, { icon: '📍' });
                          }
                        }
                      }}
                      onMouseOver={(e)=>{ const t=e.target; if (t.classList && t.classList.contains('coord-highlight')) t.classList.add('hover'); }}
                      onMouseOut={(e)=>{ const t=e.target; if (t.classList && t.classList.contains('coord-highlight')) t.classList.remove('hover'); }}
                      dangerouslySetInnerHTML={{ __html: (() => {
                        if (!wkt) return '';
                        if (!highlightRange) return escapeHtml(wkt);
                        const { start, end } = highlightRange;
                        return escapeHtml(wkt.slice(0,start)) + '<span class="coord-highlight" title="Click to copy coordinate">' + escapeHtml(wkt.slice(start,end)) + '</span>' + escapeHtml(wkt.slice(end));
                      })() }}
                    />
                  </div>
                  <div className="d-flex justify-content-end mt-2 gap-2">
                      <Button size="sm" variant="danger" onClick={handleWktClear} disabled={!wkt}>Clear</Button>
                      <Button size="sm" variant="outline-primary" onClick={()=>handleCopy('wkt')} disabled={!!error || !wkt}>Copy</Button>
                  </div>
                </Tab>
                <Tab eventKey="geojson" title="GeoJSON" disabled={!json}>
                  <Form.Control className="font-monospace mt-2 code-output" as="textarea" rows={10} value={json||''} readOnly />
                  <div className="d-flex justify-content-end mt-2"><Button size="sm" variant="outline-primary" onClick={()=>handleCopy('geojson')} disabled={!json}>Copy</Button></div>
                </Tab>
                <Tab eventKey="wkb" title="WKB" disabled={!wkb}>
                  <Form.Control className="font-monospace mt-2 code-output" as="textarea" rows={6} value={wkb||''} readOnly />
                  <div className="d-flex justify-content-end mt-2"><Button size="sm" variant="outline-primary" onClick={()=>handleCopy('wkb')} disabled={!wkb}>Copy</Button></div>
                </Tab>
                <Tab eventKey="ewkb" title="EWKB" disabled={!ewkb}>
                  <Form.Control className="font-monospace mt-2 code-output" as="textarea" rows={6} value={ewkb||''} readOnly />
                  <div className="d-flex justify-content-end mt-2"><Button size="sm" variant="outline-primary" onClick={()=>handleCopy('ewkb')} disabled={!ewkb}>Copy</Button></div>
                </Tab>
                <Tab eventKey="bbox" title="BBOX" disabled={!metrics.bbox}>
                  <Form.Control className="font-monospace mt-2 code-output" as="textarea" rows={3} value={metrics.bbox} readOnly />
                  <div className="d-flex justify-content-end mt-2"><Button size="sm" variant="outline-primary" onClick={()=>handleCopy('bbox')} disabled={!metrics.bbox}>Copy</Button></div>
                </Tab>
              </Tabs>

              {/* Metrics panel removed per request */}
            </div>

            <div className="mt-3 small text-muted text-center opacity-75" />
          </Container>
        </div>
      </div>

      <footer className={`footer mt-auto pt-3 pb-3 ${darkMode ? 'bg-dark text-light' : 'bg-light'}`}>
        <Container fluid>
          <p className="text-muted small mb-1">This page parses, visualizes, and shares <a href="https://en.wikipedia.org/wiki/Well-known_text_representation_of_geometry" rel="noreferrer" className="text-reset" target="_blank">WKT</a> (ISO 13249) & <a href="https://opengeospatial.github.io/ogc-geosparql/geosparql11/spec.html#_rdfs_datatype_geowktliteral" target="blank" rel="noreferrer" className="text-reset">geo:wktLiteral</a>. Built with <a href="https://openlayers.org/" target="blank" rel="noreferrer" className="text-reset">OpenLayers</a>, <a href="https://maplibre.org/" target="blank" rel="noreferrer" className="text-reset">MapLibre GL JS</a>, <a href="https://trac.osgeo.org/proj4js" target="blank" rel="noreferrer" className="text-reset">Proj4js</a>, <a href="https://github.com/terraformer-js/terraformer" target="blank" rel="noreferrer" className="text-reset">terraformer</a>, <a href="https://epsg.io/" target="blank" rel="noreferrer" className="text-reset">epsg.io</a>.</p>
          <p className="text-muted small">
            Originally created by <Twitter className="mb-1" /> <a rel="noreferrer" className="text-reset" href="https://twitter.com/PieterPrvst" target="_blank">PieterPrvst</a>, further developed by <a rel="noreferrer" className="text-reset" href="https://github.com/meysam-" target="_blank">meysam-</a>
          </p>
        </Container>
      </footer>

    </div>
  );
}

export default App;