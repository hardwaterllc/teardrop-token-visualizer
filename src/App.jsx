import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import TokenGraph from './components/TokenGraph';
import Toolbar from './components/Toolbar';
import Minimap from './components/Minimap';
import { parseFile, parseTSXWithPrimitives, parseJSONFile } from './utils/fileParser';
import tokensData from './lib/mana/tokens.json';
import './App.css';

function App() {
  const [selectedMode, setSelectedMode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tokenGraph, setTokenGraph] = useState({ nodes: [], links: [] });
  const [originalTeardropGraph, setOriginalTeardropGraph] = useState(null);
  const [availableModes, setAvailableModes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [panX, setPanX] = useState(380);
  const [panY, setPanY] = useState(130);
  const [zoom, setZoom] = useState(0.7);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverNodeId, setHoverNodeId] = useState('');
  const [currentFileName, setCurrentFileName] = useState(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [interactiveHighlighting, setInteractiveHighlighting] = useState(true);
  const [minimapNodes, setMinimapNodes] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const tokenGraphRef = useRef(null);

  // Load tokens from JSON file (only JSON, no environment switching)
  useEffect(() => {
    setLoading(true);
    
    // Check if we already have the graph cached
    if (originalTeardropGraph) {
      // Use cached version
      setTokenGraph(originalTeardropGraph);
      const modes = originalTeardropGraph.availableModes || [];
      setAvailableModes(modes);
      setSelectedMode(modes.length > 0 ? modes[0] : null);
      setLoading(false);
    } else {
      try {
        // Try to parse the imported tokens.json first
        if (tokensData) {
          const parsed = parseJSONFile(tokensData);
          if (parsed.nodes && parsed.nodes.length > 0) {
            setTokenGraph(parsed);
            setOriginalTeardropGraph(parsed);
            // Use modes from parsed data only
            const modes = parsed.availableModes || [];
            setAvailableModes(modes);
            setSelectedMode(modes.length > 0 ? modes[0] : null);
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Failed to parse tokens.json:', err);
      }

      // Fallback: Try to fetch from public directory, but don't fail if it doesn't exist
      // Users can upload their own JSON file
      const baseUrl = import.meta.env.BASE_URL;
      fetch(`${baseUrl}token-graph.json`)
        .then(res => {
          if (res.ok) {
            return res.json();
          }
          // If file doesn't exist, return empty graph
          return { nodes: [], links: [] };
        })
        .then(data => {
          if (data.nodes && data.nodes.length > 0) {
            setTokenGraph(data);
            setOriginalTeardropGraph(data);
            const modes = data.availableModes || [];
            setAvailableModes(modes);
            setSelectedMode(modes.length > 0 ? modes[0] : null);
          } else {
            // No default graph, user needs to upload
            setTokenGraph({ nodes: [], links: [] });
            setAvailableModes([]);
            setSelectedMode(null);
          }
          setLoading(false);
        })
        .catch(err => {
          if (import.meta.env.DEV) {
            console.log('No default token graph found. Please upload a JSON file.');
          }
          setTokenGraph({ nodes: [], links: [] });
          setAvailableModes([]);
          setSelectedMode(null);
          setLoading(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Natural sort function for token names (handles numeric parts correctly)
  const naturalSort = (a, b) => {
    const aParts = a.name.split('.');
    const bParts = b.name.split('.');
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || '';
      const bPart = bParts[i] || '';
      
      // Try to parse as numbers
      const aNum = parseInt(aPart, 10);
      const bNum = parseInt(bPart, 10);
      
      if (!isNaN(aNum) && !isNaN(bNum)) {
        // Both are numbers, compare numerically
        if (aNum !== bNum) {
          return aNum - bNum;
        }
      } else {
        // At least one is not a number, compare as strings
        if (aPart !== bPart) {
          return aPart.localeCompare(bPart);
        }
      }
    }
    
    return 0;
  };

  // Helper function to extract category prefix from token name
  const getCategoryPrefix = (tokenName) => {
    const firstDot = tokenName.indexOf('.');
    if (firstDot === -1) return tokenName; // No dot, return the whole name
    return tokenName.substring(0, firstDot);
  };

  // Helper function to build hierarchical groups for underscore-separated tokens
  // Returns an array of group paths: ['BACKGROUND', 'BACKGROUND_BASE'] for 'BACKGROUND_BASE_LOWEST'
  const buildUnderscoreGroups = (tokenName) => {
    if (!tokenName.includes('_')) return [];
    const parts = tokenName.split('_');
    const groups = [];
    for (let i = 1; i < parts.length; i++) {
      groups.push(parts.slice(0, i).join('_'));
    }
    return groups;
  };

  // Helper function to build hierarchical groups for dot-separated tokens (2-layer deep)
  // Returns an array of group paths: ['background', 'background.base'] for 'background.base.low'
  // For opacity tokens like 'opacity.black.12', stops before the last part if it's a number
  const buildDotGroups = (tokenName) => {
    if (!tokenName.includes('.')) return [];
    const parts = tokenName.split('.');
    const groups = [];
    
    // Check if the last part is a number (for opacity tokens like opacity.black.12)
    const lastPart = parts[parts.length - 1];
    const isLastPartNumeric = /^\d+$/.test(lastPart);
    
    // If last part is numeric, exclude it from grouping (it's a value, not a group)
    // Otherwise, use normal 2-layer deep logic (max 2 groups: parts[0] and parts[0].parts[1])
    const maxPartsForGroups = isLastPartNumeric ? parts.length - 1 : parts.length;
    const maxGroups = Math.min(maxPartsForGroups, 3); // Max 2 layers = groups at index 1 and 2
    
    // Only create groups up to 2 layers deep (e.g., 'background' and 'background.base')
    // For opacity.black.12, this creates only ['opacity', 'opacity.black'] (not opacity.black.12)
    for (let i = 1; i < maxGroups && i < maxPartsForGroups; i++) {
      groups.push(parts.slice(0, i).join('.'));
    }
    return groups;
  };

  // Helper to check if a token uses underscores (vs dots)
  const usesUnderscores = (tokenName) => {
    return tokenName.includes('_') && !tokenName.includes('.');
  };

  // Organize tokens into layer groups: Components, Semantic, Primitives
  // Group tokens by their prefix (e.g., "radio", "text", "icon")
  const organizedGraph = useMemo(() => {
    // Group nodes by layer
    const nodesByLayer = new Map();
    tokenGraph.nodes.forEach(node => {
      const layer = node.layer || 'global'; // Default to global if no layer
      if (!nodesByLayer.has(layer)) {
        nodesByLayer.set(layer, []);
      }
      nodesByLayer.get(layer).push(node);
    });

    // Create layer parent groups dynamically from layers found in the data
    const layerGroups = [];
    // Preferred order for layers that exist in the data
    const preferredOrder = ['primitive', 'global', 'semantic', 'shared', 'component'];
    const layerNames = {
      'primitive': 'Primitives',
      'global': 'Global',
      'semantic': 'Semantic',
      'shared': 'Shared',
      'component': 'Components'
    };

    // Helper function to format layer name
    const formatLayerName = (layer) => {
      if (layerNames[layer]) {
        return layerNames[layer];
      }
      // Capitalize first letter
      return layer.charAt(0).toUpperCase() + layer.slice(1);
    };

    // Get all layers that actually have nodes
    const existingLayers = Array.from(nodesByLayer.keys()).filter(layer => {
      const nodes = nodesByLayer.get(layer) || [];
      return nodes.length > 0;
    });

    // Sort existing layers according to preferred order, then add any others
    const sortedLayers = [];
    preferredOrder.forEach(layer => {
      if (existingLayers.includes(layer)) {
        sortedLayers.push(layer);
      }
    });
    
    // Add any layers not in preferred order
    existingLayers.forEach(layer => {
      if (!preferredOrder.includes(layer)) {
        sortedLayers.push(layer);
      }
    });

    // Create layer groups in the sorted order
    sortedLayers.forEach(layer => {
      const nodes = nodesByLayer.get(layer) || [];
      if (nodes.length > 0) {
        const layerGroup = {
          id: `layer:${layer}`,
          name: formatLayerName(layer),
          type: 'layer-group',
          layer: layer,
          isLayerGroup: true,
          childCount: nodes.length
        };
        layerGroups.push(layerGroup);
      }
    });

    // Create a map of layer to layer group ID for easy lookup
    const layerToLayerGroupId = new Map();
    layerGroups.forEach(lg => {
      layerToLayerGroupId.set(lg.layer, lg.id);
    });
    
    // Helper function to get layer group ID for a layer
    const getLayerGroupId = (layer) => {
      return layerToLayerGroupId.get(layer) || `layer:${layer}`;
    };

    // Get nodes by layer for processing
    const componentNodes = nodesByLayer.get('component') || [];
    const primitiveNodes = nodesByLayer.get('primitive') || [];
    
    // Get all other layers (global, shared, semantic, etc.) - any layer that's not primitive or component
    const otherLayers = Array.from(nodesByLayer.keys()).filter(layer => 
      layer !== 'primitive' && layer !== 'component'
    );
    
    // Process each other layer (global, shared, etc.)
    const layerNodesMap = new Map();
    otherLayers.forEach(layer => {
      const nodes = nodesByLayer.get(layer) || [];
      nodes.sort(naturalSort);
      layerNodesMap.set(layer, nodes);
    });
    
    // Sort nodes
    componentNodes.sort(naturalSort);
    primitiveNodes.sort(naturalSort);

    // Group component tokens by prefix (e.g., "radio", "button", etc.)
    // Handle both dot-separated and underscore-separated tokens
    const componentCategoryGroups = new Map();
    const componentUnderscoreGroups = new Map(); // For one-level underscore groups
    const componentDotGroups = new Map(); // For one-level dot groups
    componentNodes.forEach(node => {
      if (usesUnderscores(node.name)) {
        // For underscore-separated tokens, only use the first part as the group
        const rootCategory = node.name.split('_')[0];
        if (!componentUnderscoreGroups.has(rootCategory)) {
          componentUnderscoreGroups.set(rootCategory, {
            id: `group:component:${rootCategory}`,
            name: rootCategory,
            fullPath: rootCategory,
            parentPath: null,
            tokens: [],
            level: 0
          });
        }
        componentUnderscoreGroups.get(rootCategory).tokens.push(node);
      } else if (node.name.includes('.') && !node.name.includes('_')) {
        // For dot-separated tokens, only use the first part as the group
        // e.g., "button.background.primary.default" -> group "button"
        const rootCategory = node.name.split('.')[0];
        if (!componentDotGroups.has(rootCategory)) {
          componentDotGroups.set(rootCategory, {
            id: `group:component:${rootCategory}`,
            name: rootCategory,
            fullPath: rootCategory,
            parentPath: null,
            tokens: [],
            level: 0
          });
        }
        componentDotGroups.get(rootCategory).tokens.push(node);
      } else {
        // Single part token, use category grouping
        const category = getCategoryPrefix(node.name);
        if (!componentCategoryGroups.has(category)) {
          componentCategoryGroups.set(category, []);
        }
        componentCategoryGroups.get(category).push(node);
      }
    });

    // Helper function to process tokens for any layer (global, shared, semantic, etc.)
    // Only creates one level of groups - all tokens go directly under the top-level group
    const processLayerTokens = (layerName, nodes) => {
      const categoryGroups = new Map();
      const underscoreGroups = new Map();
      const dotGroups = new Map();
      
      nodes.forEach(node => {
        if (usesUnderscores(node.name)) {
          // For underscore-separated tokens, only use the first part as the group
          const rootCategory = node.name.split('_')[0];
          if (!underscoreGroups.has(rootCategory)) {
            underscoreGroups.set(rootCategory, {
              id: `group:${layerName}:${rootCategory}`,
              name: rootCategory,
              fullPath: rootCategory,
              parentPath: null,
              tokens: [],
              level: 0
            });
          }
          underscoreGroups.get(rootCategory).tokens.push(node);
        } else if (node.name.includes('.') && !node.name.includes('_')) {
          // For dot-separated tokens, only use the first part as the group
          // e.g., "input.border.active" -> group "input"
          const rootCategory = node.name.split('.')[0];
          if (!dotGroups.has(rootCategory)) {
            dotGroups.set(rootCategory, {
              id: `group:${layerName}:${rootCategory}`,
              name: rootCategory,
              fullPath: rootCategory,
              parentPath: null,
              tokens: [],
              level: 0
            });
          }
          dotGroups.get(rootCategory).tokens.push(node);
        } else {
          // Single part token, use category grouping
          const category = getCategoryPrefix(node.name);
          if (!categoryGroups.has(category)) {
            categoryGroups.set(category, []);
          }
          categoryGroups.get(category).push(node);
        }
      });
      
      return { categoryGroups, underscoreGroups, dotGroups };
    };
    
    // Process all other layers (global, shared, semantic, etc.) separately
    const allLayerGroups = new Map(); // Map of layerName -> { categoryGroups, underscoreGroups, dotGroups, categoryNodes, dotGroupNodes, underscoreGroupNodes }
    layerNodesMap.forEach((nodes, layerName) => {
      const groups = processLayerTokens(layerName, nodes);
      allLayerGroups.set(layerName, groups);
    });
    
    // Create group nodes for each layer
    const allLayerCategoryNodes = [];
    const allLayerDotGroupNodes = [];
    const allLayerUnderscoreGroupNodes = [];
    
    allLayerGroups.forEach((groups, layerName) => {
      // Category nodes for this layer
      const categoryNodes = Array.from(groups.categoryGroups.entries()).map(([category, tokens]) => ({
        id: `category:${category}`,
        name: category,
        type: 'category-group',
        layer: layerName,
        category: category,
        isGroup: true,
        layerGroupId: getLayerGroupId(layerName),
        childCount: tokens.length
      }));
      allLayerCategoryNodes.push(...categoryNodes);
      
      // Dot group nodes for this layer (only one level, no nested groups)
      const dotGroupNodes = Array.from(groups.dotGroups.values()).map(group => {
        return {
          id: group.id,
          name: group.name,
          type: 'category-group',
          layer: layerName,
          category: group.fullPath,
          isGroup: true,
          layerGroupId: getLayerGroupId(layerName),
          parentGroupId: null,
          childCount: group.tokens.length,
          level: 0
        };
      });
      allLayerDotGroupNodes.push(...dotGroupNodes);
      
      // Underscore group nodes for this layer (only one level, no nested groups)
      const underscoreGroupNodes = Array.from(groups.underscoreGroups.values()).map(group => {
        return {
          id: group.id,
          name: group.name,
          type: 'category-group',
          layer: layerName,
          category: group.fullPath,
          isGroup: true,
          layerGroupId: getLayerGroupId(layerName),
          parentGroupId: null,
          childCount: group.tokens.length,
          level: 0
        };
      });
      allLayerUnderscoreGroupNodes.push(...underscoreGroupNodes);
    });
    
    // Note: allLayerGroups contains groups for all non-primitive, non-component layers (global, shared, etc.)
    // Build a combined category groups map for backward compatibility (used in filtering/search)
    const semanticCategoryGroups = new Map();
    allLayerGroups.forEach((groups, layerName) => {
      groups.categoryGroups.forEach((tokens, category) => {
        semanticCategoryGroups.set(category, tokens);
      });
    });

    // Separate opacity tokens from other primitives
    // Opacity tokens are structured as opacity.black.0, opacity.white.4, etc.
    const opacityNodes = primitiveNodes.filter(n => n.name.startsWith('opacity.'));
    const colorNodes = primitiveNodes.filter(n => !n.name.startsWith('opacity.'));
    
    // Group color primitives by palette (extract from token name like "blue.1" -> palette "blue")
    // Handle both dot-separated and underscore-separated tokens
    const primitiveGroups = new Map();
    const primitiveUnderscoreGroups = new Map(); // For hierarchical underscore groups
    colorNodes.forEach(node => {
      if (usesUnderscores(node.name)) {
        // For underscore-separated tokens, build hierarchical groups
        const groups = buildUnderscoreGroups(node.name);
        if (groups.length > 0) {
          // Create all group levels
          groups.forEach((groupPath, index) => {
            if (!primitiveUnderscoreGroups.has(groupPath)) {
              // Display name: show the full path for clarity
              primitiveUnderscoreGroups.set(groupPath, {
                id: `group:primitive:${groupPath}`,
                name: groupPath, // Show full path for clarity
                fullPath: groupPath,
                parentPath: index > 0 ? groups[index - 1] : null,
                tokens: [],
                level: index
              });
            }
          });
          // Add token to the deepest group (last one)
          const deepestGroup = groups[groups.length - 1];
          primitiveUnderscoreGroups.get(deepestGroup).tokens.push(node);
        } else {
          // Single part token, extract palette from name
          const palette = node.name.split('_')[0] || 'other';
          if (!primitiveGroups.has(palette)) {
            primitiveGroups.set(palette, []);
          }
          primitiveGroups.get(palette).push(node);
        }
      } else {
        // Dot-separated tokens: extract palette from first part (e.g., "blue.1" -> "blue")
        const parts = node.name.split('.');
        const palette = parts[0] || 'other';
        if (!primitiveGroups.has(palette)) {
          primitiveGroups.set(palette, []);
        }
        primitiveGroups.get(palette).push(node);
      }
    });
    
    // Group opacity tokens hierarchically (e.g., opacity -> opacity.black -> opacity.black.12)
    // But exclude the last part if it's numeric (it's a value, not a group)
    const opacityGroups = new Map();
    opacityNodes.forEach(node => {
      // Use buildDotGroups which already handles excluding numeric last parts
      const groups = buildDotGroups(node.name);
      if (groups.length > 0) {
        // Create all group levels
        groups.forEach((groupPath, index) => {
          if (!opacityGroups.has(groupPath)) {
            opacityGroups.set(groupPath, {
              id: `group:opacity:${groupPath}`,
              name: groupPath,
              fullPath: groupPath,
              parentPath: index > 0 ? groups[index - 1] : null,
              tokens: [],
              level: index
            });
          }
        });
        // Add token to the deepest group (last one)
        const deepestGroup = groups[groups.length - 1];
        opacityGroups.get(deepestGroup).tokens.push(node);
      } else {
        // Single part token (shouldn't happen for opacity tokens, but handle it)
        const palette = 'other';
        if (!opacityGroups.has(palette)) {
          opacityGroups.set(palette, {
            id: `group:opacity:${palette}`,
            name: palette,
            fullPath: palette,
            parentPath: null,
            tokens: [],
            level: 0
          });
        }
        opacityGroups.get(palette).tokens.push(node);
      }
    });
    
    // Create opacity group nodes
    const opacityGroupNodes = Array.from(opacityGroups.values()).map(group => {
      // Count child groups (groups that have this group as parent)
      const childGroupsCount = Array.from(opacityGroups.values()).filter(
        g => g.parentPath === group.fullPath
      ).length;
      
      return {
        id: group.id,
        name: group.name,
        type: 'group',
        layer: 'primitive',
        category: group.fullPath,
        isGroup: true,
        layerGroupId: group.parentPath ? `group:opacity:${group.parentPath}` : getLayerGroupId('primitive'),
        parentGroupId: group.parentPath ? `group:opacity:${group.parentPath}` : null,
        childCount: group.tokens.length + childGroupsCount,
        level: group.level
      };
    });
    
    // Keep the old opacityPaletteGroups for backward compatibility with existing code
    // But now we'll use opacityGroups for hierarchical grouping
    const opacityPaletteGroups = new Map();
    opacityNodes.forEach(node => {
      // Extract palette from opacity.black.12 -> "black" (second part)
      const parts = node.name.split('.');
      const palette = parts.length >= 2 ? parts[1] : 'other';
      if (!opacityPaletteGroups.has(palette)) {
        opacityPaletteGroups.set(palette, []);
      }
      opacityPaletteGroups.get(palette).push(node);
    });

    // Create category group nodes for components
    const componentCategoryNodes = Array.from(componentCategoryGroups.entries()).map(([category, tokens]) => ({
      id: `category:${category}`,
      name: category,
      type: 'category-group',
      layer: 'component',
      category: category,
      isGroup: true,
      layerGroupId: getLayerGroupId('component'),
      childCount: tokens.length
    }));

    // Create hierarchical group nodes for dot-separated component tokens
    const componentDotGroupNodes = Array.from(componentDotGroups.values()).map(group => {
      // Only one level, no nested groups
      return {
        id: group.id,
        name: group.name,
        type: 'category-group',
        layer: 'component',
        category: group.fullPath,
        isGroup: true,
        layerGroupId: getLayerGroupId('component'),
        parentGroupId: null,
        childCount: group.tokens.length,
        level: 0
      };
    });

    // Use the group nodes created for all layers above
    const semanticCategoryNodes = allLayerCategoryNodes;
    const semanticDotGroupNodes = allLayerDotGroupNodes;
    const semanticUnderscoreGroupNodes = allLayerUnderscoreGroupNodes;

    // Create group nodes for underscore-separated component tokens (only one level)
    const componentUnderscoreGroupNodes = Array.from(componentUnderscoreGroups.values()).map(group => {
      return {
        id: group.id,
        name: group.name,
        type: 'category-group',
        layer: 'component',
        category: group.fullPath,
        isGroup: true,
        layerGroupId: getLayerGroupId('component'),
        parentGroupId: null,
        childCount: group.tokens.length,
        level: 0
      };
    });

    // Create hierarchical group nodes for underscore-separated primitive tokens
    // Calculate childCount including both direct tokens and child groups
    const primitiveUnderscoreGroupNodes = Array.from(primitiveUnderscoreGroups.values()).map(group => {
      // Count child groups (groups that have this group as parent)
      const childGroupsCount = Array.from(primitiveUnderscoreGroups.values()).filter(
        g => g.parentPath === group.fullPath
      ).length;
      return {
        id: group.id,
        name: group.name,
        type: 'group',
        layer: 'primitive',
        category: group.fullPath,
        isGroup: true,
        layerGroupId: group.parentPath ? `group:primitive:${group.parentPath}` : getLayerGroupId('primitive'),
        parentGroupId: group.parentPath ? `group:primitive:${group.parentPath}` : null,
        childCount: group.tokens.length + childGroupsCount,
        level: group.level
      };
    });

    // No intermediate opacity group - opacity tokens are grouped hierarchically and linked directly to primitive layer
    
    // Create palette group nodes for color primitives
    const paletteGroupNodes = Array.from(primitiveGroups.entries()).map(([palette, tokens]) => ({
      id: `group:${palette}`,
      name: palette,
      type: 'group',
      layer: 'primitive',
      palette: palette,
      isGroup: true,
      layerGroupId: getLayerGroupId('primitive'),
      childCount: tokens.length
    }));

    // Create links from layer groups to category groups
    const layerLinks = [];
    
    // Components layer group links to category groups
    componentCategoryNodes.forEach(group => {
      layerLinks.push({
        source: getLayerGroupId('component'),
        target: group.id,
        type: 'layer-group-member'
      });
    });

    // All other layers (global, shared, semantic, etc.) layer group links to category groups
    semanticCategoryNodes.forEach(group => {
      layerLinks.push({
        source: getLayerGroupId(group.layer),
        target: group.id,
        type: 'layer-group-member'
      });
    });

    // Component layer group links to dot groups (root level only)
    componentDotGroupNodes.forEach(group => {
      if (!group.parentGroupId) {
        layerLinks.push({
          source: getLayerGroupId('component'),
          target: group.id,
          type: 'layer-group-member'
        });
      }
    });

    // All other layers (global, shared, semantic, etc.) layer group links to dot groups (root level only)
    semanticDotGroupNodes.forEach(group => {
      if (!group.parentGroupId) {
        layerLinks.push({
          source: getLayerGroupId(group.layer),
          target: group.id,
          type: 'layer-group-member'
        });
      }
    });

    // Primitives layer group links directly to root opacity groups (only root level, not nested)
    opacityGroupNodes.forEach(group => {
      if (!group.parentGroupId) {
        layerLinks.push({
          source: getLayerGroupId('primitive'),
          target: group.id,
          type: 'layer-group-member'
        });
      }
    });
    
    // Primitives layer group links to color palette groups
    paletteGroupNodes.forEach(group => {
      layerLinks.push({
        source: getLayerGroupId('primitive'),
        target: group.id,
        type: 'layer-group-member'
      });
    });

    // Create links from category groups to their tokens
    const categoryLinks = [];
    
    // Component category links (for single-level tokens only, exclude dot-separated tokens that are in dot groups)
    componentNodes.forEach(node => {
      // Only add to category if it's not in a dot group (dot-separated tokens are handled separately)
      const isInDotGroup = Array.from(componentDotGroups.values()).some(g => 
        g.tokens.some(t => t.id === node.id)
      );
      if (!usesUnderscores(node.name) && !node.name.includes('.') && !isInDotGroup) {
        const category = getCategoryPrefix(node.name);
        categoryLinks.push({
          source: `category:${category}`,
          target: node.id,
          type: 'group-member'
        });
      }
    });

    // Component dot group links (for hierarchical dot-separated tokens)
    componentDotGroups.forEach((group) => {
      // Link tokens to their deepest group
      group.tokens.forEach(token => {
        categoryLinks.push({
          source: group.id,
          target: token.id,
          type: 'group-member'
        });
      });
      // Link parent groups to child groups
      if (group.parentPath) {
        const parentId = `group:component:${group.parentPath}`;
        categoryLinks.push({
          source: parentId,
          target: group.id,
          type: 'group-member'
        });
      }
    });

    // Component underscore group links (for hierarchical underscore-separated tokens)
    componentUnderscoreGroups.forEach((group) => {
      // Link tokens to their deepest group
      group.tokens.forEach(token => {
        categoryLinks.push({
          source: group.id,
          target: token.id,
          type: 'group-member'
        });
      });
      // Link parent groups to child groups (only if this group has tokens or will have child groups)
      if (group.parentPath) {
        const parentId = `group:component:${group.parentPath}`;
        categoryLinks.push({
          source: parentId,
          target: group.id,
          type: 'group-member'
        });
      } else {
        // Link root groups to layer component group
        categoryLinks.push({
          source: getLayerGroupId('component'),
          target: group.id,
          type: 'layer-group-member'
        });
      }
    });

    // Process all other layers (global, shared, semantic, etc.) - create links for each layer
    allLayerGroups.forEach((groups, layerName) => {
      const layerNodes = layerNodesMap.get(layerName) || [];
      
      // Category links for this layer (for single-level tokens only, exclude dot-separated tokens that are in dot groups)
      layerNodes.forEach(node => {
        // Only add to category if it's not in a dot group (dot-separated tokens are handled separately)
        const isInDotGroup = Array.from(groups.dotGroups.values()).some(g => 
          g.tokens.some(t => t.id === node.id)
        );
        if (!usesUnderscores(node.name) && !node.name.includes('.') && !isInDotGroup) {
          const category = getCategoryPrefix(node.name);
          categoryLinks.push({
            source: `category:${category}`,
            target: node.id,
            type: 'group-member'
          });
        }
      });

      // Dot group links for this layer (for hierarchical dot-separated tokens, 2-layer deep)
      groups.dotGroups.forEach((group) => {
        // Link tokens to their deepest group
        group.tokens.forEach(token => {
          categoryLinks.push({
            source: group.id,
            target: token.id,
            type: 'group-member'
          });
        });
        // Link parent groups to child groups
        if (group.parentPath) {
          const parentId = `group:${layerName}:${group.parentPath}`;
          categoryLinks.push({
            source: parentId,
            target: group.id,
            type: 'group-member'
          });
        }
      });

      // Underscore group links for this layer (for hierarchical underscore-separated tokens)
      groups.underscoreGroups.forEach((group) => {
        // Link tokens to their deepest group
        group.tokens.forEach(token => {
          categoryLinks.push({
            source: group.id,
            target: token.id,
            type: 'group-member'
          });
        });
        // Link parent groups to child groups
        if (group.parentPath) {
          const parentId = `group:${layerName}:${group.parentPath}`;
          categoryLinks.push({
            source: parentId,
            target: group.id,
            type: 'group-member'
          });
        } else {
          // Link root groups to layer group
          categoryLinks.push({
            source: getLayerGroupId(layerName),
            target: group.id,
            type: 'layer-group-member'
          });
        }
      });
    });

    // Create links from palette groups to their primitive tokens
    const paletteLinks = [];
    
    // Opacity group links (opacity tokens to their hierarchical groups)
    opacityGroups.forEach((group) => {
      // Link tokens to their deepest group
      group.tokens.forEach(token => {
        paletteLinks.push({
          source: group.id,
          target: token.id,
          type: 'group-member'
        });
      });
      // Link parent groups to child groups
      if (group.parentPath) {
        const parentId = `group:opacity:${group.parentPath}`;
        paletteLinks.push({
          source: parentId,
          target: group.id,
          type: 'group-member'
        });
      }
    });
    
    // Color primitive palette links (for dot-separated tokens)
    colorNodes.forEach(node => {
      if (!usesUnderscores(node.name)) {
        // Extract palette from token name (e.g., "blue.1" -> "blue")
        const parts = node.name.split('.');
        const palette = parts[0] || 'other';
        paletteLinks.push({
          source: `group:${palette}`,
          target: node.id,
          type: 'group-member'
        });
      }
    });

    // Primitive underscore group links (for hierarchical underscore-separated tokens)
    primitiveUnderscoreGroups.forEach((group) => {
      // Link tokens to their deepest group
      group.tokens.forEach(token => {
        paletteLinks.push({
          source: group.id,
          target: token.id,
          type: 'group-member'
        });
      });
      // Link parent groups to child groups
      if (group.parentPath) {
        const parentId = `group:primitive:${group.parentPath}`;
        paletteLinks.push({
          source: parentId,
          target: group.id,
          type: 'group-member'
        });
      } else {
        // Link root groups to layer primitives group
        paletteLinks.push({
          source: getLayerGroupId('primitive'),
          target: group.id,
          type: 'layer-group-member'
        });
      }
    });

    const allCategoryGroups = [
      ...componentCategoryNodes,
      ...componentDotGroupNodes,
      ...componentUnderscoreGroupNodes,
      ...semanticCategoryNodes,
      ...semanticDotGroupNodes,
      ...semanticUnderscoreGroupNodes,
      ...opacityGroupNodes,
      ...paletteGroupNodes,
      ...primitiveUnderscoreGroupNodes
    ];

    // Create dynamic columns object with all layers
    const columns = {
      groups: allCategoryGroups,
      layerGroups: layerGroups
    };
    
    // Add nodes for each layer dynamically
    nodesByLayer.forEach((nodes, layer) => {
      columns[layer] = nodes;
    });

    return {
      columns: columns,
      links: [...tokenGraph.links, ...layerLinks, ...categoryLinks, ...paletteLinks],
      allNodes: [...tokenGraph.nodes, ...layerGroups, ...allCategoryGroups],
          primitiveGroups: Object.fromEntries(primitiveGroups),
          opacityPaletteGroups: Object.fromEntries(opacityPaletteGroups),
          componentCategoryGroups: Object.fromEntries(componentCategoryGroups),
          semanticCategoryGroups: Object.fromEntries(semanticCategoryGroups),
          // Store category groups by layer for easy lookup
          layerCategoryGroups: Object.fromEntries(
            Array.from(allLayerGroups.entries()).map(([layerName, groups]) => [
              layerName,
              Object.fromEntries(groups.categoryGroups)
            ])
          )
    };
  }, [tokenGraph]);

  // Filter graph based on search and mode
  const filteredGraph = useMemo(() => {
    let filtered = { ...organizedGraph };

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const filteredNodes = organizedGraph.allNodes.filter(node =>
        node.name.toLowerCase().includes(query) ||
        (node.color && node.color.toLowerCase().includes(query)) ||
        (node.description && node.description.toLowerCase().includes(query))
      );
      const nodeIds = new Set(filteredNodes.map(n => n.id));
      
      // Include group nodes if any of their children match
      if (organizedGraph.columns.groups) {
        organizedGraph.columns.groups.forEach(group => {
          let hasMatchingChild = false;
          let children = [];
          
          if (group.palette) {
            // Primitive palette groups
            children = organizedGraph.primitiveGroups[group.palette] || [];
            hasMatchingChild = children.some(child => nodeIds.has(child.id));
          } else if (group.category && group.layerGroupId === getLayerGroupId('component')) {
            // Component category groups
            children = organizedGraph.componentCategoryGroups[group.category] || [];
            hasMatchingChild = children.some(child => nodeIds.has(child.id));
          } else if (group.category && group.layer) {
            // Category groups for any layer (global, shared, semantic, etc.)
            const layerGroups = organizedGraph.layerCategoryGroups?.[group.layer];
            if (layerGroups) {
              children = layerGroups[group.category] || [];
              hasMatchingChild = children.some(child => nodeIds.has(child.id));
            }
          }
          
          if (hasMatchingChild) {
            nodeIds.add(group.id);
            // Also include all children of matching groups
            children.forEach(child => nodeIds.add(child.id));
          }
        });
      }
      
      // Include layer groups if any of their children match
      if (organizedGraph.columns.layerGroups) {
        organizedGraph.columns.layerGroups.forEach(layerGroup => {
          let hasMatchingChild = false;
          if (layerGroup.id === getLayerGroupId('component')) {
            hasMatchingChild = organizedGraph.columns.component.some(n => nodeIds.has(n.id));
          } else if (layerGroup.id === getLayerGroupId('primitive')) {
            hasMatchingChild = organizedGraph.columns.groups?.some(g => nodeIds.has(g.id)) || 
                              organizedGraph.columns.primitive.some(n => nodeIds.has(n.id));
          } else {
            // Check if this layer group has matching children
            const layerName = layerGroup.layer;
            hasMatchingChild = (organizedGraph.columns[layerName] || []).some(n => nodeIds.has(n.id));
          }
          if (hasMatchingChild) {
            nodeIds.add(layerGroup.id);
          }
        });
      }
      
      // Build filtered columns dynamically for all layers
      filtered.columns = {
        component: filtered.columns.component ? filtered.columns.component.filter(n => nodeIds.has(n.id)) : [],
        primitive: filtered.columns.primitive ? filtered.columns.primitive.filter(n => nodeIds.has(n.id)) : [],
        groups: filtered.columns.groups ? filtered.columns.groups.filter(n => nodeIds.has(n.id)) : [],
        layerGroups: filtered.columns.layerGroups ? filtered.columns.layerGroups.filter(n => nodeIds.has(n.id)) : []
      };
      
      // Filter all other layers dynamically
      Object.keys(filtered.columns).forEach(key => {
        if (key !== 'groups' && key !== 'layerGroups' && key !== 'component' && key !== 'primitive') {
          if (filtered.columns[key]) {
            filtered.columns[key] = filtered.columns[key].filter(n => nodeIds.has(n.id));
          }
        }
      });
      
      // Ensure all layers from organizedGraph are included
      Object.keys(organizedGraph.columns).forEach(layerKey => {
        if (layerKey !== 'groups' && layerKey !== 'layerGroups' && layerKey !== 'component' && layerKey !== 'primitive') {
          if (!filtered.columns[layerKey]) {
            filtered.columns[layerKey] = [];
          }
          if (organizedGraph.columns[layerKey]) {
            filtered.columns[layerKey] = organizedGraph.columns[layerKey].filter(n => nodeIds.has(n.id));
          }
        }
      });
      filtered.links = filtered.links.filter(link =>
        nodeIds.has(link.source) && nodeIds.has(link.target) &&
        (link.mode === selectedMode || !link.mode || link.type === 'group-member' || link.type === 'layer-group-member' || link.type === 'reference')
      );
    } else {
      filtered.links = filtered.links.filter(link =>
        link.mode === selectedMode || !link.mode || link.type === 'group-member' || link.type === 'layer-group-member' || link.type === 'reference'
      );
    }

    return filtered;
  }, [organizedGraph, searchQuery, selectedMode]);

  // Update minimap nodes periodically when minimap is visible
  useEffect(() => {
    if (!showMinimap) return;
    
    const updateMinimapNodes = () => {
      if (tokenGraphRef.current) {
        const nodes = tokenGraphRef.current.getPositionedNodes() || [];
        setMinimapNodes(nodes);
      }
    };
    
    updateMinimapNodes();
    const interval = setInterval(updateMinimapNodes, 500); // Update every 500ms
    
    return () => clearInterval(interval);
  }, [showMinimap, organizedGraph]);

  // Zoom to fit layer groups horizontally on initial load
  useEffect(() => {
    if (loading || !organizedGraph?.columns?.layerGroups || organizedGraph.columns.layerGroups.length === 0) {
      return;
    }

    // Wait a bit for nodes to be positioned
    const timeoutId = setTimeout(() => {
      const layerGroups = organizedGraph.columns.layerGroups;
      if (!layerGroups || layerGroups.length === 0) return;

      // Calculate bounds of layer groups
      // Layer groups are now centered on the canvas (25000, 25000)
      const SIDEBAR_WIDTH = sidebarCollapsed ? 0 : 280;
      const NODE_WIDTH = 450;
      const NODE_HEIGHT = 36;
      const MIN_SPACING = 800;
      const CANVAS_WIDTH = 50000;
      const CANVAS_HEIGHT = 50000;
      const CANVAS_CENTER_X = CANVAS_WIDTH / 2;
      const CANVAS_CENTER_Y = CANVAS_HEIGHT / 2;
      
      const layerGroupsCount = layerGroups.length;
      const totalWidth = (layerGroupsCount - 1) * MIN_SPACING + NODE_WIDTH;
      const startX = CANVAS_CENTER_X - totalWidth / 2;
      const endX = startX + totalWidth;
      const MASTER_Y = CANVAS_CENTER_Y - NODE_HEIGHT / 2;
      const masterTop = MASTER_Y;
      const masterBottom = MASTER_Y + NODE_HEIGHT;

      // Calculate viewport dimensions
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const availableWidth = viewportWidth - SIDEBAR_WIDTH;
      const availableHeight = viewportHeight;

      // Calculate zoom to fit with padding
      const horizontalPadding = 150;
      const verticalPadding = 150;
      const targetWidth = endX - startX + horizontalPadding * 2;
      const targetHeight = masterBottom - masterTop + verticalPadding * 2;
      const zoomX = availableWidth / targetWidth;
      const zoomY = availableHeight / targetHeight;

      // Use the smaller zoom to fit both dimensions, but don't zoom too much (max 1.0, min 0.3)
      const targetZoom = Math.max(0.3, Math.min(1.0, Math.min(zoomX, zoomY)));

      // Calculate pan to center the layer groups horizontally, but position them near the top vertically
      // Center of layer groups in graph space
      const centerX = (startX + endX) / 2;
      // We want this center to appear at the center of the available viewport horizontally
      const viewportCenterX = SIDEBAR_WIDTH + availableWidth / 2;
      // After transform: centerX * zoom + panX = viewportCenterX
      const targetPanX = viewportCenterX - centerX * targetZoom;
      
      // For Y, position layer groups near the top of the viewport (with some top padding)
      const topPadding = 80; // Padding from top of viewport
      // Position so layer groups appear near the top, accounting for zoom
      const targetPanY = topPadding - masterTop * targetZoom;

      // Apply zoom and pan
      setZoom(targetZoom);
      setPanX(targetPanX);
      setPanY(targetPanY);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [loading, organizedGraph, sidebarCollapsed]);

  const handleTokenSelect = (tokenId) => {
    setSelectedTokens(prev => {
      if (prev.includes(tokenId)) {
        return prev.filter(id => id !== tokenId);
      }
      return [...prev, tokenId];
    });
  };

  const handlePan = (deltaX, deltaY) => {
    setPanX(prev => prev + deltaX);
    setPanY(prev => prev + deltaY);
  };

  const handleZoom = useCallback((delta, centerX, centerY) => {
    setZoom(prevZoom => {
      const newZoom = Math.max(0.1, Math.min(3, prevZoom + delta));
      
      // If centerX/centerY are provided, adjust pan to zoom around that point
      if (centerX !== undefined && centerY !== undefined && delta !== 0) {
        const zoomRatio = newZoom / prevZoom;
        
        // Calculate pan adjustment so the graph point under the cursor stays at the same screen position
        // Graph point under cursor: graphX = (centerX - panX) / prevZoom
        // After zoom, we want: centerX = graphX * newZoom + newPanX
        // Solving: newPanX = centerX - graphX * newZoom
        //         newPanX = centerX - (centerX - panX) * zoomRatio
        //         newPanX = centerX * (1 - zoomRatio) + panX * zoomRatio
        // Offset: offsetX = newPanX - panX = centerX * (1 - zoomRatio) + panX * (zoomRatio - 1)
        //         offsetX = (centerX - panX) * (1 - zoomRatio)
        
        // Update pan synchronously using functional updates to access current pan values
        setPanX(currentPanX => {
          const offsetX = (centerX - currentPanX) * (1 - zoomRatio);
          return currentPanX + offsetX;
        });
        setPanY(currentPanY => {
          const offsetY = (centerY - currentPanY) * (1 - zoomRatio);
          return currentPanY + offsetY;
        });
      }
      
      return newZoom;
    });
  }, []);

  const handleResetView = useCallback(() => {
    setPanX(380);
    setPanY(130);
    setZoom(0.7);
  }, []);

  const handleZoomToFit = useCallback(() => {
    if (!organizedGraph?.columns?.layerGroups || organizedGraph.columns.layerGroups.length === 0) {
      return;
    }

    const layerGroups = organizedGraph.columns.layerGroups;
    const SIDEBAR_WIDTH = sidebarCollapsed ? 0 : 280;
    const NODE_WIDTH = 450;
    const NODE_HEIGHT = 36;
    const MIN_SPACING = 800;
    const CANVAS_WIDTH = 50000;
    const CANVAS_HEIGHT = 50000;
    const CANVAS_CENTER_X = CANVAS_WIDTH / 2;
    const CANVAS_CENTER_Y = CANVAS_HEIGHT / 2;
    
    const layerGroupsCount = layerGroups.length;
    const totalWidth = (layerGroupsCount - 1) * MIN_SPACING + NODE_WIDTH;
    const startX = CANVAS_CENTER_X - totalWidth / 2;
    const endX = startX + totalWidth;
    const MASTER_Y = CANVAS_CENTER_Y - NODE_HEIGHT / 2;
    const masterTop = MASTER_Y;
    const masterBottom = MASTER_Y + NODE_HEIGHT;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = viewportWidth - SIDEBAR_WIDTH;
    const availableHeight = viewportHeight;

    const horizontalPadding = 150;
    const verticalPadding = 150;
    const targetWidth = endX - startX + horizontalPadding * 2;
    const targetHeight = masterBottom - masterTop + verticalPadding * 2;
    const zoomX = availableWidth / targetWidth;
    const zoomY = availableHeight / targetHeight;
    const targetZoom = Math.max(0.3, Math.min(1.0, Math.min(zoomX, zoomY)));

    const centerX = (startX + endX) / 2;
    const viewportCenterX = SIDEBAR_WIDTH + availableWidth / 2;
    const targetPanX = viewportCenterX - centerX * targetZoom;
    
    // Position layer groups near the top of the viewport
    const topPadding = 80;
    const targetPanY = topPadding - masterTop * targetZoom;

    setZoom(targetZoom);
    setPanX(targetPanX);
    setPanY(targetPanY);
  }, [organizedGraph, sidebarCollapsed]);

  const handleZoomToPercent = useCallback((percent) => {
    const targetZoom = percent / 100;
    const container = document.querySelector('.token-graph-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      handleZoom(targetZoom - zoom, centerX, centerY);
    } else {
      setZoom(targetZoom);
    }
  }, [zoom, handleZoom]);

  // Handle JSON file import
  const handleImportJSON = useCallback(async (file) => {
    try {
      setLoading(true);
      const { graph, fileName, availableModes: importedModes } = await parseFile(file);
      setTokenGraph(graph);
      setCurrentFileName(fileName);
      
      // Update available modes from imported data (themes = modes)
      const modes = importedModes || [];
      setAvailableModes(modes);
      setSelectedMode(modes.length > 0 ? modes[0] : null);
      
      // Reset view when importing new file
      setPanX(380);
      setPanY(130);
      setZoom(0.7);
      setSelectedTokens([]);
      setLoading(false);
    } catch (error) {
      console.error('Failed to import file:', error);
      alert(`Failed to import file: ${error.message}`);
      setLoading(false);
    }
  }, []);

  // Handle TSX files import (primitives + semantic)
  const handleImportTSX = useCallback(async (primitivesFile, semanticFile) => {
    try {
      setLoading(true);
      const { graph, fileName, availableModes: importedModes } = await parseTSXWithPrimitives(primitivesFile, semanticFile);
      setTokenGraph(graph);
      setCurrentFileName(fileName);
      
      // Update available modes from imported data (themes = modes)
      const modes = importedModes || [];
      setAvailableModes(modes);
      setSelectedMode(modes.length > 0 ? modes[0] : null);
      
      // Reset view when importing new file
      setPanX(380);
      setPanY(130);
      setZoom(0.7);
      setSelectedTokens([]);
      setLoading(false);
    } catch (error) {
      console.error('Failed to import TSX files:', error);
      alert(`Failed to import TSX files: ${error.message}`);
      setLoading(false);
    }
  }, []);

  // Return to Teardrop tokens
  const handleReturnToTeardrop = useCallback(() => {
    if (originalTeardropGraph) {
      setTokenGraph(originalTeardropGraph);
      setCurrentFileName(null);
      // Reset to original graph modes
      const modes = originalTeardropGraph.availableModes || [];
      setAvailableModes(modes);
      setSelectedMode(modes.length > 0 ? modes[0] : null);
      // Reset view
      setPanX(380);
      setPanY(130);
      setZoom(0.7);
      setSelectedTokens([]);
    }
  }, [originalTeardropGraph]);


  if (loading) {
    return (
      <div className="app">
        <div className="app-loading">
          <div className="loading-spinner"></div>
          <p>Loading token data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedMode={selectedMode}
        onModeChange={setSelectedMode}
        modes={availableModes}
        selectedTokens={selectedTokens}
        onTokenRemove={(tokenId) => setSelectedTokens(prev => prev.filter(id => id !== tokenId))}
        collapsed={sidebarCollapsed}
        isTeardropOnly={!currentFileName}
      />
      
      <TokenGraph
        ref={tokenGraphRef}
        graph={filteredGraph}
        allNodes={organizedGraph.allNodes}
        selectedTokens={selectedTokens}
        onTokenSelect={handleTokenSelect}
        onClearSelection={() => setSelectedTokens([])}
        panX={panX}
        panY={panY}
        zoom={zoom}
        onPan={handlePan}
        onZoom={handleZoom}
        isDragging={isDragging}
        onDraggingChange={setIsDragging}
        hoverNodeId={hoverNodeId}
        onHoverNodeChange={setHoverNodeId}
        selectedMode={selectedMode}
        sidebarCollapsed={sidebarCollapsed}
        interactiveHighlighting={interactiveHighlighting}
      />

      <Toolbar
        zoom={zoom}
        onZoom={handleZoom}
        onResetView={handleResetView}
        onZoomToFit={handleZoomToFit}
        onZoomToPercent={handleZoomToPercent}
        selectedTokens={selectedTokens}
        onTokenRemove={(tokenId) => setSelectedTokens(prev => prev.filter(id => id !== tokenId))}
        onClearSelection={() => setSelectedTokens([])}
        onImportJSON={handleImportJSON}
        onImportCSS={handleImportJSON}
        onImportTSX={handleImportTSX}
        currentFileName={currentFileName}
        onReturnToTeardrop={handleReturnToTeardrop}
        showMinimap={showMinimap}
        onMinimapChange={setShowMinimap}
        interactiveHighlighting={interactiveHighlighting}
        onInteractiveHighlightingChange={setInteractiveHighlighting}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => setSidebarCollapsed(prev => !prev)}
      />
      
      {showMinimap && (
        <Minimap
          panX={panX}
          panY={panY}
          zoom={zoom}
          positionedNodes={minimapNodes}
          onPanTo={(newPanX, newPanY) => {
            setPanX(newPanX);
            setPanY(newPanY);
          }}
          sidebarCollapsed={sidebarCollapsed}
        />
      )}

    </div>
  );
}

export default App;

