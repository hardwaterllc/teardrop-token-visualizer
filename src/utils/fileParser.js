/**
 * Utility functions to parse JSON and TSX files and convert them to graph format
 */

/**
 * Parse a JSON file and convert it to graph format
 * Supports various JSON token formats
 */
export function parseJSONFile(jsonData) {
  try {
    // If it's already in graph format
    if (jsonData.nodes && jsonData.links) {
      return {
        nodes: jsonData.nodes,
        links: jsonData.links,
        availableModes: jsonData.availableModes || extractModesFromGraph(jsonData)
      };
    }

    // If it's a Style Dictionary format (nested structure)
    if (jsonData.color) {
      const graph = convertStyleDictionaryToGraph(jsonData);
      return {
        ...graph,
        availableModes: extractModesFromGraph(graph)
      };
    }

    // If it's a flat token object
    if (typeof jsonData === 'object' && !Array.isArray(jsonData)) {
      const graph = convertFlatTokensToGraph(jsonData);
      return {
        ...graph,
        availableModes: extractModesFromGraph(graph)
      };
    }

    throw new Error('Unsupported JSON format');
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
  return Array.from(modes).sort();
}

/**
 * Extract primitive token names from raw TSX file content
 * Returns a Set of uppercase token names
 */
function extractPrimitiveNamesFromTSX(content) {
  const primitiveNames = new Set();
  // Match lines like:   TOKEN_NAME: /* ... */ '#...',
  const tokenPattern = /^\s+([A-Z_]+):\s*/gm;
  let match;
  while ((match = tokenPattern.exec(content)) !== null) {
    primitiveNames.add(match[1]);
  }
  return primitiveNames;
}

/**
 * Convert kebab-case to UPPER_SNAKE_CASE
 * e.g., "battlenet" -> "BATTLENET", "checkpoint-emojis-primary" -> "CHECKPOINT_EMOJIS_PRIMARY"
 */
function kebabToUpperSnakeCase(str) {
  return str.toUpperCase().replace(/-/g, '_');
}

/**
 * Determine the layer (primitive, semantic, component) based on token name
 * @param {string} tokenName - The token name (can be kebab-case or UPPER_SNAKE_CASE)
 * @param {Set<string>} primitiveNames - Optional set of primitive token names from raw TSX
 */
function determineLayerFromTokenName(tokenName, primitiveNames = null) {
  const name = tokenName.toUpperCase().replace(/-/g, '_');
  
  // If we have a set of primitive names, check if this token is a primitive first
  if (primitiveNames && primitiveNames.has(name)) {
    return 'primitive';
  }
  
  // Semantic tokens start with: background_, border_, text_, icon_, bg, foreground_
  if (name.startsWith('BACKGROUND_') || 
      name.startsWith('BORDER_') || 
      name.startsWith('TEXT_') || 
      name.startsWith('ICON_') || 
      name.startsWith('BG_') || 
      name.startsWith('FOREGROUND_')) {
    return 'semantic';
  }
  
  // Component tokens are typically component-specific (button, input, card, etc.)
  // Common component prefixes
  const componentPrefixes = [
    'BUTTON', 'INPUT', 'CARD', 'MODAL', 'DROPDOWN', 'SELECT', 
    'CHECKBOX', 'RADIO', 'SWITCH', 'TAB', 'TOOLTIP', 'POPOVER',
    'MENU', 'NAV', 'HEADER', 'FOOTER', 'SIDEBAR', 'LIST', 'TABLE',
    'BADGE', 'CHAT', 'CHANNEL', 'CHANNELS', 'CHECKPOINT'
  ];
  
  for (const prefix of componentPrefixes) {
    if (name.startsWith(prefix + '_') || name === prefix) {
      return 'component';
    }
  }
  
  // Raw/Primitive colors - typically uppercase color names like NEUTRAL_64, PRIMARY_600, etc.
  // These are usually simple color names without semantic prefixes
  // If it matches a pattern like COLOR_NAME_NUMBER or is a known color palette name
  const primitivePattern = /^(NEUTRAL|PRIMARY|SECONDARY|SUCCESS|WARNING|ERROR|INFO|RED|BLUE|GREEN|YELLOW|PURPLE|PINK|ORANGE|GRAY|BLACK|WHITE)_\d+$/;
  if (primitivePattern.test(name)) {
    return 'primitive';
  }
  
  // Default to semantic for unknown patterns
  return 'semantic';
}

/**
 * Convert Style Dictionary format to graph format
 */
function convertStyleDictionaryToGraph(sdData) {
  const nodes = [];
  const links = [];
  const tokenMap = new Map();

  // Flatten the nested structure
  function flattenTokens(obj, path = []) {
    Object.keys(obj).forEach(key => {
      const currentPath = [...path, key];
      const value = obj[key];

      if (value && typeof value === 'object' && 'value' in value) {
        // This is a token
        const tokenPath = currentPath.join('.');
        const layer = determineLayerFromTokenName(tokenPath);
        const token = {
          id: tokenPath,
          name: tokenPath,
          type: value.type || 'color',
          layer: layer,
          value: value.value,
          description: value.description,
          mode: value.mode
        };

        // Extract color if it's a hex value
        if (typeof value.value === 'string' && value.value.startsWith('#')) {
          token.color = value.value;
        }

        // Store modes if present
        if (value.mode) {
          if (!token.modes) token.modes = {};
          token.modes[value.mode] = value.value;
        }

        tokenMap.set(tokenPath, token);
        nodes.push(token);
      } else if (value && typeof value === 'object') {
        // Nested object, recurse
        flattenTokens(value, currentPath);
      }
    });
  }

  flattenTokens(sdData);

  // Build links from references
  nodes.forEach(node => {
    if (node.value && typeof node.value === 'string' && node.value.startsWith('{')) {
      // Reference format: {color.purple.3}
      const refPath = node.value.slice(1, -1);
      if (tokenMap.has(refPath)) {
        links.push({
          source: node.id,
          target: refPath,
          type: 'reference',
          mode: node.mode
        });
      }
    }
  });

  return { nodes, links };
}

/**
 * Convert flat token object to graph format
 */
function convertFlatTokensToGraph(flatData) {
  const nodes = [];
  const links = [];
  const tokenMap = new Map();

  Object.keys(flatData).forEach(key => {
    const value = flatData[key];
    const layer = determineLayerFromTokenName(key);
    const token = {
      id: key,
      name: key,
      type: 'color',
      layer: layer,
      value: value
    };

    // Extract color if it's a hex value
    if (typeof value === 'string' && value.startsWith('#')) {
      token.color = value;
    } else if (value && typeof value === 'object') {
      // If value is an object, extract properties
      if (value.value) {
        token.value = value.value;
        if (typeof value.value === 'string' && value.value.startsWith('#')) {
          token.color = value.value;
        }
      }
      if (value.type) token.type = value.type;
      if (value.description) token.description = value.description;
      if (value.modes) token.modes = value.modes;
    }

    tokenMap.set(key, token);
    nodes.push(token);
  });

  // Build links from references
  nodes.forEach(node => {
    if (node.value && typeof node.value === 'string' && node.value.startsWith('{')) {
      const refPath = node.value.slice(1, -1);
      if (tokenMap.has(refPath)) {
        links.push({
          source: node.id,
          target: refPath,
          type: 'reference'
        });
      }
    }
  });

  return { nodes, links };
}

/**
 * Parse a TSX/TS file and extract token definitions
 * Supports various patterns including:
 * - const SemanticColors = { ... } satisfies SemanticColors;
 * - export const tokens = { ... }
 * - const tokens = { ... }
 * - export default { ... }
 */
export function parseTSXFile(content) {
  try {
    // Check if content is valid
    if (!content || typeof content !== 'string') {
      throw new Error('Invalid file content: content is not a string');
    }
    
    // Check if file contains SemanticColors at all (case-insensitive check first)
    const hasSemanticColors = content.includes('SemanticColors') || content.includes('semanticColors') || content.includes('SEMANTIC_COLORS');
    if (!hasSemanticColors) {
      // Check what the file actually contains
      const preview = content.substring(0, 500);
      throw new Error(`File does not contain "SemanticColors". File preview (first 500 chars): ${preview}...`);
    }
    
    // Try to find SemanticColors pattern (const SemanticColors = { ... } satisfies SemanticColors;)
    // First, find the start of SemanticColors - be flexible with whitespace
    const semanticMatch = content.match(/const\s+SemanticColors\s*=\s*\{/);
    if (semanticMatch) {
      const semanticStart = semanticMatch.index;
      const startPos = semanticStart + semanticMatch[0].length - 1; // Position after opening brace
      
      // Find where "satisfies SemanticColors" appears (this tells us where the object ends)
      // Try different variations - search backwards from end of file for better performance
      let satisfiesPos = -1;
      const searchPatterns = [
        '} satisfies SemanticColors;',
        '} satisfies SemanticColors',
        ' satisfies SemanticColors;',
        ' satisfies SemanticColors',
        '\n} satisfies SemanticColors;',
        '\n} satisfies SemanticColors'
      ];
      
      // First try searching from the end (more efficient for large files)
      for (const pattern of searchPatterns) {
        satisfiesPos = content.lastIndexOf(pattern, content.length);
        if (satisfiesPos !== -1 && satisfiesPos > startPos) {
          break;
        }
      }
      
      // If not found, try searching forward from startPos
      if (satisfiesPos === -1) {
        for (const pattern of searchPatterns) {
          satisfiesPos = content.indexOf(pattern, startPos);
          if (satisfiesPos !== -1) {
            break;
          }
        }
      }
      
      // Also check for export const _private as a fallback marker
      const exportPos = content.indexOf('export const _private', semanticStart);
      if (satisfiesPos === -1 && exportPos !== -1) {
        // Use export position as a hint, but still try to find the closing brace
        satisfiesPos = exportPos;
      }
      
      // Now find the matching closing brace by counting braces
      // We'll search from startPos until we find the matching closing brace
      let braceCount = 1; // We already have the opening brace
      let inString = false;
      let stringChar = null;
      let endPos = startPos;
      const maxSearch = satisfiesPos !== -1 ? Math.min(satisfiesPos + 50, content.length) : content.length;
      
      while (endPos < maxSearch && braceCount > 0) {
        const char = content[endPos];
        
        // Handle string detection
        if (!inString && (char === '"' || char === "'")) {
          inString = true;
          stringChar = char;
        } else if (inString && char === stringChar && content[endPos - 1] !== '\\') {
          inString = false;
          stringChar = null;
        }
        
        // Count braces only when not in a string
        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            // If we found the closing brace, we're done
            if (braceCount === 0) {
              endPos++;
              break;
            }
          }
        }
        
        endPos++;
      }
      
      if (braceCount === 0) {
        // Extract the content between braces (excluding the braces themselves)
        const tokensContent = content.substring(startPos + 1, endPos - 1);
        if (tokensContent.trim().length > 0) {
          return convertSemanticColorsToGraph(tokensContent, content);
        }
      }
      
      // Fallback: If brace counting failed, try extracting up to satisfies or export position
      let fallbackEnd = satisfiesPos !== -1 ? satisfiesPos : content.indexOf('export const _private', semanticStart);
      if (fallbackEnd === -1) {
        fallbackEnd = content.length;
      }
      
      // Look for the last } before the end marker
      let searchEnd = fallbackEnd;
      while (searchEnd > startPos && content[searchEnd] !== '}') {
        searchEnd--;
      }
      if (searchEnd > startPos) {
        const tokensContent = content.substring(startPos + 1, searchEnd);
        if (tokensContent.trim().length > 0) {
          return convertSemanticColorsToGraph(tokensContent, content);
        }
      }
    }
    
    // Remove comments for fallback patterns
    const contentWithoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    
    // Try other common patterns
    const patterns = [
      /export\s+(?:const|default)\s+(?:tokens\s*=\s*)?\{[\s\S]*?\}/,
      /const\s+tokens\s*=\s*\{[\s\S]*?\}/,
      /export\s+default\s+\{[\s\S]*?\}/
    ];

    let jsonString = null;
    for (const pattern of patterns) {
      const match = contentWithoutComments.match(pattern);
      if (match) {
        jsonString = match[0];
        // Remove export/const keywords
        jsonString = jsonString.replace(/export\s+(?:const|default)\s+/g, '');
        jsonString = jsonString.replace(/const\s+tokens\s*=\s*/g, '');
        break;
      }
    }

    if (!jsonString) {
      // Provide more helpful error message
      const hasSemanticColors = content.includes('SemanticColors');
      const hasConst = content.includes('const');
      const hasExport = content.includes('export');
      
      let errorMsg = 'Could not find token definitions in TSX file. ';
      if (hasSemanticColors) {
        errorMsg += 'Found "SemanticColors" but could not parse the structure. ';
      }
      if (hasConst) {
        errorMsg += 'Found "const" declarations. ';
      }
      if (hasExport) {
        errorMsg += 'Found "export" statements. ';
      }
      errorMsg += 'Expected format: const SemanticColors = { ... } satisfies SemanticColors;';
      throw new Error(errorMsg);
    }

    // Convert TypeScript object to valid JSON
    // Remove trailing commas
    jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
    // Convert single quotes to double quotes
    jsonString = jsonString.replace(/'/g, '"');
    // Remove type annotations
    jsonString = jsonString.replace(/:\s*\w+(\[\])?/g, ':');
    
    const jsonData = JSON.parse(jsonString);
    return convertFlatTokensToGraph(jsonData);
  } catch (error) {
    throw new Error(`Failed to parse TSX: ${error.message}`);
  }
}

/**
 * Convert underscore-separated token name to dot-separated (lowercase)
 * BACKGROUND_BASE_LOW -> background.base.low
 */
function convertUnderscoreToDot(tokenName) {
  if (!tokenName.includes('_')) return tokenName.toLowerCase();
  return tokenName.toLowerCase().replace(/_/g, '.');
}

/**
 * Convert SemanticColors structure to graph format
 * Handles: { TOKEN_NAME: { category, [Themes.DARK]: {raw, opacity}, ... } }
 * Converts underscore-separated tokens to dot-separated format
 */
function convertSemanticColorsToGraph(tokensContent, fullContent) {
  const nodes = [];
  const links = [];
  const tokenMap = new Map();
  const originalToConvertedMap = new Map(); // Map original names to converted names
  
  // Theme keys map to modes (themes = modes)
  // Map theme names to mode names (lowercase)
  const themeToModeMap = {
    'DARK': 'dark',
    'LIGHT': 'light',
    'MIDNIGHT': 'midnight',
    'DARKER': 'darker'
  };
  const themeKeys = Object.keys(themeToModeMap);
  
  // Clean up the content - remove satisfies clause if present
  tokensContent = tokensContent.trim();
  
  if (!tokensContent || tokensContent.length === 0) {
    throw new Error('Extracted token content is empty. Could not find SemanticColors object content.');
  }
  
  // Parse token definitions - find each token name and its object
  const tokenRegex = /(\w+):\s*\{/g;
  let match;
  const tokenPositions = [];
  
  // Collect all token positions
  while ((match = tokenRegex.exec(tokensContent)) !== null) {
    tokenPositions.push({
      name: match[1],
      start: match.index,
      contentStart: match.index + match[0].length - 1
    });
  }
  
  if (tokenPositions.length === 0) {
    throw new Error(`No tokens found in SemanticColors. Content preview: ${tokensContent.substring(0, 200)}...`);
  }
  
    // Parse each token
  for (let i = 0; i < tokenPositions.length; i++) {
    const tokenPos = tokenPositions[i];
    const nextTokenStart = i < tokenPositions.length - 1 
      ? tokenPositions[i + 1].start 
      : tokensContent.length;
    
    // Extract token content (from opening brace to matching closing brace)
    let braceCount = 0;
    let endPos = tokenPos.contentStart;
    let inString = false;
    let stringChar = null;
    
    while (endPos < nextTokenStart) {
      const char = tokensContent[endPos];
      
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && tokensContent[endPos - 1] !== '\\') {
        inString = false;
        stringChar = null;
      } else if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            endPos++;
            break;
          }
        }
      }
      endPos++;
    }
    
    const tokenContent = tokensContent.substring(tokenPos.contentStart, endPos);
    
    // Convert token name from underscore to dot format
    const convertedName = convertUnderscoreToDot(tokenPos.name);
    originalToConvertedMap.set(tokenPos.name, convertedName);
    
    // Debug logging for BACKGROUND_BASE_LOWER
    const isBackgroundBaseLower = tokenPos.name === 'BACKGROUND_BASE_LOWER';
    if (isBackgroundBaseLower && import.meta.env.DEV) {
      console.log('[Parser] Parsing BACKGROUND_BASE_LOWER:', {
        tokenName: tokenPos.name,
        convertedName,
        tokenContentLength: tokenContent.length,
        tokenContentPreview: tokenContent.substring(0, 200)
      });
    }
    
    // Parse category
    const categoryMatch = tokenContent.match(/category:\s*['"]([^'"]+)['"]/);
    const category = categoryMatch ? categoryMatch[1] : 'generic';
    
    // Extract theme values (themes = modes) and gradient references
    const modes = {};
    const gradientReferences = []; // Store gradient color references
    
    themeKeys.forEach(themeKey => {
      // Match [Themes.KEY]: {raw: '...', opacity: ...}
      // Find the position of [Themes.KEY]:
      const themeKeyPattern = new RegExp(`\\[Themes\\.${themeKey}\\]:\\s*\\{`);
      const themeKeyMatch = tokenContent.match(themeKeyPattern);
      
      if (isBackgroundBaseLower && import.meta.env.DEV) {
        console.log(`[Parser] Checking theme ${themeKey}:`, {
          pattern: themeKeyPattern.toString(),
          matched: !!themeKeyMatch,
          matchIndex: themeKeyMatch?.index,
          tokenContentPreview: tokenContent.substring(0, 300)
        });
      }
      
      if (themeKeyMatch) {
        // themeKeyMatch[0] is something like "[Themes.DARK]: {"
        // The pattern ends with "{", so matchEnd is after the opening brace
        const matchEnd = themeKeyMatch.index + themeKeyMatch[0].length;
        // Start counting from AFTER the opening brace (which is at matchEnd - 1)
        const themeStart = matchEnd;
        // Find the matching closing brace
        let braceCount = 1; // We start with 1 because we're already inside the opening brace
        let inString = false;
        let stringChar = null;
        let themeEnd = themeStart;
        
        // Safety limit to prevent infinite loops (search up to 200 chars ahead)
        const maxSearch = Math.min(themeStart + 200, tokenContent.length);
        
        if (isBackgroundBaseLower && import.meta.env.DEV) {
          console.log(`[Parser] Starting brace counting for ${themeKey}:`, {
            matchEnd,
            themeStart,
            maxSearch,
            contentPreview: tokenContent.substring(themeStart, Math.min(themeStart + 50, tokenContent.length))
          });
        }
        
        while (themeEnd < maxSearch && braceCount > 0) {
          const char = tokenContent[themeEnd];
          
          // Handle string detection
          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && tokenContent[themeEnd - 1] !== '\\') {
            inString = false;
            stringChar = null;
          }
          
          // Count braces only when not in a string
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                themeEnd++;
                break;
              }
            }
          }
          
          themeEnd++;
        }
        
        if (braceCount === 0) {
          // themeStart is after the opening brace, themeEnd is after the closing brace
          const themeContent = tokenContent.substring(themeStart, themeEnd - 1);
          const rawMatch = themeContent.match(/raw:\s*['"]([^'"]+)['"]/);
          const opacityMatch = themeContent.match(/opacity:\s*([\d.]+)/);
          
          if (isBackgroundBaseLower && import.meta.env.DEV) {
            console.log(`[Parser] Parsed theme ${themeKey}:`, {
              themeStart,
              themeEnd,
              themeContent: themeContent,
              rawMatch: !!rawMatch,
              rawValue: rawMatch?.[1],
              opacityMatch: !!opacityMatch,
              opacity: opacityMatch?.[1],
              modeName: themeToModeMap[themeKey]
            });
          }
          
          if (rawMatch) {
            const rawValue = rawMatch[1];
            const opacity = opacityMatch ? parseFloat(opacityMatch[1]) : 1;
            // Map theme to mode name
            const modeName = themeToModeMap[themeKey];
            modes[modeName] = rawValue;
            
            if (isBackgroundBaseLower && import.meta.env.DEV) {
              console.log(`[Parser] Added mode ${modeName} = ${rawValue} for ${tokenPos.name}`);
            }
            
            // Store opacity separately for reference
            if (opacity !== 1) {
              modes[`${modeName}_opacity`] = opacity;
            }
          } else if (isBackgroundBaseLower && import.meta.env.DEV) {
            console.warn(`[Parser] Theme ${themeKey} matched but no raw value found in:`, themeContent);
          }
        } else if (isBackgroundBaseLower && import.meta.env.DEV) {
          console.warn(`[Parser] Theme ${themeKey} matched but brace counting failed. braceCount: ${braceCount}`);
        }
      } else if (isBackgroundBaseLower && import.meta.env.DEV) {
        // Check if the pattern exists in the content at all
        const patternExists = tokenContent.includes(`[Themes.${themeKey}]`);
        console.log(`[Parser] Theme ${themeKey} pattern not matched. Pattern exists in content: ${patternExists}`);
      }
    });
    
    // Parse gradient references if present
    const gradientMatch = tokenContent.match(/gradient:\s*\{([^}]+)\}/);
    if (gradientMatch) {
      const gradientContent = gradientMatch[1];
      // Match color references in gradient (e.g., color: 'WHITE_500' or color: 'gradient.mid')
      const gradientColorPattern = /color:\s*['"]([^'"]+)['"]/g;
      let gradientColorMatch;
      while ((gradientColorMatch = gradientColorPattern.exec(gradientContent)) !== null) {
        const gradientColor = gradientColorMatch[1];
        // Convert gradient color names that use underscores to dots
        const convertedGradientColor = convertUnderscoreToDot(gradientColor);
        gradientReferences.push(convertedGradientColor);
      }
    }
    
    // Create token node with converted name
    // Determine layer based on original token name patterns (before conversion)
    const layer = determineLayerFromTokenName(tokenPos.name);
    
    const token = {
      id: convertedName, // Use converted name as ID
      name: convertedName, // Use converted name
      originalName: tokenPos.name, // Keep original for reference if needed
      type: 'color',
      layer: layer,
      category: category,
      modes: Object.keys(modes).length > 0 ? modes : undefined,
      gradientReferences: gradientReferences.length > 0 ? gradientReferences : undefined
    };
    
    tokenMap.set(convertedName, token);
    // Also map original name to converted name for reference lookups
    tokenMap.set(tokenPos.name, token);
    nodes.push(token);
  }
  
  // Build links from raw references
  // Note: At this stage, we only have semantic tokens, so we can only link to other semantic tokens
  // Links to primitives will be created later in rebuildLinksWithPrimitives
  nodes.forEach(node => {
    if (node.modes) {
      Object.entries(node.modes).forEach(([modeKey, rawValue]) => {
        // Skip opacity entries
        if (modeKey.endsWith('_opacity')) return;
        
        // Convert raw value from underscore to dot format if needed
        const convertedRawValue = convertUnderscoreToDot(rawValue);
        
        // Check if rawValue references another token (try both original and converted)
        if (typeof rawValue === 'string') {
          let targetId = null;
          
          // Strategy 1: Try original name in tokenMap (for semantic tokens that were already parsed)
          // tokenMap contains both converted names and original names as keys
          if (tokenMap.has(rawValue)) {
            const targetNode = tokenMap.get(rawValue);
            targetId = targetNode.id;
          }
          // Strategy 2: Try converted name in tokenMap
          else if (convertedRawValue !== rawValue && tokenMap.has(convertedRawValue)) {
            const targetNode = tokenMap.get(convertedRawValue);
            targetId = targetNode.id;
          }
          // Strategy 3: Check if rawValue matches an originalName of a semantic token
          // This handles cases where a token references another semantic token by its original name
          // e.g., if some token has raw: 'BACKGROUND_BASE_LOWER', we need to find the node with originalName: 'BACKGROUND_BASE_LOWER'
          else {
            const foundNode = nodes.find(n => n.originalName === rawValue);
            if (foundNode) {
              targetId = foundNode.id;
            }
          }
          
          // Only create link if we found a target (skip primitives - they'll be linked later)
          if (targetId) {
            // Check if link already exists to avoid duplicates
            const linkExists = links.some(link => 
              link.source === node.id && 
              link.target === targetId && 
              link.mode === modeKey
            );
            
            if (!linkExists) {
              links.push({
                source: node.id,
                target: targetId,
                type: 'reference',
                mode: modeKey
              });
            }
          }
        }
      });
    }
    
    // Build links from gradient references
    if (node.gradientReferences) {
      node.gradientReferences.forEach(gradientRef => {
        // Try to find the referenced token (could be a primitive or another semantic token)
        let targetId = null;
        
        // Try direct lookup in tokenMap
        if (tokenMap.has(gradientRef)) {
          const targetNode = tokenMap.get(gradientRef);
          targetId = targetNode.id;
        }
        // Try finding by originalName
        else {
          const foundNode = nodes.find(n => n.originalName === gradientRef);
          if (foundNode) {
            targetId = foundNode.id;
          }
        }
        
        if (targetId) {
          // Check if link already exists
          const linkExists = links.some(link => 
            link.source === node.id && 
            link.target === targetId && 
            link.mode === 'gradient'
          );
          
          if (!linkExists) {
            links.push({
              source: node.id,
              target: targetId,
              type: 'reference',
              mode: 'gradient'
            });
          }
        }
      });
    }
  });
  
  // Extract available modes from all tokens (themes = modes)
  const availableModes = new Set();
  nodes.forEach(node => {
    if (node.modes) {
      Object.keys(node.modes).forEach(key => {
        if (!key.endsWith('_opacity')) {
          availableModes.add(key);
        }
      });
    }
  });
  
  return { 
    nodes, 
    links,
    availableModes: Array.from(availableModes).sort()
  };
}

/**
 * Parse primitives file to extract color mappings
 * Primitives file contains raw color names and their hex values
 */
export function parsePrimitivesFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const colorMap = extractPrimitivesFromTSX(content);
        resolve(colorMap);
      } catch (error) {
        reject(new Error(`Failed to parse primitives file: ${error.message}`));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read primitives file'));
    reader.readAsText(file);
  });
}

/**
 * Extract color mappings from primitives TSX file
 * Handles format: COLOR_NAME: [comment] '#hexvalue'
 * Also handles: const RawColors = { COLOR_NAME: '#hexvalue', ... }
 */
function extractPrimitivesFromTSX(content) {
  const colorMap = new Map();
  
  // Validate that this looks like a primitives file
  if (!content.includes('RawColors') && !content.includes('rawColors')) {
    // Check if user accidentally uploaded semantic file as primitives
    if (content.includes('SemanticColors') || content.includes('semanticColors')) {
      throw new Error('Wrong file type: This appears to be a semantic file (contains "SemanticColors"), not a primitives file. Please upload the primitives file (should contain "RawColors").');
    }
    throw new Error('Primitives file does not contain "RawColors". Expected format: const RawColors = { ... }');
  }
  
  // First, try to find the RawColors object pattern
  // Match: const RawColors = { ... } or export const RawColors = { ... }
  const rawColorsMatch = content.match(/(?:export\s+)?const\s+RawColors\s*=\s*\{([\s\S]*?)\}(?:\s*;|\s*export)/);
  
  if (rawColorsMatch) {
    // Extract the content inside RawColors object
    const rawColorsContent = rawColorsMatch[1];
    
    // Match pattern: COLOR_NAME: /* rgb(...) */ '#hexvalue'
    // This pattern handles the comment between the colon and the hex value
    const colorPattern = /(\w+):\s*\/\*[\s\S]*?\*\/\s*['"](#[0-9a-fA-F]{3,8})['"]/g;
    
    let match;
    while ((match = colorPattern.exec(rawColorsContent)) !== null) {
      const colorName = match[1];
      const hexValue = match[2];
      colorMap.set(colorName, hexValue);
    }
  } else {
    // Fallback: try other patterns if RawColors pattern not found
    // Remove comments first
    const contentWithoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    
    // Match patterns like: COLOR_NAME: '#hexvalue' or COLOR_NAME = '#hexvalue'
    const patterns = [
      // Object property: COLOR_NAME: '#hexvalue'
      /(\w+):\s*['"](#[0-9a-fA-F]{3,8})['"]/g,
      // Variable assignment: COLOR_NAME = '#hexvalue'
      /(\w+)\s*=\s*['"](#[0-9a-fA-F]{3,8})['"]/g,
      // Const declaration: const COLOR_NAME = '#hexvalue'
      /const\s+(\w+)\s*=\s*['"](#[0-9a-fA-F]{3,8})['"]/g,
      // Export const: export const COLOR_NAME = '#hexvalue'
      /export\s+const\s+(\w+)\s*=\s*['"](#[0-9a-fA-F]{3,8})['"]/g
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(contentWithoutComments)) !== null) {
        const colorName = match[1];
        const hexValue = match[2];
        colorMap.set(colorName, hexValue);
      }
    });
  }
  
  return colorMap;
}

/**
 * Parse a file based on its type
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
          resolve({ 
            graph: { nodes: graph.nodes, links: graph.links }, 
            fileName: file.name,
            availableModes: graph.availableModes
          });
        } else if (fileName.endsWith('.css')) {
          const graph = parseCSSFile(content);
          resolve({ 
            graph: { nodes: graph.nodes, links: graph.links }, 
            fileName: file.name,
            availableModes: graph.availableModes
          });
        } else if (fileName.endsWith('.tsx') || fileName.endsWith('.ts')) {
          const graph = parseTSXFile(content);
          resolve({ 
            graph: { nodes: graph.nodes, links: graph.links }, 
            fileName: file.name,
            availableModes: graph.availableModes
          });
        } else {
          reject(new Error('Unsupported file type. Please use .json, .css, .ts, or .tsx files.'));
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
 * Create token nodes from primitives color map
 * Converts underscore-separated names to dot-separated format
 */
function createPrimitiveTokensFromColorMap(colorMap) {
  const nodes = [];
  const links = [];
  const seenIds = new Set();
  
  colorMap.forEach((hexValue, colorName) => {
    // Convert primitive token names from underscore to dot format
    const convertedName = convertUnderscoreToDot(colorName);
    
    // Only add the converted token if we haven't seen it
    if (!seenIds.has(convertedName)) {
      const token = {
        id: convertedName, // Use converted name as ID (e.g., 'neutral.69')
        name: convertedName, // Use converted name
        originalName: colorName, // Keep original for reference lookups (e.g., 'NEUTRAL_69')
        type: 'color',
        layer: 'primitive', // All primitives go to primitive layer
        color: hexValue,
        value: hexValue
      };
      nodes.push(token);
      seenIds.add(convertedName);
    }
    // Note: We don't create alias nodes anymore - the nodeMap in rebuildLinksWithPrimitives
    // will handle mapping both original and converted names to the same token
  });
  
  return { nodes, links };
}

/**
 * Rebuild links from semantic tokens to primitive tokens
 * This is needed because links are built before primitives are added
 * Handles both original and converted token names
 */
function rebuildLinksWithPrimitives(nodes, existingLinks) {
  // Preserve all existing links (including semantic-to-semantic links)
  const newLinks = [...existingLinks];
  const nodeMap = new Map();
  
  // Build a comprehensive map of all node IDs
  // Map both converted names and original names for lookup
  nodes.forEach(node => {
    // Map the node's ID
    nodeMap.set(node.id, node);
    
    // Map original name if it exists and is different from ID
    // This is crucial for primitive tokens: 'NEUTRAL_69' -> token with id 'neutral.69'
    if (node.originalName && node.originalName !== node.id) {
      nodeMap.set(node.originalName, node);
    }
    
    // Debug: Log primitive mappings for NEUTRAL_69
    if (import.meta.env.DEV && node.layer === 'primitive' && 
        (node.id === 'neutral.69' || node.originalName === 'NEUTRAL_69')) {
      console.log(`[Parser] Primitive node mapped:`, {
        id: node.id,
        originalName: node.originalName,
        inNodeMap_asId: nodeMap.has(node.id),
        inNodeMap_asOriginal: nodeMap.has(node.originalName)
      });
    }
    
    // Map the converted version of the original name (in case it's different)
    if (node.originalName) {
      const convertedOriginal = convertUnderscoreToDot(node.originalName);
      if (convertedOriginal !== node.originalName && convertedOriginal !== node.id) {
        nodeMap.set(convertedOriginal, node);
      }
    }
    
    // Map the node's name if different from id
    if (node.name && node.name !== node.id) {
      nodeMap.set(node.name, node);
      const convertedName = convertUnderscoreToDot(node.name);
      if (convertedName !== node.name && convertedName !== node.id) {
        nodeMap.set(convertedName, node);
      }
    }
    
    // Map converted version of the ID (for tokens that might not have originalName set)
    const convertedId = convertUnderscoreToDot(node.id);
    if (convertedId !== node.id) {
      nodeMap.set(convertedId, node);
    }
  });
  
  // Rebuild links from semantic tokens to both primitive tokens AND other semantic tokens
  // This ensures all references are properly linked, including semantic-to-semantic connections
  nodes.forEach(node => {
    if (node.modes) {
      Object.entries(node.modes).forEach(([modeKey, rawValue]) => {
        // Skip opacity entries
        if (modeKey.endsWith('_opacity')) return;
        
        if (typeof rawValue === 'string') {
          // Try multiple lookup strategies:
          // 1. Try original name as-is (e.g., 'NEUTRAL_69')
          let targetNode = nodeMap.get(rawValue);
          let targetId = targetNode ? targetNode.id : null;
          
          // Debug logging for background.base.lower
          if (import.meta.env.DEV && node.id === 'background.base.lower') {
            const convertedRawValue = convertUnderscoreToDot(rawValue);
            console.log(`[Parser] Rebuilding link for ${node.id} (mode: ${modeKey}):`, {
              rawValue,
              convertedRawValue,
              step1_inNodeMap: nodeMap.has(rawValue),
              step1_target: nodeMap.get(rawValue)?.id,
              step2_inNodeMapConverted: nodeMap.has(convertedRawValue),
              step2_target: nodeMap.get(convertedRawValue)?.id
            });
          }
          
          // 2. Try converted name (e.g., 'neutral.69')
          if (!targetNode) {
            const convertedRawValue = convertUnderscoreToDot(rawValue);
            targetNode = nodeMap.get(convertedRawValue);
            if (targetNode) {
              targetId = targetNode.id;
            }
          }
          
          // 3. Check if rawValue matches an originalName of a semantic token (e.g., BACKGROUND_BASE_LOWER -> background.base.lower)
          // This is important for semantic-to-semantic token references
          if (!targetNode) {
            const foundNode = nodes.find(n => n.originalName === rawValue);
            if (foundNode) {
              targetNode = foundNode;
              targetId = foundNode.id;
            }
          }
          
          // 3.5. Also check if converted rawValue matches any node's id or originalName
          // This handles cases where the reference might be in a different format
          // e.g., if rawValue is 'background_base_lower', convert to 'background.base.lower' and find it
          if (!targetNode) {
            const convertedRawValue = convertUnderscoreToDot(rawValue);
            const foundNode = nodes.find(n => 
              n.id === convertedRawValue || 
              n.originalName === convertedRawValue ||
              (n.originalName && convertUnderscoreToDot(n.originalName) === convertedRawValue)
            );
            if (foundNode) {
              targetNode = foundNode;
              targetId = foundNode.id;
            }
          }
          
          // 4. Search all nodes directly (fallback if nodeMap didn't work)
          if (!targetNode) {
            const convertedRawValue = convertUnderscoreToDot(rawValue);
            const foundNode = nodes.find(n => {
              // Check if any of the node's identifiers match (exact or converted)
              const nodeIdentifiers = [
                n.id,
                n.name,
                n.originalName,
                convertUnderscoreToDot(n.id),
                n.name ? convertUnderscoreToDot(n.name) : null,
                n.originalName ? convertUnderscoreToDot(n.originalName) : null
              ].filter(Boolean); // Remove null/undefined
              
              return nodeIdentifiers.includes(rawValue) || 
                     nodeIdentifiers.includes(convertedRawValue);
            });
            if (foundNode) {
              targetNode = foundNode;
              targetId = foundNode.id; // Always use the actual token's ID
            }
          }
          
          // 5. Try case-insensitive search as last resort
          if (!targetNode) {
            const convertedRawValue = convertUnderscoreToDot(rawValue);
            const foundNode = nodes.find(n => {
              const nConverted = convertUnderscoreToDot(n.name || n.id || '');
              return nConverted.toLowerCase() === convertedRawValue.toLowerCase() || 
                     n.name?.toLowerCase() === rawValue.toLowerCase() ||
                     n.id?.toLowerCase() === rawValue.toLowerCase() ||
                     n.originalName?.toLowerCase() === rawValue.toLowerCase();
            });
            if (foundNode) {
              targetNode = foundNode;
              targetId = foundNode.id;
            }
          }
          
          if (targetNode && targetId) {
            // Check if link already exists
            const linkExists = newLinks.some(link => 
              link.source === node.id && 
              link.target === targetId && 
              link.mode === modeKey
            );
            
            if (!linkExists) {
              newLinks.push({
                source: node.id,
                target: targetId,
                type: 'reference',
                mode: modeKey
              });
              
              // Debug logging for background.base.lower
              if (import.meta.env.DEV && node.id === 'background.base.lower') {
                console.log(`[Parser] Created link: ${node.id} -> ${targetId} (mode: ${modeKey})`);
              }
            } else if (import.meta.env.DEV && node.id === 'background.base.lower') {
              console.log(`[Parser] Link already exists: ${node.id} -> ${targetId} (mode: ${modeKey})`);
            }
          } else if (import.meta.env.DEV && node.id === 'background.base.lower') {
            console.warn(`[Parser] Failed to find target for ${node.id} (mode: ${modeKey}, rawValue: ${rawValue})`);
          } else if (targetNode && !targetId) {
            // Fallback: if we found the node but targetId wasn't set, use the node's id
            const finalTargetId = targetNode.id;
            const linkExists = newLinks.some(link => 
              link.source === node.id && 
              link.target === finalTargetId && 
              link.mode === modeKey
            );
            
            if (!linkExists) {
              newLinks.push({
                source: node.id,
                target: finalTargetId,
                type: 'reference',
                mode: modeKey
              });
            }
          }
        }
      });
    }
    
    // Rebuild links from gradient references
    if (node.gradientReferences) {
      node.gradientReferences.forEach(gradientRef => {
        // Try to find the referenced token
        let targetNode = nodeMap.get(gradientRef);
        
        // If not found, try converted name
        if (!targetNode) {
          const convertedGradientRef = convertUnderscoreToDot(gradientRef);
          targetNode = nodeMap.get(convertedGradientRef);
        }
        
        // If still not found, search all nodes
        if (!targetNode) {
          const convertedGradientRef = convertUnderscoreToDot(gradientRef);
          targetNode = nodes.find(n => {
            const nodeIdentifiers = [
              n.id,
              n.name,
              n.originalName,
              convertUnderscoreToDot(n.id),
              n.name ? convertUnderscoreToDot(n.name) : null,
              n.originalName ? convertUnderscoreToDot(n.originalName) : null
            ].filter(Boolean);
            
            return nodeIdentifiers.includes(gradientRef) || 
                   nodeIdentifiers.includes(convertedGradientRef);
          });
        }
        
        if (targetNode) {
          const targetId = targetNode.id; // Always use the actual token's ID
          const linkExists = newLinks.some(link => 
            link.source === node.id && 
            link.target === targetId && 
            link.mode === 'gradient'
          );
          
          if (!linkExists) {
            newLinks.push({
              source: node.id,
              target: targetId,
              type: 'reference',
              mode: 'gradient'
            });
          }
        }
      });
    }
  });
  
  return newLinks;
}

/**
 * Fetch and parse TSX files from URLs
 * Returns a promise that resolves to the parsed graph
 */
export async function fetchAndParseTSXFiles(primitivesUrl, semanticUrl) {
  try {
    // Fetch both files in parallel
    const [primitivesResponse, semanticResponse] = await Promise.all([
      fetch(primitivesUrl),
      fetch(semanticUrl)
    ]);

    if (!primitivesResponse.ok) {
      throw new Error(`Failed to fetch primitives file: ${primitivesResponse.statusText}`);
    }
    if (!semanticResponse.ok) {
      throw new Error(`Failed to fetch semantic file: ${semanticResponse.statusText}`);
    }

    const [primitivesContent, semanticContent] = await Promise.all([
      primitivesResponse.text(),
      semanticResponse.text()
    ]);

    // Parse primitives to get color map
    const colorMap = extractPrimitivesFromTSX(primitivesContent);
    
    // Parse semantic file
    const graph = parseTSXFile(semanticContent);
    
    // Create primitive token nodes from the color map
    const primitiveTokens = createPrimitiveTokensFromColorMap(colorMap);
    
    // Combine semantic tokens with primitive tokens
    const combinedNodes = [...graph.nodes, ...primitiveTokens.nodes];
    
    // Rebuild links now that we have all tokens (including primitives)
    const rebuiltLinks = rebuildLinksWithPrimitives(combinedNodes, graph.links);
    
    // Update graph with combined nodes and rebuilt links
    graph.nodes = combinedNodes;
    graph.links = rebuiltLinks;
    
    // Resolve raw color names to hex values using primitives
    if (!graph || !graph.nodes) {
      throw new Error('Failed to parse semantic file: No graph data returned');
    }
    
    graph.nodes.forEach(node => {
      if (node.modes) {
        Object.keys(node.modes).forEach(modeKey => {
          if (modeKey.endsWith('_opacity')) return;
          
          const rawValue = node.modes[modeKey];
          if (typeof rawValue === 'string' && colorMap.has(rawValue)) {
            // Store both the raw reference and resolved color
            node.modes[`${modeKey}_resolved`] = colorMap.get(rawValue);
            // Also set color property if it's a direct color reference
            if (!node.color && colorMap.has(rawValue)) {
              node.color = colorMap.get(rawValue);
            }
          }
        });
      }
    });
    
    // Verification: Check that background.base.lower token exists and has connections
    const backgroundBaseLower = graph.nodes.find(n => 
      n.id === 'background.base.lower' || 
      n.originalName === 'BACKGROUND_BASE_LOWER'
    );
    
    if (backgroundBaseLower) {
      // Verify it has connections to primitives
      const connectionsToPrimitives = graph.links.filter(link => 
        link.source === backgroundBaseLower.id && 
        graph.nodes.some(n => n.id === link.target && n.layer === 'primitive')
      );
      
      // Verify it's being referenced by other tokens (if any)
      const connectionsFromOthers = graph.links.filter(link => 
        link.target === backgroundBaseLower.id
      );
      
      // Check if the primitives it references exist
      const expectedPrimitives = [];
      if (backgroundBaseLower.modes) {
        Object.entries(backgroundBaseLower.modes).forEach(([modeKey, rawValue]) => {
          if (!modeKey.endsWith('_opacity') && typeof rawValue === 'string') {
            const convertedValue = convertUnderscoreToDot(rawValue);
            const primitiveExists = graph.nodes.some(n => 
              n.id === convertedValue || 
              n.id === rawValue ||
              n.originalName === rawValue
            );
            expectedPrimitives.push({
              mode: modeKey,
              rawValue,
              convertedValue,
              exists: primitiveExists,
              foundAs: graph.nodes.find(n => 
                n.id === convertedValue || 
                n.id === rawValue ||
                n.originalName === rawValue
              )?.id
            });
          }
        });
      } else {
        // If no modes, check the raw token definition to see what's wrong
        if (import.meta.env.DEV) {
          console.warn('[Parser] background.base.lower has no modes! Token structure:', {
            id: backgroundBaseLower.id,
            originalName: backgroundBaseLower.originalName,
            hasModes: !!backgroundBaseLower.modes,
            modes: backgroundBaseLower.modes,
            layer: backgroundBaseLower.layer,
            category: backgroundBaseLower.category
          });
        }
      }
      
      // Log verification in dev mode
      if (import.meta.env.DEV) {
        console.log(`[Parser] Verified background.base.lower token:`, {
          id: backgroundBaseLower.id,
          originalName: backgroundBaseLower.originalName,
          hasModes: !!backgroundBaseLower.modes,
          connectionsToPrimitives: connectionsToPrimitives.length,
          connectionsFromOthers: connectionsFromOthers.length,
          modes: backgroundBaseLower.modes,
          expectedPrimitives,
          actualLinks: connectionsToPrimitives.map(link => ({
            target: link.target,
            mode: link.mode,
            targetNode: graph.nodes.find(n => n.id === link.target)
          }))
        });
        
        // Also check if primitives exist
        const primitiveNodes = graph.nodes.filter(n => n.layer === 'primitive');
        const neutral69 = primitiveNodes.find(n => 
          n.id === 'neutral.69' || 
          n.originalName === 'NEUTRAL_69'
        );
        console.log(`[Parser] Primitive check:`, {
          totalPrimitives: primitiveNodes.length,
          neutral69Exists: !!neutral69,
          neutral69Id: neutral69?.id,
          neutral69OriginalName: neutral69?.originalName
        });
      }
    } else if (import.meta.env.DEV) {
      console.warn('[Parser] background.base.lower token not found in parsed nodes');
      // List available background tokens for debugging
      const backgroundTokens = graph.nodes.filter(n => 
        n.id?.includes('background.base') || n.originalName?.includes('BACKGROUND_BASE')
      );
      console.log('[Parser] Available background.base tokens:', backgroundTokens.map(n => ({
        id: n.id,
        originalName: n.originalName
      })));
    }
    
    return {
      graph: { nodes: graph.nodes, links: graph.links },
      fileName: 'Mana Tokens',
      availableModes: graph.availableModes || []
    };
  } catch (error) {
    throw new Error(`Failed to fetch and parse TSX files: ${error.message}`);
  }
}

/**
 * Parse CSS file with CSS custom properties
 * Extracts tokens and their relationships from CSS variables
 * Format: --token-name: var(--referenced-token);
 * Supports theme sections: .theme-dark, .theme-light, etc.
 */
/**
 * Convert HSL string to hex color
 * Handles formats like: "231.429 calc(var(--saturation-factor, 1) * 6.542%) 20.98%"
 * or "231.429 6.542% 20.98%"
 */
function hslToHex(hslString) {
  try {
    // Extract H, S, L values from the HSL string
    // Format: "H calc(...) L%" or "H S% L%"
    // First, extract all numbers (H is first, L is last percentage, S is in between)
    const numbers = hslString.match(/([\d.]+)/g);
    const percentages = hslString.match(/([\d.]+)%/g);
    
    if (!numbers || numbers.length < 2) {
      return null;
    }
    
    // H is the first number
    const h = parseFloat(numbers[0]);
    
    // S is extracted from calc() or as a percentage
    // Look for pattern: calc(var(--saturation-factor, 1) * X%) where X is the saturation
    const calcMatch = hslString.match(/calc\([^)]*\*\s*([\d.]+)%/);
    let s = 0;
    if (calcMatch) {
      s = parseFloat(calcMatch[1]);
    } else if (percentages && percentages.length >= 2) {
      // If no calc(), S is the first percentage
      s = parseFloat(percentages[0].replace('%', ''));
    }
    
    // L is the last percentage
    const l = percentages && percentages.length > 0 
      ? parseFloat(percentages[percentages.length - 1].replace('%', ''))
      : 0;
    
    // Convert HSL to RGB
    const hNorm = h / 360;
    const sNorm = s / 100;
    const lNorm = l / 100;
    
    let r, g, b;
    
    if (sNorm === 0) {
      r = g = b = lNorm; // achromatic
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
      const p = 2 * lNorm - q;
      r = hue2rgb(p, q, hNorm + 1/3);
      g = hue2rgb(p, q, hNorm);
      b = hue2rgb(p, q, hNorm - 1/3);
    }
    
    // Convert to hex
    const toHex = (n) => {
      const hex = Math.round(n * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } catch (error) {
    return null;
  }
}

export function parseCSSFile(content, primitiveNames = null) {
  const nodes = [];
  const links = [];
  const tokenMap = new Map();
  const hslMap = new Map(); // Store HSL values for tokens that reference them
  
  // Theme to mode mapping
  const themeToModeMap = {
    'theme-dark': 'dark',
    'theme-light': 'light',
    'theme-midnight': 'midnight',
    'theme-darker': 'darker'
  };
  
  // Track current theme/mode
  let currentMode = null;
  let inRoot = false;
  
  // Parse CSS - split by lines and process
  const lines = content.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    
    // Check for :root selector
    if (line.match(/^:root\s*\{/)) {
      inRoot = true;
      currentMode = null;
      i++;
      continue;
    }
    
    // Check for theme selector
    const themeMatch = line.match(/^\.(theme-\w+)\s*\{/);
    if (themeMatch) {
      inRoot = false;
      currentMode = themeToModeMap[themeMatch[1]] || null;
      i++;
      continue;
    }
    
    // Check for closing brace (end of theme section or :root)
    if (line === '}') {
      if (inRoot) {
        inRoot = false;
      }
      currentMode = null;
      i++;
      continue;
    }
    
    // Parse CSS custom property: --token-name: value;
    // Match: --token-name: var(--referenced-token);
    // We want the FIRST declaration (before color-mix override)
    const cssVarMatch = line.match(/^--([\w-]+):\s*(.+?);/);
    if (cssVarMatch) {
      const tokenName = cssVarMatch[1];
      const value = cssVarMatch[2].trim();
      
      // Convert token name from kebab-case to dot-separated
      const convertedName = tokenName.replace(/-/g, '.');
      
      // Check if this is an HSL variable (ends with -hsl)
      if (tokenName.endsWith('-hsl')) {
        // Store HSL value for later conversion
        hslMap.set(tokenName, value);
        // Also store the base token name (without -hsl)
        const baseTokenName = tokenName.replace(/-hsl$/, '');
        hslMap.set(baseTokenName + '-hsl', value);
        i++;
        continue;
      }
      
      // Check if this is an HSL reference (e.g., hsl(var(--neutral-69-hsl) / 1))
      const hslVarMatch = value.match(/hsl\(var\(--([\w-]+)\)/);
      if (hslVarMatch) {
        const hslVarName = hslVarMatch[1];
        // Check if this HSL variable exists in our HSL map
        const hslValue = hslMap.get(hslVarName);
        
        if (hslValue) {
          // This is a primitive token that references its own HSL value
          // Convert HSL to hex and store as color
          const hexColor = hslToHex(hslValue);
          
          // Get or create the token node
          let token = tokenMap.get(convertedName);
          if (!token) {
            const layer = determineLayerFromTokenName(tokenName, primitiveNames);
            
            let category = 'generic';
            if (tokenName.startsWith('background-')) category = 'background';
            else if (tokenName.startsWith('border-')) category = 'border';
            else if (tokenName.startsWith('text-')) category = 'text';
            else if (tokenName.startsWith('icon-')) category = 'icon';
            
            token = {
              id: convertedName,
              name: convertedName,
              originalName: tokenName,
              type: 'color',
              layer: layer,
              modes: {},
              category: category
            };
            
            tokenMap.set(convertedName, token);
            nodes.push(token);
          }
          
          // Store the hex color
          if (hexColor && !token.color) {
            token.color = hexColor;
          }
          
          i++;
          continue;
        }
      }
      
      // Extract reference from var() if present
      const varMatch = value.match(/var\(--([\w-]+)\)/);
      if (varMatch) {
        const referencedToken = varMatch[1];
        const convertedReference = referencedToken.replace(/-/g, '.');
        
        // Get or create the token node
        let token = tokenMap.get(convertedName);
        if (!token) {
          // Determine layer based on token name
          const layer = determineLayerFromTokenName(tokenName, primitiveNames);
          
          // Determine category from token name prefix
          let category = 'generic';
          if (tokenName.startsWith('background-')) category = 'background';
          else if (tokenName.startsWith('border-')) category = 'border';
          else if (tokenName.startsWith('text-')) category = 'text';
          else if (tokenName.startsWith('icon-')) category = 'icon';
          
          token = {
            id: convertedName,
            name: convertedName,
            originalName: tokenName,
            type: 'color',
            layer: layer,
            modes: {},
            category: category
          };
          
          tokenMap.set(convertedName, token);
          nodes.push(token);
        }
        
        // Add mode-specific value (use the mode, or 'default' for :root)
        const mode = currentMode || 'default';
        token.modes[mode] = convertedReference;
        
        // Create link if we have a valid reference (for ALL tokens, including semantic-to-semantic)
        if (convertedReference) {
          // Check if link already exists for this mode
          const linkExists = links.some(link => 
            link.source === convertedName && 
            link.target === convertedReference &&
            link.mode === mode
          );
          
          if (!linkExists) {
            links.push({
              source: convertedName,
              target: convertedReference,
              type: 'reference',
              mode: mode
            });
          }
        }
      } else {
        // Value is not a var() reference - might be a direct color value
        // We can still create the token but without a link
        let token = tokenMap.get(convertedName);
        if (!token) {
          const layer = determineLayerFromTokenName(tokenName, primitiveNames);
          
          let category = 'generic';
          if (tokenName.startsWith('background-')) category = 'background';
          else if (tokenName.startsWith('border-')) category = 'border';
          else if (tokenName.startsWith('text-')) category = 'text';
          else if (tokenName.startsWith('icon-')) category = 'icon';
          
          token = {
            id: convertedName,
            name: convertedName,
            originalName: tokenName,
            type: 'color',
            layer: layer,
            modes: {},
            category: category
          };
          
          tokenMap.set(convertedName, token);
          nodes.push(token);
        }
        
        // Check if it's a color value (hsl, hex, etc.)
        if (value.match(/^(hsl|rgb|#)/)) {
          const mode = currentMode || 'default';
          token.modes[mode] = value;
          if (!currentMode) {
            token.color = value;
          }
        }
      }
    }
    
    i++;
  }
  
  // After parsing, convert HSL values to hex colors for primitives
  // First pass: resolve HSL values for tokens that directly have HSL definitions
  nodes.forEach(node => {
    // Check if this token has an HSL value stored (e.g., --neutral-69-hsl)
    const hslKey = node.originalName + '-hsl';
    const hslValue = hslMap.get(hslKey);
    
    if (hslValue && !node.color) {
      // Convert HSL to hex
      const hexColor = hslToHex(hslValue);
      if (hexColor) {
        node.color = hexColor;
      }
    }
  });
  
  // Second pass: resolve colors for tokens that reference HSL tokens
  // For example, --neutral-69 references var(--neutral-69-hsl) via hsl(var(--neutral-69-hsl) / 1)
  nodes.forEach(node => {
    if (!node.color && node.modes) {
      // Check if any mode value references a token that has an HSL value
      Object.keys(node.modes).forEach(mode => {
        const modeValue = node.modes[mode];
        // If mode value is a token reference (not a hex color)
        if (typeof modeValue === 'string' && !modeValue.startsWith('#')) {
          // Find the referenced token
          const referencedToken = nodes.find(n => n.id === modeValue || n.name === modeValue);
          if (referencedToken && referencedToken.color) {
            // If the referenced token has a color, use it
            if (!node.color) {
              node.color = referencedToken.color;
            }
          } else {
            // Try to find HSL value for the referenced token
            const referencedHslKey = modeValue.replace(/\./g, '-') + '-hsl';
            const referencedHslValue = hslMap.get(referencedHslKey);
            if (referencedHslValue && !node.color) {
              const hexColor = hslToHex(referencedHslValue);
              if (hexColor) {
                node.color = hexColor;
              }
            }
          }
        }
      });
    }
  });
  
  // Third pass: recursively resolve colors through the reference chain
  // This handles cases where token A -> token B -> token C (with color)
  const resolveColorRecursive = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;
    
    // If node already has a color, return it
    if (node.color) return node.color;
    
    // If node has modes, try to resolve through references
    if (node.modes) {
      // Try the first available mode (or selected mode if we had one)
      const modeKeys = Object.keys(node.modes);
      for (const mode of modeKeys) {
        const modeValue = node.modes[mode];
        if (typeof modeValue === 'string' && !modeValue.startsWith('#')) {
          const resolvedColor = resolveColorRecursive(modeValue, visited);
          if (resolvedColor) {
            node.color = resolvedColor;
            return resolvedColor;
          }
        }
      }
    }
    
    return null;
  };
  
  // Resolve colors for all nodes that don't have one yet
  nodes.forEach(node => {
    if (!node.color && node.layer === 'primitive') {
      resolveColorRecursive(node.id);
    }
  });
  
  // Extract available modes
  const availableModes = new Set();
  nodes.forEach(node => {
    if (node.modes) {
      Object.keys(node.modes).forEach(mode => {
        availableModes.add(mode);
      });
    }
  });
  
  return {
    nodes,
    links,
    availableModes: Array.from(availableModes).sort()
  };
}

/**
 * Fetch and parse CSS file, using TSX files for structure and CSS for links
 * Returns a promise that resolves to the parsed graph
 */
export async function fetchAndParseCSSFile(cssUrl) {
  try {
    // Get base URL for fetching related files
    const baseUrl = cssUrl.substring(0, cssUrl.lastIndexOf('/'));
    const primitivesUrl = `${baseUrl}/raw-color-definitions.tsx`;
    const semanticUrl = `${baseUrl}/generated-definitions.tsx`;
    
    // Fetch all files in parallel
    const [cssResponse, primitivesResponse, semanticResponse] = await Promise.all([
      fetch(cssUrl),
      fetch(primitivesUrl).catch(() => null), // Don't fail if TSX files aren't available
      fetch(semanticUrl).catch(() => null)
    ]);
    
    if (!cssResponse.ok) {
      throw new Error(`Failed to fetch CSS file: ${cssResponse.statusText}`);
    }
    
    const cssContent = await cssResponse.text();
    
    // If we have TSX files, use them for structure, then apply CSS links
    if (primitivesResponse?.ok && semanticResponse?.ok) {
      const [primitivesContent, semanticContent] = await Promise.all([
        primitivesResponse.text(),
        semanticResponse.text()
      ]);
      
      // Parse TSX files to get nodes with correct structure/layers
      const colorMap = extractPrimitivesFromTSX(primitivesContent);
      const tsxGraph = parseTSXFile(semanticContent);
      const primitiveTokens = createPrimitiveTokensFromColorMap(colorMap);
      
      // Combine TSX nodes (semantic + primitives)
      const tsxNodes = [...tsxGraph.nodes, ...primitiveTokens.nodes];
      
      // Rebuild links with primitives (this connects semantic tokens to primitives)
      // rebuildLinksWithPrimitives expects (nodes, existingLinks)
      const rebuiltLinks = rebuildLinksWithPrimitives(tsxNodes, tsxGraph.links);
      
      const rebuiltGraph = {
        nodes: tsxNodes,
        links: rebuiltLinks
      };
      
      // Now parse CSS to get the links (relationships)
      // We'll use CSS links to update/override the TSX links
      const cssGraph = parseCSSFile(cssContent, null);
      
      // Create a comprehensive map of TSX nodes by various name formats (for matching CSS links)
      const tsxNodeMap = new Map();
      rebuiltGraph.nodes.forEach(node => {
        // Map by id (e.g., "background.base.lower" or "neutral.69")
        tsxNodeMap.set(node.id, node);
        
        // Map by originalName if it exists (e.g., "BACKGROUND_BASE_LOWER" or "NEUTRAL_69")
        if (node.originalName) {
          tsxNodeMap.set(node.originalName, node);
          
          // Convert originalName (UPPER_SNAKE_CASE) to kebab-case, then to dot-separated
          const kebabName = node.originalName.toLowerCase().replace(/_/g, '-');
          const dotName = kebabName.replace(/-/g, '.');
          tsxNodeMap.set(dotName, node);
          
          // Also map the kebab-case version (for CSS variable names like --background-base-lower)
          tsxNodeMap.set(kebabName, node);
        }
        
        // Map by name if different from id
        if (node.name && node.name !== node.id) {
          tsxNodeMap.set(node.name, node);
        }
      });
      
      // Map CSS links to TSX node IDs and merge with TSX links
      // CSS links use dot-separated names (e.g., "background.base.lower" -> "neutral.69")
      // We need to ensure the source and target match TSX node IDs
      const mappedCssLinks = cssGraph.links
        .map(link => {
          // Find the TSX node for the source using multiple lookup strategies
          let sourceNode = tsxNodeMap.get(link.source);
          if (!sourceNode) {
            // Try finding by exact match in nodes
            sourceNode = rebuiltGraph.nodes.find(n => 
              n.id === link.source || 
              n.name === link.source ||
              (n.originalName && n.originalName.toLowerCase().replace(/_/g, '.') === link.source)
            );
          }
          
          // Find the TSX node for the target using multiple lookup strategies
          let targetNode = tsxNodeMap.get(link.target);
          if (!targetNode) {
            // Try finding by exact match in nodes
            targetNode = rebuiltGraph.nodes.find(n => 
              n.id === link.target || 
              n.name === link.target ||
              (n.originalName && n.originalName.toLowerCase().replace(/_/g, '.') === link.target)
            );
          }
          
          // Only include links where both source and target exist in TSX nodes
          if (sourceNode && targetNode) {
            return {
              ...link,
              source: sourceNode.id, // Use TSX node ID
              target: targetNode.id  // Use TSX node ID
            };
          }
          
          // Debug: log unmatched links in dev mode
          if (import.meta.env.DEV && (!sourceNode || !targetNode)) {
            console.warn('[Parser] CSS link could not be matched to TSX nodes:', {
              linkSource: link.source,
              linkTarget: link.target,
              sourceFound: !!sourceNode,
              targetFound: !!targetNode
            });
          }
          
          return null;
        })
        .filter(link => link !== null); // Remove links that don't match TSX nodes
      
      // Merge TSX links with CSS links
      // Use a Set to track unique links (by source, target, and mode)
      const linkSet = new Set();
      const finalLinks = [];
      
      // First, add all TSX links (these include semantic-to-primitive connections)
      rebuiltLinks.forEach(link => {
        const linkKey = `${link.source}->${link.target}${link.mode ? `:${link.mode}` : ''}`;
        if (!linkSet.has(linkKey)) {
          linkSet.add(linkKey);
          finalLinks.push(link);
        }
      });
      
      // Then, add CSS links (these include semantic-to-semantic connections)
      mappedCssLinks.forEach(link => {
        const linkKey = `${link.source}->${link.target}${link.mode ? `:${link.mode}` : ''}`;
        if (!linkSet.has(linkKey)) {
          linkSet.add(linkKey);
          finalLinks.push(link);
        }
      });
      
      // Resolve colors for semantic/component tokens that reference primitives
      // TSX nodes have modes with raw values (e.g., 'NEUTRAL_69'), we need to resolve these to hex colors
      // Use recursive resolution to handle chains (semantic -> semantic -> primitive)
      const resolveColorForNode = (nodeId, visited = new Set()) => {
        if (visited.has(nodeId)) return null;
        visited.add(nodeId);
        
        const node = rebuiltGraph.nodes.find(n => n.id === nodeId);
        if (!node) return null;
        
        // If node already has a color, return it
        if (node.color) return node.color;
        
        // If node has modes, try to resolve through references
        if (node.modes) {
          const modeKeys = Object.keys(node.modes);
          for (const modeKey of modeKeys) {
            if (modeKey.endsWith('_opacity')) continue;
            
            const modeValue = node.modes[modeKey];
            
            // If mode value is a raw color name (e.g., 'NEUTRAL_69'), look it up in colorMap
            if (typeof modeValue === 'string' && colorMap.has(modeValue)) {
              return colorMap.get(modeValue);
            }
            
            // If mode value is a converted token ID (e.g., 'neutral.69'), find the referenced node
            if (typeof modeValue === 'string' && !modeValue.startsWith('#')) {
              // Try to find the referenced node
              const referencedNode = rebuiltGraph.nodes.find(n => 
                n.id === modeValue || 
                n.originalName === modeValue ||
                (n.originalName && convertUnderscoreToDot(n.originalName) === modeValue)
              );
              
              if (referencedNode) {
                // Recursively resolve the referenced node's color
                const resolvedColor = resolveColorForNode(referencedNode.id, visited);
                if (resolvedColor) {
                  return resolvedColor;
                }
              }
              
              // Also try looking up in colorMap using the original name format
              const upperSnakeCase = modeValue.toUpperCase().replace(/\./g, '_');
              if (colorMap.has(upperSnakeCase)) {
                return colorMap.get(upperSnakeCase);
              }
            }
          }
        }
        
        return null;
      };
      
      const finalNodes = rebuiltGraph.nodes.map(node => {
        // Preserve all node properties including color
        const resolvedNode = {
          ...node,
          // Ensure color is preserved (especially for primitives)
          color: node.color || node.value || undefined
        };
        
        // If this is a semantic/component token without a color, try to resolve it recursively
        if (!resolvedNode.color && (node.layer === 'semantic' || node.layer === 'component')) {
          const resolvedColor = resolveColorForNode(node.id);
          if (resolvedColor) {
            resolvedNode.color = resolvedColor;
          }
        }
        
        return resolvedNode;
      });
      
      // Extract available modes from CSS (since CSS has theme information)
      const availableModes = cssGraph.availableModes || tsxGraph.availableModes || [];
      
      return {
        graph: { nodes: finalNodes, links: finalLinks },
        fileName: 'Mana Tokens (TSX + CSS)',
        availableModes: availableModes
      };
    } else {
      // Fallback: parse CSS only (original behavior)
      // Try to fetch raw TSX file to get primitive names
      let primitiveNames = null;
      try {
        const rawTsxUrl = `${baseUrl}/raw-color-definitions.tsx`;
        const rawResponse = await fetch(rawTsxUrl);
        
        if (rawResponse.ok) {
          const rawContent = await rawResponse.text();
          primitiveNames = extractPrimitiveNamesFromTSX(rawContent);
        }
      } catch (err) {
        // If we can't load the raw TSX file, continue without it
        if (import.meta.env.DEV) {
          console.warn('Could not load raw-color-definitions.tsx for primitive detection:', err);
        }
      }
      
      // Parse CSS file with primitive names
      const graph = parseCSSFile(cssContent, primitiveNames);
      
      if (!graph || !graph.nodes) {
        throw new Error('Failed to parse CSS file: No graph data returned');
      }
      
      return {
        graph: { nodes: graph.nodes, links: graph.links },
        fileName: 'Mana Tokens (CSS)',
        availableModes: graph.availableModes || []
      };
    }
  } catch (error) {
    throw new Error(`Failed to fetch and parse CSS file: ${error.message}`);
  }
}

/**
 * Parse TSX files with primitives (for color resolution)
 */
export function parseTSXWithPrimitives(primitivesFile, semanticFile) {
  return Promise.all([
    parsePrimitivesFile(primitivesFile),
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          // Validate content was read
          if (!content || typeof content !== 'string') {
            reject(new Error(`Failed to read semantic file: content is ${typeof content}`));
            return;
          }
          if (content.length === 0) {
            reject(new Error('Semantic file appears to be empty'));
            return;
          }
          // Check if it looks like the right file
          const hasSemanticColors = content.includes('SemanticColors') || content.includes('semanticColors');
          const hasRawColors = content.includes('RawColors') || content.includes('rawColors');
          
          if (!hasSemanticColors) {
            // Check if user accidentally uploaded primitives file as semantic
            if (hasRawColors) {
              reject(new Error(`Wrong file type: This appears to be a primitives file (contains "RawColors"), not a semantic file. Please upload the semantic file (should contain "SemanticColors"). File: ${semanticFile.name}`));
              return;
            }
            reject(new Error(`Semantic file does not contain "SemanticColors". File name: ${semanticFile.name}. Content preview: ${content.substring(0, 200)}...`));
            return;
          }
          const graph = parseTSXFile(content);
          resolve(graph);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read semantic file'));
      reader.readAsText(semanticFile);
    })
  ]).then(([colorMap, graph]) => {
    // Create primitive token nodes from the color map
    const primitiveTokens = createPrimitiveTokensFromColorMap(colorMap);
    
    // Combine semantic tokens with primitive tokens
    const combinedNodes = [...graph.nodes, ...primitiveTokens.nodes];
    
    // Rebuild links now that we have all tokens (including primitives)
    const rebuiltLinks = rebuildLinksWithPrimitives(combinedNodes, graph.links);
    
    // Update graph with combined nodes and rebuilt links
    graph.nodes = combinedNodes;
    graph.links = rebuiltLinks;
    
    // Resolve raw color names to hex values using primitives
    if (!graph || !graph.nodes) {
      throw new Error('Failed to parse semantic file: No graph data returned');
    }
    
    graph.nodes.forEach(node => {
      if (node.modes) {
        Object.keys(node.modes).forEach(modeKey => {
          if (modeKey.endsWith('_opacity')) return;
          
          const rawValue = node.modes[modeKey];
          if (typeof rawValue === 'string' && colorMap.has(rawValue)) {
            // Store both the raw reference and resolved color
            node.modes[`${modeKey}_resolved`] = colorMap.get(rawValue);
            // Also set color property if it's a direct color reference
            if (!node.color && colorMap.has(rawValue)) {
              node.color = colorMap.get(rawValue);
            }
          }
        });
      }
    });
    
    return {
      graph: { nodes: graph.nodes, links: graph.links },
      fileName: `${primitivesFile.name} + ${semanticFile.name}`,
      availableModes: graph.availableModes || []
    };
  }).catch(error => {
    // Provide more context in error message
    throw new Error(`Failed to parse TSX files: ${error.message}`);
  });
}

