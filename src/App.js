import "bootstrap/dist/css/bootstrap.min.css";
import { Navbar, Container, Button, Form, Row, Col, Alert, InputGroup, Dropdown } from "react-bootstrap";
import { React, useState, useEffect, useRef } from "react";
import examples from "./examples";
import { Twitter } from "react-bootstrap-icons";
import CRC32 from "crc-32";
import ReactGA from "react-ga4";
import { transformInput, ValueError, getBbox, drawFeaturesToWkt } from "./wkt";
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

  const mapRef = useRef();

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

  function handleMapLoad(mapInstance) {
    setMap(mapInstance);
  }

  function handleDrawStop() {
    const wktDraw = drawFeaturesToWkt(mapRef.current?.getDraw());
    setEpsg(4326);
    clearHash();
    if (wktDraw) {
      setWkt(wktDraw);
      // Process input and visualize to show vertices for drawn polygons
      processInput({
        epsg: 4326,
        wkt: wktDraw
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
    if (spatial.json && mapRef.current) {
      // Use the MapLibre map component's visualization method
      mapRef.current.visualizeGeometry(spatial.json);
      
      // Check winding order and show warnings
      checkAndWarnWindingOrder(spatial.json);
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
    <div id="app">

      <Toaster position="top-right" toastOptions={{ duration: 5000 }} />

      <Navbar bg="light" expand="lg">
        <Container fluid>
          <Navbar.Brand href="/">
            Well-known Text (WKT) visualization
          </Navbar.Brand>
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
          />
        </div>

        <div id="controls-container">
          <Container fluid className="p-3 h-100">
            <Form.Group className="mb-3" controlId="wkt">
              <Form.Label>WKT</Form.Label>
              <Form.Control className="font-monospace" as="textarea" rows={12} value={wkt} onChange={handleWktChange} />
            </Form.Group>
            
            <Form.Group className="mb-3" controlId="epsg">
              <Form.Label>EPSG</Form.Label>
              <InputGroup>
                <InputGroup.Text id="basic-addon1">EPSG:</InputGroup.Text>
                <Form.Control value={epsg} onChange={handleEpsgChange} />
              </InputGroup>
            </Form.Group>
            
            {error && <Alert variant="danger">{error}</Alert>}
            
            <div className="d-grid gap-2 mb-3">
              <Button variant="light" onClick={loadExample}>Load example</Button>
              <Button variant="warning" onClick={handleWktClear}>Clear</Button>
              <Dropdown>
                <Dropdown.Toggle variant="light" className="w-100">Copy as</Dropdown.Toggle>
                <Dropdown.Menu className="w-100">
                  {
                    Object.keys(formats).map(format => <Dropdown.Item key={format} disabled={error || !json} onClick={() => handleCopy(format)}>{formats[format]}</Dropdown.Item>)
                  }
                </Dropdown.Menu>
              </Dropdown>
              <Button variant="success" onClick={handleShare}>Share</Button>
            </div>
          </Container>
        </div>
      </div>

      <footer className="footer mt-auto pt-3 pb-3 bg-light">
        <Container fluid>
          <p className="text-muted small">This page parses, visualizes, and shares <a href="https://en.wikipedia.org/wiki/Well-known_text_representation_of_geometry" rel="noreferrer" className="text-muted" target="_blank">WKT</a> (ISO 13249) as well as <a href="https://opengeospatial.github.io/ogc-geosparql/geosparql11/spec.html#_rdfs_datatype_geowktliteral" target="blank" rel="noreferrer" className="text-muted">geo:wktLiteral</a> strings in a variety of coordinate reference systems. Built with <a href="https://openlayers.org/" target="blank" rel="noreferrer" className="text-muted">OpenLayers</a>, <a href="https://maplibre.org/" target="blank" rel="noreferrer" className="text-muted">MapLibre GL JS</a>, <a href="https://trac.osgeo.org/proj4js" target="blank" rel="noreferrer" className="text-muted">Proj4js</a>, <a href="https://github.com/terraformer-js/terraformer" target="blank" rel="noreferrer" className="text-muted">terraformer</a>, and <a href="https://epsg.io/" target="blank" rel="noreferrer" className="text-muted">epsg.io</a>. Use the drawing tools to create your own geometries. Copy as Well-known Binary (WKB) or Extended Well-known Binary (EWKB). Also supports <a href="https://h3geo.org/" rel="noreferrer" className="text-muted" target="_blank">Uber H3</a>, <a href="https://en.wikipedia.org/wiki/Geohash" rel="noreferrer" className="text-muted" target="_blank">Geohash</a>, <a href="https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system" rel="noreferrer" className="text-muted" target="_blank">Quadkey</a>, WKB, and WFS BBOX conversion to WKT.</p>
          <p className="text-muted small">
            Originally created by <Twitter className="mb-1" /> <a rel="noreferrer" className="text-muted" href="https://twitter.com/PieterPrvst" target="_blank">PieterPrvst</a>, forked and further developed by <a rel="noreferrer" className="text-muted" href="https://github.com/meysam-" target="_blank">meysam-</a>
          </p>
        </Container>
      </footer>

    </div>
  );
}

export default App;