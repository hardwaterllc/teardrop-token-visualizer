#!/usr/bin/env node

/**
 * Build script to parse YAML token definitions and extract relationships
 * Generates a JSON file with token graph data for the visualizer
 */
console.log(`
.===================-:                                                           =----+                                                       
-####################+                                                           #####@                       :=-                             
.-----=+#####*+-----=-                                                           #####@                     +=*#*+-                           
       #*####+                                                                   #####%                   +==== +++*                          
       +*####=        #+*=-+=           *=*-=*+#       =++++   #++*     *++==*=  #####%  ++++    *++*   -*+++    *=+++    :####   *++=*+*     
       +*####=     -=+***###*++=     -==+*******+=#   +=***##%*#***+ -==+**#*****###### #****+*++***++ +++=        *#*=+ *+****+*++******+=+  
       +*####=   =**###+=-=+####**  =*###*+==++##*#*- #*###########***#####****#######* *######*####*%*+++         *##**+%*################++ 
       +*####=  ++######   ######*+*+*****    %#####= #*#####*++=+*######*=*+*=+*#####* *######++==-+#**=        -+*######*#####*+--=-=*####*-
       +*####=  =*####%#*+*#@#####* %@@%@%*===*#####* %*######    *#####+*      #*####* *####**+     +#=        **#######%######+      ######=
       +*####=  -#####**+++*******+ ***********####*# @*#####-    +*####*        #####* *####*       -#*       =+##############%        %####=
       +*####=  =#####%***+*#@@@@@@#*####*=+*#*####*# @*#####     +#####*=      #*####* *####*       ++*     ==*########**######%      +#####=
       +*####=  =*####+     #*******######    #####*# @*#####      #######*+ :#=**####* *####*        +**# *+##########**%*####**+*  +**#####=
       +*####=   -*###*+=-=++###*+#*#####*=+-**####*# @*#####      *=*####****#*######* *####*         =+*+*##########** #*######*+==+*####*+:
       +*###*-    -+*#**#####*++:   ++*#####*++**##** @*###**        ==+######**=+####+ *####+          =+*#*####**+=+   **######***####*#*+  
       -----==       =*+===+-+=       +===-==- *-----  =----*          ==+=-+==* *+---= -----+             *======*-     **####* +*=====++    
                                                                                                                         **####+              
                                                                                                                         **####=              
                                                                                                                         **####=              
                                                                                                                         -=----.              

🔍 Building token graph...
`);
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const definitionsDir = path.join(__dirname, '../../../definitions');
const outputFile = path.join(__dirname, '../public/token-graph.json');

// Ensure public directory exists
const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const tokens = new Map();
const references = [];

// Load primitives
function loadPrimitives() {
  const primitivesDir = path.join(definitionsDir, 'primitives');
  if (!fs.existsSync(primitivesDir)) return;

  const files = fs.readdirSync(primitivesDir).filter(f => f.endsWith('.yaml'));
  files.forEach(file => {
    const filePath = path.join(primitivesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(content);
    
    // Parse filename: palette-tokenName.yaml or opacity-baseColor-value.yaml
    let tokenName;
    let opacityValue = null;
    
    if (file.startsWith('opacity-')) {
      const match = file.match(/^opacity-(.+?)-(.+)\.yaml$/);
      if (match) {
        const [, baseColor, value] = match;
        tokenName = `opacity.${baseColor}.${value}`;
        // Store the opacity percentage (the value in the filename)
        opacityValue = parseInt(value, 10);
      }
    } else {
      const match = file.match(/^(.+?)-(.+)\.yaml$/);
      if (match) {
        const [, palette, tokenNamePart] = match;
        tokenName = `${palette}.${tokenNamePart}`;
      }
    }

    if (tokenName) {
      tokens.set(tokenName, {
        id: tokenName,
        name: tokenName,
        type: 'primitive',
        layer: 'primitive',
        color: doc.color,
        palette: doc.palette,
        opacity: opacityValue, // null for regular colors, 0-100 for opacity tokens
        figma: doc.figma
      });
    }
  });
}

// Load semantic and component tokens
function loadSemanticComponents() {
  ['semantic', 'components'].forEach(layer => {
    const layerDir = path.join(definitionsDir, layer);
    if (!fs.existsSync(layerDir)) return;

    const files = fs.readdirSync(layerDir).filter(f => f.endsWith('.yaml'));
    files.forEach(file => {
      const filePath = path.join(layerDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = yaml.load(content);
      
      const tokenName = file.replace('.yaml', '').replace(/-/g, '.');
      
      tokens.set(tokenName, {
        id: tokenName,
        name: tokenName,
        type: doc.type,
        layer: doc.layer || layer,
        description: doc.description,
        modes: doc.modes,
        figma: doc.figma
      });

      // Extract references from modes
      if (doc.modes) {
        Object.entries(doc.modes).forEach(([mode, value]) => {
          if (typeof value === 'string' && !value.startsWith('#')) {
            // This is a reference (e.g., "text.strong" or "purple.3")
            references.push({
              from: tokenName,
              to: value,
              mode: mode
            });
          }
        });
      }
    });
  });
}

// Build graph structure
function buildGraph() {
  const nodes = Array.from(tokens.values());
  const links = [];

  references.forEach(ref => {
    // Check if both tokens exist
    const fromNode = tokens.get(ref.from);
    const toNode = tokens.get(ref.to);

    if (fromNode && toNode) {
      links.push({
        source: ref.from,
        target: ref.to,
        mode: ref.mode,
        type: 'reference'
      });
    }
  });

  return { nodes, links };
}

// Main execution
loadPrimitives();
console.log(`✅ Loaded ${tokens.size} primitive tokens`);

loadSemanticComponents();
console.log(`✅ Loaded ${tokens.size} total tokens`);
console.log(`✅ Found ${references.length} token references`);

const graph = buildGraph();
console.log(`✅ Built graph with ${graph.nodes.length} nodes and ${graph.links.length} links`);

// Write output
fs.writeFileSync(outputFile, JSON.stringify(graph, null, 2), 'utf8');
console.log(`\n✅ Token graph written to: ${outputFile}`);

