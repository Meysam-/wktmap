# WKT Map

A web application for parsing, visualizing, and sharing Well-Known Text (WKT) geometries on interactive maps with support for multiple coordinate reference systems.

## Features

### 🗺️ WKT Visualization
- **Multi-format Support**: Parse and display WKT, WKB, EWKB, GeoJSON, and more
- **Coordinate Systems**: Support for EPSG coordinate reference systems (1024-32767)
 - **Interactive Maps**: Built with MapLibre GL JS for smooth, globe-capable map interactions
- **Vertex Visualization**: Automatically displays polygon and line vertices as colored markers
 - **Vertex Click Highlighting**: Click any numbered vertex marker to highlight the matching coordinate pair in the WKT textarea for faster debugging
- **Multiple Base Layers**: OpenStreetMap, Humanitarian, Esri World Imagery, OpenSeaMap

### 📐 Drawing Tools
- **Polygon Drawing**: Create polygons with interactive drawing tools
- **Line Drawing**: Draw polylines and complex line geometries
- **Rectangle Tool**: Quick rectangle creation
- **Circle Markers**: Place point markers on the map

### 🔄 Format Conversion
- **WKT ↔ WKB**: Convert between Well-Known Text and Well-Known Binary
- **Extended WKB**: Support for EWKB format with SRID information
- **GeoJSON**: Export geometries as GeoJSON format
- **Bounding Box**: Extract BBOX coordinates from geometries

### 🌐 Additional Format Support
- **H3 Hexagons**: Uber H3 cell visualization
- **Geohash**: Geohash string conversion to WKT
- **Quadkey**: Microsoft Bing Maps quadkey support
- **WKB Hex**: Hexadecimal WKB string parsing

### 🔗 Sharing & Export
- **URL Sharing**: Generate shareable URLs for geometries
- **Copy Functions**: One-click copy in multiple formats
- **Persistent Storage**: Cloud storage for shared geometries

## Usage

### Basic WKT Input
1. Enter WKT geometry in the text area:
   ```
   POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))
   ```
2. Specify the EPSG coordinate system (default: 4326)
3. The geometry will be automatically visualized on the map

### Drawing Geometries
1. Use the drawing tools in the top-right corner of the map
2. Select polygon, polyline, or rectangle tools
3. Draw directly on the map
4. The WKT will be automatically generated in the text area

### Vertex Visualization
When geometries are displayed, vertices are shown as colored markers with zero-indexed numbers:
- **Red**: Polygon exterior ring vertices (numbered 0, 1, 2, ...)
- **Orange**: Polygon hole vertices (numbered 0, 1, 2, ...)  
- **Blue**: LineString vertices (numbered 0, 1, 2, ...)

Each vertex displays its index number starting from 0, making it easy to identify specific coordinates in the WKT geometry definition.

#### 🔍 Vertex Click → WKT Coordinate Highlight
With "Show vertex numbers" enabled, clicking any vertex marker will:
1. Focus the WKT textarea
2. Select (highlight) the exact coordinate pair corresponding to that vertex

This works for:
- Single and multi-part geometries (e.g. `GEOMETRYCOLLECTION`, `MULTILINESTRING`, `MULTIPOLYGON`)
- Exterior vs interior rings (holes) – hole vertices highlight their own ring, not the exterior
- Mixed geometry collections (lines + polygons)

Matching is done by coordinate value (with tolerance), so repeated coordinates (e.g. ring closure) intentionally highlight the first occurrence of that literal pair.

If multiple distinct geometries share identical coordinate pairs, the first textual occurrence in the WKT is highlighted (a future enhancement could cycle through matches).

Disable the behavior anytime by unchecking "Show vertex numbers".

### Format Conversion Examples

#### H3 Hexagon
```
u147
```

#### Geohash
```
u4pruydqqvj
```

#### Quadkey
```
023010203
```

#### WKB (Hexadecimal)
```
01010000001343723271CB094047E4BB94BA9A4940
```

#### Bounding Box
```
-10.5,-5.2,15.3,8.7
```

### EPSG Support
The application supports thousands of coordinate reference systems:
- **Geographic**: WGS84 (4326), NAD83 (4269), etc.
- **Projected**: UTM zones, State Plane, etc.
- **Custom**: Any EPSG code from 1024-32767

## API Reference

### Supported Input Formats

| Format | Example | Description |
|--------|---------|-------------|
| WKT | `POINT(0 0)` | Well-Known Text geometry |
| WKB | `01010000...` | Well-Known Binary (hex) |
| EWKB | `0101000020E6100000...` | Extended WKB with SRID |
| GeoJSON | `{"type":"Point"...}` | GeoJSON geometry object |
| H3 | `8f2830828052d25` | Uber H3 cell identifier |
| Geohash | `u4pruydqqvj` | Geohash string |
| Quadkey | `023010203` | Bing Maps quadkey |
| BBOX | `-10,40,10,50` | Bounding box coordinates |

### Output Formats

- **WKT**: Standard Well-Known Text
- **WKB**: Hexadecimal Well-Known Binary
- **EWKB**: Extended WKB with spatial reference
- **GeoJSON**: GeoJSON geometry object
- **BBOX**: Comma-separated bounding box

### URL Parameters

Share geometries using URL parameters:
```
https://wktmap.com?abc12345
```

The hash corresponds to a stored geometry with its EPSG code.

## Development

### Prerequisites
- Node.js 14+ 
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/your-repo/wktmap.git
cd wktmap

# Install dependencies
npm install
```

### Development Server
```bash
# Start development server on port 3006
npm start
```

### Building
```bash
# Create production build
npm run build
```

### Testing
```bash
# Run test suite
npm test
```

### Project Structure
```
src/
├── App.js              # Main React component
├── wkt.js              # WKT parsing and transformation utilities
├── examples.js         # Sample geometries for testing
├── FullscreenControl.js # Leaflet fullscreen control
├── epsg.js             # EPSG coordinate system definitions
├── crs.js              # Coordinate reference system utilities
└── wkt.test.js         # Unit tests
```

## Technologies Used

### Frontend
- **React 18**: Modern React with hooks
- **Leaflet**: Interactive map library
- **React-Leaflet**: React bindings for Leaflet
- **Bootstrap 5**: UI components and styling
- **React Bootstrap**: Bootstrap components for React

### Geospatial Libraries
- **OpenLayers**: WKT parsing and coordinate transformations
- **Proj4js**: Coordinate system projections
- **Terraformer**: Geometry format conversions
- **WKX**: Well-Known Binary processing

### Additional Libraries
- **H3-js**: Uber H3 hexagon processing
- **ngeohash**: Geohash encoding/decoding
- **quadkeytools**: Bing Maps quadkey utilities

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow ESLint configuration
- Add tests for new features
- Update documentation for API changes
- Ensure cross-browser compatibility

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [OpenLayers](https://openlayers.org/) for geometry processing
- Map tiles from [OpenStreetMap](https://www.openstreetmap.org/) contributors
- Coordinate system data from [EPSG.io](https://epsg.io/)
- Projection support via [Proj4js](https://trac.osgeo.org/proj4js/)

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/your-repo/wktmap/issues)
- Documentation: This README and inline code comments
- Examples: Use the "Load Example" button to see sample geometries

---

Visit [wktmap.com](https://wktmap.com) to use the live application.

### Winding Order Validation
The application now includes winding order validation for polygon geometries:
- **Exterior rings** should follow counter-clockwise winding order
- **Interior rings (holes)** should follow clockwise winding order
- **Warning notifications** appear when incorrect winding order is detected
- **Visual indication**: Polygons with incorrect winding order are displayed with red borders and fill instead of the default blue
- **No automatic fixing** - the tool preserves original winding order for debugging purposes

This feature helps debug polygon issues and ensures compliance with OGC Simple Feature standards. The visual highlighting makes it immediately apparent which polygons have winding order problems on the map.
