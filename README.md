# Teardrop Token Visualizer

A standalone, self-hosted interactive graph-based visualizer for exploring design token relationships and connections.

## Features

- 🕸️ **Graph Visualization**: Interactive force-directed graph showing token relationships
- 🔗 **Token Connections**: Visualize how tokens reference each other (e.g., `text.strong` → `neutral.1`)
- 🎨 **Layer Filtering**: Filter by token layer (primitive, semantic, component)
- 🔍 **Search**: Search tokens by name, color, or description
- 🌈 **Mode Switching**: View token relationships for different theme modes
- 📊 **Node Details**: Click nodes to see detailed information and connections
- 📁 **File Upload**: Upload JSON, CSS, or TSX files to visualize your own tokens

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn

### Installation

```bash
cd teardrop-token-visualizer
npm install
```

### Build Token Graph (Optional)

If you have a `public/token-graph.json` file, it will be loaded automatically. Otherwise, you can upload your own token files using the file upload feature in the toolbar.

To build a token graph from YAML definitions (if you have the build script):

```bash
npm run build-graph
```

### Development

Start the development server:

```bash
npm run dev
```

The visualizer will open at `http://localhost:3002`

### Build

Build for production:

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Usage

1. **Upload Token Files**: Use the toolbar to upload JSON, CSS, or TSX files containing your design tokens
2. **View the Graph**: The main view shows all tokens as nodes, with arrows indicating references
3. **Filter by Layer**: Use the layer dropdown to show only primitives, semantic, or component tokens
4. **Search**: Type in the search box to filter tokens by name or value
5. **Switch Modes**: Change the mode dropdown to see relationships for different theme modes
6. **Explore Connections**: Click on any node to see its details and all connections
7. **Interact**: Drag nodes to rearrange, zoom with mouse wheel, pan by dragging background

## Supported File Formats

- **JSON**: Standard JSON format with nodes and links, or Style Dictionary format
- **CSS**: CSS files with custom properties (CSS variables)
- **TSX/TS**: TypeScript files containing token definitions

## Token Graph Structure

The graph shows:
- **Nodes**: Individual tokens (primitives, semantic, components)
- **Links**: References between tokens (e.g., `breadcrumbs.text.default` → `text.strong` → `neutral.1`)

Node colors:
- **Purple**: Primitive tokens
- **Blue**: Semantic tokens
- **Green**: Component tokens

## Technology Stack

- **React 18** - UI framework
- **react-force-graph-2d** - Graph visualization
- **Vite** - Build tool and dev server
- **Radix UI** - UI components

## Project Structure

```
teardrop-token-visualizer/
├── scripts/
│   └── build-graph.js      # Script to parse YAML and build graph JSON (optional)
├── public/
│   └── token-graph.json    # Optional default graph data
├── src/
│   ├── components/
│   │   ├── TokenGraph.jsx  # Main graph visualization component
│   │   ├── Sidebar.jsx      # Sidebar with search and filters
│   │   ├── Toolbar.jsx      # Toolbar with file upload
│   │   └── ...
│   ├── utils/
│   │   └── fileParser.js    # File parsing utilities
│   ├── App.jsx              # Main app component
│   └── main.jsx             # React entry point
├── package.json
├── vite.config.js
└── README.md
```

## License

See LICENSE file for details.

