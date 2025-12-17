/**
 * Utility functions to parse JSON files and convert them to graph format
 * Only handles Style Dictionary format JSON files with explicit layer properties
 */

/**
 * Parse a JSON file and convert it to graph format
 * Supports Style Dictionary format (nested structure with layer properties)
 */
export function parseJSONFile(jsonData) {
  try {
    // Validate input
    if (!jsonData || typeof jsonData !== 'object') {
      throw new Error('Invalid JSON data: expected an object');
    }

    // Extract version property if it exists at the root level
    let version = null;
    if (jsonData.version) {
      if (typeof jsonData.version === 'string') {
        version = jsonData.version;
      } else if (typeof jsonData.version === 'object' && jsonData.version.value) {
        // Handle version as an object with a value property
        version = String(jsonData.version.value);
      }
    }

    // If it's already in graph format
    if (jsonData.nodes && jsonData.links) {
      return {
        nodes: Array.isArray(jsonData.nodes) ? jsonData.nodes : [],
        links: Array.isArray(jsonData.links) ? jsonData.links : [],
        availableModes: jsonData.availableModes || extractModesFromGraph(jsonData),
        version: version || jsonData.version || null,
        allVersions: jsonData.allVersions || (version ? [version] : [])
      };
    }

    // Style Dictionary format (nested structure with layer properties)
    const graph = convertStyleDictionaryToGraph(jsonData);
    return {
      nodes: graph.nodes || [],
      links: graph.links || [],
      availableModes: graph.availableModes || extractModesFromGraph(graph),
      version: version || graph.version || null,
      allVersions: graph.allVersions || (version ? [version] : [])
    };
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error.message}`);
  }
}

/**
 * Extract available modes from a graph
 */
function extractModesFromGraph(graph) {
  const modes = new Set();
  if (graph.nodes) {
    graph.nodes.forEach(node => {
      if (node.modes) {
        Object.keys(node.modes).forEach(key => {
          if (!key.endsWith('_opacity')) {
            modes.add(key);
          }
        });
      }
    });
  }
  // If graph already has availableModes, use those (they come from mode fields)
  if (graph.availableModes && graph.availableModes.length > 0) {
    return graph.availableModes;
  }
  return Array.from(modes).sort();
}

/**
 * Convert Style Dictionary format to graph format
 * Uses explicit layer properties from JSON - no fallback to name-based detection
 */
function convertStyleDictionaryToGraph(sdData) {
  const nodes = [];
  const links = [];
  const tokenMap = new Map();
  const allModes = new Set(); // Collect all unique modes from mode fields

  // Check if an object contains mode entries (keys are mode names and values have 'value' and 'mode' properties)
  function isModeContainer(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;
    // Check if all keys are mode names and all values have 'value' and 'mode' property
    return keys.every(key => {
      const val = obj[key];
      return val && typeof val === 'object' && 'value' in val && 'mode' in val;
    });
  }

  // Check if an object is a simple token (has value, type, layer, description, and no nested mode-like objects)
  function isSimpleToken(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!('value' in obj && 'type' in obj && 'layer' in obj)) return false;
    // Check that it doesn't have nested mode-like objects (objects with 'value' and 'mode' properties)
    const hasNestedModes = Object.keys(obj).some(key => {
      const val = obj[key];
      return val && typeof val === 'object' && 'value' in val && 'mode' in val;
    });
    return !hasNestedModes;
  }

  // Check if an object has a "modes" property with mode entries
  function hasModesProperty(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!('modes' in obj)) return false;
    const modes = obj.modes;
    if (!modes || typeof modes !== 'object') return false;
    // Check if modes contains mode-like objects
    return Object.keys(modes).some(key => {
      const modeData = modes[key];
      return modeData && typeof modeData === 'object' && 'value' in modeData;
    });
  }

  // Flatten the nested structure
  function flattenTokens(obj, path = [], parentLayer = null) {
    Object.keys(obj).forEach(key => {
      const currentPath = [...path, key];
      const value = obj[key];

      if (value && typeof value === 'object') {
        // Check if this object has type/layer but no value, and all children have value+mode (modes structure)
        // Structure: { type: "...", layer: "...", mobile-light: { value: "...", mode: "mobile-light" }, ... }
        const hasTypeOrLayer = ('type' in value || 'layer' in value);
        const hasNoValue = !('value' in value);
        const childKeys = Object.keys(value).filter(k => 
          k !== 'type' && k !== 'layer' && k !== 'description' && k !== 'version' && k !== 'reference'
        );
        const allChildrenAreModes = childKeys.length > 0 && childKeys.every(key => {
          const child = value[key];
          return child && typeof child === 'object' && 'value' in child && 'mode' in child;
        });
        
        if (hasTypeOrLayer && hasNoValue && allChildrenAreModes) {
          const tokenPath = currentPath.join('.');
          const layer = value.layer || parentLayer;
          
          if (!layer) {
            console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
            return;
          }
          
          // Collect modes from children
          const modes = {};
          let tokenType = value.type || 'color';
          let description = value.description || '';
          let defaultValue = null;
          
          childKeys.forEach(key => {
            const modeData = value[key];
            if (modeData && typeof modeData === 'object' && 'value' in modeData && 'mode' in modeData) {
              const modeName = modeData.mode;
              const modeValue = modeData.reference || modeData.value;
              modes[modeName] = modeValue;
              allModes.add(modeName);
              // Use first mode as default, or prefer 'default' mode if it exists
              if (!defaultValue || modeName === 'default') {
                defaultValue = modeValue;
              }
            }
          });
          
          const token = {
            id: tokenPath,
            name: tokenPath,
            type: tokenType,
            layer: layer,
            value: defaultValue,
            description: description,
            modes: modes
          };
          
          // Preserve version property if it exists
          if (value.version && typeof value.version === 'string') {
            token.version = value.version;
          }
          
          // Extract color if it's a hex or rgba value
          if (defaultValue && typeof defaultValue === 'string') {
            if (defaultValue.startsWith('#') || defaultValue.startsWith('rgba(') || defaultValue.startsWith('rgb(')) {
              token.color = defaultValue;
            }
          }
          
          tokenMap.set(tokenPath, token);
          nodes.push(token);
          return; // Don't recurse into this object - we've processed it as a token
        }
        // NEW: Check if this object has a "value" property - if so, it's a token and sibling objects are modes
        // Structure: { value: "...", type: "...", layer: "...", dark: { value: "...", mode: "dark" }, ... }
        else if ('value' in value && typeof value.value !== 'object') {
          const tokenPath = currentPath.join('.');
          const layer = value.layer || parentLayer;
          
          if (!layer) {
            console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
            return;
          }
          
          // Collect modes from sibling objects that have 'value' and 'mode' properties
          const modes = {};
          let tokenType = value.type || 'color';
          let description = value.description || '';
          let defaultValue = value.value;
          
          // Check all keys in the value object for mode variations
          Object.keys(value).forEach(key => {
            if (key !== 'value' && key !== 'type' && key !== 'layer' && key !== 'description' && key !== 'version' && key !== 'reference') {
              const sibling = value[key];
              // If it's an object with 'value' and 'mode' properties, it's a mode variation
              if (sibling && typeof sibling === 'object' && 'value' in sibling && 'mode' in sibling) {
                const modeName = sibling.mode;
                const modeValue = sibling.reference || sibling.value;
                modes[modeName] = modeValue;
                allModes.add(modeName);
              }
            }
          });
          
          const token = {
            id: tokenPath,
            name: tokenPath,
            type: tokenType,
            layer: layer,
            value: defaultValue,
            description: description,
            modes: Object.keys(modes).length > 0 ? modes : undefined
          };
          
          // Preserve version property if it exists
          if (value.version && typeof value.version === 'string') {
            token.version = value.version;
          }
          
          // Extract color if it's a hex or rgba value
          if (defaultValue && typeof defaultValue === 'string') {
            if (defaultValue.startsWith('#') || defaultValue.startsWith('rgba(') || defaultValue.startsWith('rgb(')) {
              token.color = defaultValue;
            }
          }
          
          tokenMap.set(tokenPath, token);
          nodes.push(token);
          return; // Don't recurse into this object - we've processed it as a token
        }
        // Check if this object has a "modes" property (new structure: { modes: {...}, layer: "...", type: "..." })
        // This structure has modes as a sibling of layer/type/description
        else if (value.modes && typeof value.modes === 'object' && ('layer' in value || 'type' in value)) {
          const tokenPath = currentPath.join('.');
          // Layer is at the same level as modes
          const layer = value.layer || parentLayer;
          
          if (!layer) {
            console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
            return;
          }
          
          // Extract modes from the modes object
          const modes = {};
          let tokenType = value.type || 'color';
          let description = value.description || '';
          let defaultValue = null;
          
          Object.keys(value.modes).forEach(modeKey => {
            const modeData = value.modes[modeKey];
            if (modeData && typeof modeData === 'object' && 'value' in modeData) {
              // Always prefer reference if available (preserves token references)
              // Only use value if it's a direct color (hex/rgba) and no reference exists
              const modeValue = modeData.reference || 
                (modeData.value && (modeData.value.startsWith('#') || modeData.value.startsWith('rgba(') || modeData.value.startsWith('rgb(')) 
                  ? modeData.value 
                  : modeData.value);
              modes[modeKey] = modeValue;
              if (modeKey === 'default' || !defaultValue) {
                defaultValue = modeValue;
              }
            }
          });
          
          const token = {
            id: tokenPath,
            name: tokenPath,
            type: tokenType,
            layer: layer,
            value: defaultValue,
            description: description,
            modes: modes
          };

          // Preserve version property if it exists
          if (value.version && typeof value.version === 'string') {
            token.version = value.version;
          }

          // Extract color if it's a hex or rgba value
          if (defaultValue && typeof defaultValue === 'string') {
            if (defaultValue.startsWith('#') || defaultValue.startsWith('rgba(') || defaultValue.startsWith('rgb(')) {
              token.color = defaultValue;
            }
          }

                  tokenMap.set(tokenPath, token);
                  nodes.push(token);
                  return; // Don't recurse into this object
        }
        // Check if this object has a "modes" property (new structure: { modes: {...}, layer: "...", type: "..." })
        else if (hasModesProperty(value)) {
          const tokenPath = currentPath.join('.');
          // Layer is at the same level as modes
          const layer = value.layer || parentLayer;
          
          if (!layer) {
            console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
            return;
          }
          
          // Extract modes from the modes object
          const modes = {};
          let tokenType = value.type || 'color';
          let description = value.description || '';
          let defaultValue = null;
          
          Object.keys(value.modes).forEach(modeKey => {
            const modeData = value.modes[modeKey];
            if (modeData && typeof modeData === 'object' && 'value' in modeData) {
              // Always prefer reference if available (preserves token references)
              // Only use value if it's a direct color (hex/rgba) and no reference exists
              const modeValue = modeData.reference || 
                (modeData.value && (modeData.value.startsWith('#') || modeData.value.startsWith('rgba(') || modeData.value.startsWith('rgb(')) 
                  ? modeData.value 
                  : modeData.value);
              modes[modeKey] = modeValue;
              if (modeKey === 'default' || !defaultValue) {
                defaultValue = modeValue;
              }
            }
          });
          
          const token = {
            id: tokenPath,
            name: tokenPath,
            type: tokenType,
            layer: layer,
            value: defaultValue,
            description: description,
            modes: modes
          };

          // Preserve version property if it exists
          if (value.version && typeof value.version === 'string') {
            token.version = value.version;
          }

          // Extract color if it's a hex or rgba value
          if (defaultValue && typeof defaultValue === 'string') {
            if (defaultValue.startsWith('#') || defaultValue.startsWith('rgba(') || defaultValue.startsWith('rgb(')) {
              token.color = defaultValue;
            }
          }

          tokenMap.set(tokenPath, token);
          nodes.push(token);
        }
        // Check if this is a simple token (no modes)
        else if (isSimpleToken(value) && !isModeContainer(value)) {
          const tokenPath = currentPath.join('.');
          // Use explicit layer property from JSON, fallback to parentLayer only
          const layer = value.layer || parentLayer;
          
          if (!layer) {
            console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
            return;
          }
          
          const token = {
            id: tokenPath,
            name: tokenPath,
            type: value.type || 'color',
            layer: layer,
            value: value.value,
            description: value.description || ''
          };

          // Preserve version property if it exists
          if (value.version && typeof value.version === 'string') {
            token.version = value.version;
          }

          // Extract color if it's a hex or rgba value
          if (typeof value.value === 'string' && (value.value.startsWith('#') || value.value.startsWith('rgba(') || value.value.startsWith('rgb('))) {
            token.color = value.value;
          }

          tokenMap.set(tokenPath, token);
          nodes.push(token);
        }
        // Check if this is a mode container (e.g., { default: {...}, blue: {...} })
        else if (isModeContainer(value)) {
          // This is a token with multiple modes
          const tokenPath = currentPath.join('.');
          
          // Get layer from first mode entry
          const firstModeKey = Object.keys(value)[0];
          const firstModeData = value[firstModeKey];
          // Use explicit layer property from JSON, fallback to parentLayer only
          const layer = firstModeData?.layer || parentLayer;
          
          if (!layer) {
            console.warn(`Token ${tokenPath} has no layer property in any mode and no parent layer. Skipping.`);
            return;
          }
          
          // Collect all modes and extract mode names from mode field
          const modes = {};
          let tokenType = 'color';
          let description = '';
          let defaultColor = null;
          
          Object.keys(value).forEach(modeKey => {
            const modeData = value[modeKey];
            if (modeData && typeof modeData === 'object' && 'value' in modeData && 'mode' in modeData) {
              // Extract the actual mode name from the mode field
              const actualMode = modeData.mode;
              modes[actualMode] = modeData.value;
              allModes.add(actualMode); // Collect unique modes
              
              if (!tokenType && modeData.type) tokenType = modeData.type;
              if (!description && modeData.description) {
                // Clean description: remove mode suffix
                description = modeData.description
                  .replace(/\s*\([^)]*mode\)\s*$/i, '')
                  .trim();
              }
              // Use default mode value as the primary value/color
              if (actualMode === 'default' || !defaultColor) {
                defaultColor = modeData.value;
              }
            }
          });

          const token = {
            id: tokenPath,
            name: tokenPath,
            type: tokenType,
            layer: layer,
            value: defaultColor,
            description: description,
            modes: modes
          };

          // Preserve version property if it exists (check first mode entry)
          // firstModeKey and firstModeData are already declared above
          if (firstModeData && firstModeData.version && typeof firstModeData.version === 'string') {
            token.version = firstModeData.version;
          } else if (value.version && typeof value.version === 'string') {
            token.version = value.version;
          }

          // Extract color if it's a hex or rgba value
          if (defaultColor && typeof defaultColor === 'string' && (defaultColor.startsWith('#') || defaultColor.startsWith('rgba(') || defaultColor.startsWith('rgb('))) {
            token.color = defaultColor;
          }

          tokenMap.set(tokenPath, token);
          nodes.push(token);
        }
        // Check if this object has a value but also nested mode keys (mixed structure)
        else if ('value' in value && 'mode' in value) {
          // This might be a token with a default value and nested modes
          // Check if there are mode keys nested inside
          const hasNestedModes = Object.keys(value).some(k => {
            const val = value[k];
            return val && typeof val === 'object' && 'value' in val && 'mode' in val;
          });
          
          if (hasNestedModes) {
            // Token with default value and nested modes
            const tokenPath = currentPath.join('.');
            // Use explicit layer property from JSON, fallback to parentLayer only
            const layer = value.layer || parentLayer;
            
            if (!layer) {
              console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
              return;
            }
            
            const modes = {};
            // Add the default mode from the parent object
            if (value.mode) {
              modes[value.mode] = value.value;
              allModes.add(value.mode);
            }
            
            // Collect nested modes
            Object.keys(value).forEach(modeKey => {
              const modeData = value[modeKey];
              if (modeData && typeof modeData === 'object' && 'value' in modeData && 'mode' in modeData) {
                const actualMode = modeData.mode;
                modes[actualMode] = modeData.value;
                allModes.add(actualMode);
              }
            });
            
            const token = {
              id: tokenPath,
              name: tokenPath,
              type: value.type || 'color',
              layer: layer,
              value: value.value,
              description: value.description || '',
              modes: modes
            };

            // Preserve version property if it exists
            if (value.version && typeof value.version === 'string') {
              token.version = value.version;
            }

            if (typeof value.value === 'string' && value.value.startsWith('#')) {
              token.color = value.value;
            }

            tokenMap.set(tokenPath, token);
            nodes.push(token);
          } else {
            // Simple token with mode field but no nested modes
            const tokenPath = currentPath.join('.');
            // Use explicit layer property from JSON, fallback to parentLayer only
            const layer = value.layer || parentLayer;
            
            if (!layer) {
              console.warn(`Token ${tokenPath} has no layer property and no parent layer. Skipping.`);
              return;
            }
            
            const token = {
              id: tokenPath,
              name: tokenPath,
              type: value.type || 'color',
              layer: layer,
              value: value.value,
              description: value.description || ''
            };

            // Preserve version property if it exists
            if (value.version && typeof value.version === 'string') {
              token.version = value.version;
            }

            if (value.mode) {
              token.modes = { [value.mode]: value.value };
              allModes.add(value.mode);
            }

            if (typeof value.value === 'string' && value.value.startsWith('#')) {
              token.color = value.value;
            }

            tokenMap.set(tokenPath, token);
            nodes.push(token);
          }
        } else {
          // Nested object, recurse
          // Check if this level has a layer field (for grouping)
          let currentLayer = parentLayer;
          if (value.layer) {
            currentLayer = value.layer;
          }
          
          flattenTokens(value, currentPath, currentLayer);
        }
      }
    });
  }

  // Extract version property if it exists at the root level (before processing)
  let version = null;
  if (sdData && typeof sdData === 'object' && sdData.version && typeof sdData.version === 'string') {
    version = sdData.version;
  }

  flattenTokens(sdData);

  // Collect all unique versions from tokens (for multi-version support)
  const allVersions = new Set();
  if (version) {
    allVersions.add(version);
  }
  nodes.forEach(node => {
    // Check if node has a version property
    if (node.version && typeof node.version === 'string') {
      allVersions.add(node.version);
    }
  });
  
  // If no root-level version but we found versions in tokens, use the most common one as primary
  if (!version && allVersions.size > 0) {
    const versionCounts = new Map();
    nodes.forEach(node => {
      if (node.version && typeof node.version === 'string') {
        const v = node.version;
        versionCounts.set(v, (versionCounts.get(v) || 0) + 1);
      }
    });
    
    if (versionCounts.size > 0) {
      const sortedVersions = Array.from(versionCounts.entries())
        .sort((a, b) => b[1] - a[1]); // Sort by count (descending)
      version = sortedVersions[0][0]; // Use the most common version as primary
    }
  }

  const layersCount = new Map();
          nodes.forEach(node => {
            const layer = node.layer || 'unknown';
            layersCount.set(layer, (layersCount.get(layer) || 0) + 1);
          });

  // Helper function to resolve a reference path to an actual value
  function resolveReference(refPath, visited = new Set()) {
    if (visited.has(refPath)) {
      return null; // Circular reference
    }
    visited.add(refPath);
    
    const token = tokenMap.get(refPath);
    if (!token) {
      return null;
    }
    
    // If token has a direct color value (hex or rgba), return it
    if (token.color) {
      return token.color;
    }
    
    // Check if token value is a direct color (hex or rgba)
    if (token.value && typeof token.value === 'string') {
      if (token.value.startsWith('#') || token.value.startsWith('rgba(') || token.value.startsWith('rgb(')) {
        return token.value;
      }
    }
    
    // If token value is a reference, resolve it
    if (token.value && typeof token.value === 'string' && !token.value.startsWith('#') && !token.value.startsWith('rgba(') && !token.value.startsWith('rgb(')) {
      let resolvedPath = token.value;
      if (resolvedPath.startsWith('{') && resolvedPath.endsWith('}')) {
        resolvedPath = resolvedPath.slice(1, -1);
      }
      if (resolvedPath.startsWith('color.')) {
        resolvedPath = resolvedPath.substring(6);
      }
      const resolved = resolveReference(resolvedPath, visited);
      if (resolved) {
        return resolved;
      }
    }
    
    // Also check mode values for direct colors
    if (token.modes) {
      // Try default mode first
      if (token.modes.default && typeof token.modes.default === 'string') {
        if (token.modes.default.startsWith('#') || token.modes.default.startsWith('rgba(') || token.modes.default.startsWith('rgb(')) {
          return token.modes.default;
        }
      }
      // Try any mode
      for (const modeValue of Object.values(token.modes)) {
        if (modeValue && typeof modeValue === 'string') {
          if (modeValue.startsWith('#') || modeValue.startsWith('rgba(') || modeValue.startsWith('rgb(')) {
            return modeValue;
          }
        }
      }
    }
    
    return null;
  }
  
  // Resolve references to get actual color values for swatches
  // First pass: set color for nodes that already have rgba/rgb/hex values but color wasn't set
  nodes.forEach(node => {
    // If node has a direct color value but color property wasn't set, set it
    if (!node.color && node.value && typeof node.value === 'string') {
      if (node.value.startsWith('#') || node.value.startsWith('rgba(') || node.value.startsWith('rgb(')) {
                node.color = node.value;
              }
    }
  });
  
  // Second pass: resolve references
  nodes.forEach(node => {
    // If node doesn't have a color but has a value that's a reference, try to resolve it
    if (!node.color && node.value && typeof node.value === 'string' && !node.value.startsWith('#') && !node.value.startsWith('rgba(') && !node.value.startsWith('rgb(')) {
              const resolvedColor = resolveReference(node.value);
              if (resolvedColor) {
                node.color = resolvedColor;
              }
    }
    
    // Also check mode values (use default mode first, then any mode)
    if (node.modes && !node.color) {
      // Try default mode first
      if (node.modes.default && typeof node.modes.default === 'string') {
        // If it's a direct color, use it
        if (node.modes.default.startsWith('#') || node.modes.default.startsWith('rgba(') || node.modes.default.startsWith('rgb(')) {
          node.color = node.modes.default;
        } else {
          // Otherwise try to resolve it
                  const resolvedColor = resolveReference(node.modes.default);
                  if (resolvedColor) {
                    node.color = resolvedColor;
                  }
        }
      }
      
      // If still no color, try any mode
      if (!node.color) {
        Object.keys(node.modes).forEach(modeKey => {
          const modeValue = node.modes[modeKey];
          if (modeValue && typeof modeValue === 'string') {
            // If it's a direct color, use it
            if (modeValue.startsWith('#') || modeValue.startsWith('rgba(') || modeValue.startsWith('rgb(')) {
              if (!node.color) {
                node.color = modeValue;
              }
            } else {
              // Otherwise try to resolve it
              const resolvedColor = resolveReference(modeValue);
              if (resolvedColor && !node.color) {
                node.color = resolvedColor;
              }
            }
          }
        });
      }
    }
  });

  // Build links from references
  // First, collect all references from the original JSON structure
  const referenceMap = new Map(); // Map of tokenPath -> Set of tokens that reference it
  
  function collectReferences(obj, path = []) {
    Object.keys(obj).forEach(key => {
      const currentPath = [...path, key];
      const value = obj[key];
      
      if (value && typeof value === 'object') {
        // Check if this has a modes property with references
        if (value.modes && typeof value.modes === 'object') {
          const tokenPath = currentPath.join('.');
          Object.keys(value.modes).forEach(modeKey => {
            const modeData = value.modes[modeKey];
            if (modeData && typeof modeData === 'object') {
              // Always prefer reference field if available, otherwise check value
              // Only create links for token references (not direct colors)
              const refValue = modeData.reference || 
                (modeData.value && typeof modeData.value === 'string' && 
                 !modeData.value.startsWith('#') && 
                 !modeData.value.startsWith('rgba(') && 
                 !modeData.value.startsWith('rgb(') 
                 ? modeData.value 
                 : null);
              
              if (refValue && typeof refValue === 'string') {
                let refPath = refValue;
                if (refPath.startsWith('{') && refPath.endsWith('}')) {
                  refPath = refPath.slice(1, -1);
                }
                // Clean reference path
                if (refPath.startsWith('color.')) {
                  refPath = refPath.substring(6);
                }
                // Only create link if the referenced token exists
                if (tokenMap.has(refPath)) {
                  if (!referenceMap.has(refPath)) {
                    referenceMap.set(refPath, new Set());
                  }
                  referenceMap.get(refPath).add({ source: tokenPath, mode: modeKey });
                }
              }
            }
          });
        }
        // Recurse into nested objects
        collectReferences(value, currentPath);
      }
    });
  }
  
  collectReferences(sdData);
  
  // Create links from the reference map
  referenceMap.forEach((referencers, targetPath) => {
    referencers.forEach(({ source, mode }) => {
      // Forward link: source -> target
      links.push({
        source: source,
        target: targetPath,
        type: 'reference',
        mode: mode
      });
    });
  });
  
  // Also check parsed nodes for references (in case collectReferences missed some)
  nodes.forEach(node => {
    // Check all mode values for references
    const valuesToCheck = node.modes ? Object.values(node.modes) : [node.value];
    valuesToCheck.forEach((val, index) => {
      const mode = node.modes ? Object.keys(node.modes)[index] : node.mode;
      if (val && typeof val === 'string' && !val.startsWith('#') && !val.startsWith('rgba(') && !val.startsWith('rgb(')) {
        // This looks like a reference (not a direct color value)
        // Reference format: {color.purple.3} or just a token name
        let refPath = val;
        if (refPath.startsWith('{') && refPath.endsWith('}')) {
          refPath = refPath.slice(1, -1);
        }
        
        // Clean reference path (remove color. prefix if present)
        if (refPath.startsWith('color.')) {
          refPath = refPath.substring(6);
        }
        
        // Only add if not already added from referenceMap
        const linkExists = links.some(link => 
          link.source === node.id && link.target === refPath && link.mode === mode
        );
        
        if (tokenMap.has(refPath) && !linkExists) {
          links.push({
            source: node.id,
            target: refPath,
            type: 'reference',
            mode: mode
          });
        }
      }
    });
  });
  
  if (links.length === 0) {
    console.warn(`[fileParser] No reference links created! Check if references are being collected correctly.`);
  }

  // Return nodes, links, available modes, version, and all versions
  return { 
    nodes, 
    links,
    availableModes: Array.from(allModes).sort(),
    version: version, // Primary version (root-level or most common)
    allVersions: Array.from(allVersions).sort() // All unique versions found
  };
}

/**
 * Parse a file based on its type (only supports JSON)
 */
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const fileName = file.name.toLowerCase();
        
        if (fileName.endsWith('.json')) {
          const jsonData = JSON.parse(content);
          const graph = parseJSONFile(jsonData);
          
          // Return the full graph structure with all properties
          resolve({ 
            graph: {
              nodes: graph.nodes || [],
              links: graph.links || [],
              availableModes: graph.availableModes || [],
              version: graph.version || null,
              allVersions: graph.allVersions || []
            }, 
            fileName: file.name,
            availableModes: graph.availableModes || [],
            version: graph.version || null,
            allVersions: graph.allVersions || []
          });
        } else {
          reject(new Error('Unsupported file type. Please use .json files only.'));
        }
      } catch (error) {
        reject(new Error(`Failed to parse file: ${error.message}`));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Parse TSX files with primitives (not supported - JSON only)
 * This function is kept for compatibility but will throw an error
 */
export function parseTSXWithPrimitives(primitivesFile, semanticFile) {
  return Promise.reject(new Error('TSX file parsing is not supported. Please use JSON files with explicit layer properties.'));
}

