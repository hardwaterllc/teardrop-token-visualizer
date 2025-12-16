import React, { useRef, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import TokenNode from './TokenNode';
import TokenConnection from './TokenConnection';
import './TokenGraph.css';

const COLUMN_WIDTH = 650;
const ROW_HEIGHT = 40; // Increased to match taller nodes
const NODE_WIDTH = 450;
const NODE_HEIGHT = 36; // 20px base + 8px top + 8px bottom padding
const SIDEBAR_WIDTH_DEFAULT = 280;
const INDENT_AMOUNT = 12; // Amount to indent child groups under parent groups

// Grid system for snapping
const GRID_SIZE = 24; // Base grid unit
const snapToGrid = (value) => {
  if (value == null || isNaN(value)) return 0;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
};

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

const TokenGraph = forwardRef(function TokenGraph({
  graph,
  allNodes,
  selectedTokens,
  onTokenSelect,
  onClearSelection,
  panX,
  panY,
  zoom,
  onPan,
  onZoom,
  isDragging,
  onDraggingChange,
  hoverNodeId,
  onHoverNodeChange,
  selectedMode,
  sidebarCollapsed,
  interactiveHighlighting
}, ref) {
  const containerRef = useRef(null);
  const isPanningRef = useRef(false);
  const isDraggingNodeRef = useRef(null);
  const dragStartPosRef = useRef(null); // Store original position when drag starts
  const lastPanRef = useRef({ x: 0, y: 0 });
  const nodePositionsRef = useRef(new Map());
  const [nodePositionsVersion, setNodePositionsVersion] = useState(0);
  const [placeholderPosition, setPlaceholderPosition] = useState(null); // { x, y, width, height }
  const [insertionDivider, setInsertionDivider] = useState(null); // { x, y, width } for divider line
  
  // Calculate sidebar width based on collapsed state
  const SIDEBAR_WIDTH = sidebarCollapsed ? 0 : SIDEBAR_WIDTH_DEFAULT;
  
  // Store setters in refs for document handler access
  useEffect(() => {
    setPlaceholderPositionRef.current = setPlaceholderPosition;
    setNodePositionsVersionRef.current = setNodePositionsVersion;
  }, []);
  
  // Drag threshold - don't start drag until mouse moves this many pixels
  const DRAG_THRESHOLD = 1; // Reduced for instant response
  const pendingDragRef = useRef(null); // Store pending drag info until threshold is met
  const hasDraggedRef = useRef(false); // Track if we actually dragged (to prevent click on release)
  
  // Direct DOM refs for dragging - zero React overhead
  const draggedNodeRefs = useRef(new Map()); // Map of nodeId -> DOM element ref
  const lastMouseEventRef = useRef(null); // Store last mouse event for drop calculation
  const dragOriginalPositionsRef = useRef(new Map()); // Store original positions for relative movement
  const positionedNodesRef = useRef([]); // Store positioned nodes for document handler access
  const setPlaceholderPositionRef = useRef(null); // Store setPlaceholderPosition for document handler
  const setNodePositionsVersionRef = useRef(null); // Store setNodePositionsVersion for document handler
  
  // Focus mode state - when a token is double-clicked, show its connection chain
  const [focusMode, setFocusMode] = useState(null); // { selectedTokenId, chain, originalPan, originalZoom }
  const originalViewRef = useRef({ panX: null, panY: null, zoom: null });
  const clickTimeoutRef = useRef(null); // Track single vs double click
  
  // Collapsed groups state - tracks which groups are collapsed
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  // Calculate node positions in columns with master groups
  const positionedNodes = useMemo(() => {
    const positioned = [];
    const CANVAS_WIDTH = 50000;
    const CANVAS_HEIGHT = 50000;
    const CANVAS_CENTER_X = CANVAS_WIDTH / 2;
    const CANVAS_CENTER_Y = CANVAS_HEIGHT / 2;

    // Position master groups and their children
    if (graph.columns.masterGroups) {
      // Calculate horizontal spacing for master groups
      const masterGroupsCount = graph.columns.masterGroups.length;
      const MIN_SPACING = 800; // Minimum spacing between master groups for better visibility
      const spacing = MIN_SPACING;
      
      // Calculate total width of all master groups
      const totalWidth = (masterGroupsCount - 1) * spacing + NODE_WIDTH;
      
      // Center the master groups on the canvas (both horizontally and vertically)
      // Start X position: canvas center - half of total width
      const startX = CANVAS_CENTER_X - totalWidth / 2;
      // Y position: canvas center - half of node height (to center the node vertically)
      const MASTER_Y = CANVAS_CENTER_Y - NODE_HEIGHT / 2;
      
      graph.columns.masterGroups.forEach((masterGroup, index) => {
        const masterKey = `master-${masterGroup.id}`;
        const masterSavedPos = nodePositionsRef.current.get(masterKey);
        
        // Calculate X position: centered horizontally with good spacing, snapped to grid
        const masterX = masterSavedPos?.x ?? snapToGrid(startX + index * spacing);
        const masterY = masterSavedPos?.y ?? snapToGrid(MASTER_Y); // Centered vertically, snapped to grid
        
        // Position master group
        positioned.push({
          ...masterGroup,
          x: masterX,
          y: masterY,
          column: masterGroup.layer,
          isMasterGroup: true
        });

        // Skip children if master group is collapsed
        if (collapsedGroups.has(masterGroup.id)) {
          return; // Skip to next master group
        }
        
        let childYOffset = snapToGrid(masterY + ROW_HEIGHT + 12); // Start below master group, snapped to grid

        if (masterGroup.id === 'master:components') {
          // Position component category groups first
          const componentCategories = graph.columns.groups.filter(g => g.masterGroupId === 'master:components').sort((a, b) => a.name.localeCompare(b.name));
          
          componentCategories.forEach((categoryGroup) => {
            const categoryKey = `category-${categoryGroup.id}`;
            const categorySavedPos = nodePositionsRef.current.get(categoryKey);
            const categoryY = categorySavedPos?.y ?? snapToGrid(childYOffset);
            
            positioned.push({
              ...categoryGroup,
              x: snapToGrid(masterX + INDENT_AMOUNT), // Always indent under master (enforce hierarchy)
              y: categoryY,
              column: 'component',
              isGroup: true,
              masterGroupId: masterGroup.id
            });

            // Skip children if category group is collapsed
            if (!collapsedGroups.has(categoryGroup.id)) {
              // First, find and position child groups (nested groups)
              const childGroups = graph.columns.groups.filter(g => 
                g.parentGroupId === categoryGroup.id && 
                g.masterGroupId === 'master:components'
              ).sort((a, b) => a.name.localeCompare(b.name));
              
              let currentYOffset = snapToGrid(categoryY + ROW_HEIGHT + 8);
              
              // Position child groups first
              childGroups.forEach((childGroup) => {
                const childGroupKey = `category-${childGroup.id}`;
                const childGroupSavedPos = nodePositionsRef.current.get(childGroupKey);
                const childGroupY = childGroupSavedPos?.y ?? snapToGrid(currentYOffset);
                
                positioned.push({
                  ...childGroup,
                  x: snapToGrid(masterX + INDENT_AMOUNT * 2), // Always indent under parent category (enforce hierarchy)
                  y: childGroupY,
                  column: 'component',
                  isGroup: true,
                  masterGroupId: masterGroup.id,
                  groupId: categoryGroup.id
                });
                
                // Position tokens under this child group
                if (!collapsedGroups.has(childGroup.id)) {
                  const childGroupTokens = graph.columns.component.filter(n => {
                    const hasLink = graph.links.some(link => 
                      link.source === childGroup.id && 
                      link.target === n.id && 
                      link.type === 'group-member'
                    );
                    return hasLink;
                  }).sort(naturalSort);
                  
                  let childTokenYOffset = snapToGrid(childGroupY + ROW_HEIGHT + 8);
                  childGroupTokens.forEach((node) => {
                    const key = `component-${node.id}`;
                    const savedPos = nodePositionsRef.current.get(key);
                    positioned.push({
                      ...node,
                      x: snapToGrid(masterX + INDENT_AMOUNT * 3), // Always triple indent under child group (enforce hierarchy)
                      y: savedPos?.y ?? snapToGrid(childTokenYOffset), // Use saved Y position if available
                      column: 'component',
                      groupId: childGroup.id,
                      masterGroupId: masterGroup.id
                    });
                    if (!savedPos) {
                      childTokenYOffset = snapToGrid(childTokenYOffset + ROW_HEIGHT + 4);
                    }
                  });
                  
                  if (childGroupTokens.length > 0) {
                    // Use the maximum Y position of children (if they have saved positions) to calculate next offset
                    const maxChildY = childGroupTokens.reduce((max, node) => {
                      const key = `component-${node.id}`;
                      const savedPos = nodePositionsRef.current.get(key);
                      return savedPos ? Math.max(max, savedPos.y + ROW_HEIGHT + 4) : max;
                    }, childTokenYOffset);
                    currentYOffset = snapToGrid(maxChildY + 20);
                  } else {
                    currentYOffset = snapToGrid(childGroupY + ROW_HEIGHT + 20);
                  }
                } else {
                  currentYOffset = snapToGrid(childGroupY + ROW_HEIGHT + 20);
                }
                
                if (!childGroupSavedPos) {
                  currentYOffset = snapToGrid(currentYOffset);
                }
              });
              
              // Then position tokens directly under the category (if no child groups or after child groups)
              const category = categoryGroup.category;
              const categoryChildren = graph.columns.component.filter(n => {
                // Exclude tokens that belong to child groups
                const belongsToChildGroup = childGroups.some(cg => 
                  graph.links.some(link => 
                    link.source === cg.id && 
                    link.target === n.id && 
                    link.type === 'group-member'
                  )
                );
                if (belongsToChildGroup) return false;
                
                // For dot-separated tokens, match by prefix
                if (n.name.includes('.') && !n.name.includes('_')) {
                  const prefix = n.name.split('.')[0];
                  return prefix === category;
                }
                // For underscore-separated tokens, check if token belongs to this group via links
                if (n.name.includes('_') && !n.name.includes('.')) {
                  const hasLink = graph.links.some(link => 
                    link.source === categoryGroup.id && 
                    link.target === n.id && 
                    link.type === 'group-member'
                  );
                  if (hasLink) return true;
                  // Also check if token name starts with category (for root groups)
                  return n.name.startsWith(category + '_') || n.name === category;
                }
                return false;
              }).sort(naturalSort);
            
              let tokenYOffset = currentYOffset;
              if (childGroups.length === 0) {
                tokenYOffset = snapToGrid(categoryY + ROW_HEIGHT + 8);
              }
              
              categoryChildren.forEach((node) => {
                const key = `component-${node.id}`;
                const savedPos = nodePositionsRef.current.get(key);
                positioned.push({
                  ...node,
                  x: snapToGrid(masterX + INDENT_AMOUNT * 2), // Always double indent under category (enforce hierarchy)
                  y: savedPos?.y ?? snapToGrid(tokenYOffset), // Use saved Y position if available
                  column: 'component',
                  groupId: categoryGroup.id,
                  masterGroupId: masterGroup.id
                });
                if (!savedPos) {
                  tokenYOffset = snapToGrid(tokenYOffset + ROW_HEIGHT + 4);
                }
              });

              if (categoryChildren.length > 0) {
                // Use the maximum Y position of children (if they have saved positions) to calculate next offset
                const maxChildY = categoryChildren.reduce((max, node) => {
                  const key = `component-${node.id}`;
                  const savedPos = nodePositionsRef.current.get(key);
                  return savedPos ? Math.max(max, savedPos.y + ROW_HEIGHT + 4) : max;
                }, tokenYOffset);
                childYOffset = snapToGrid(maxChildY + 20);
              } else if (childGroups.length > 0) {
                childYOffset = snapToGrid(currentYOffset);
              } else if (!categorySavedPos) {
                childYOffset = snapToGrid(categoryY + ROW_HEIGHT + 20);
              }
            } else {
              // Group is collapsed - next group should start right after this one
              childYOffset = snapToGrid(categoryY + ROW_HEIGHT + 20); // Space for collapsed category
            }
          });
        } else if (masterGroup.id === 'master:semantic') {
          // Position semantic category groups first
          const semanticCategories = graph.columns.groups.filter(g => g.masterGroupId === 'master:semantic').sort((a, b) => a.name.localeCompare(b.name));
          
          semanticCategories.forEach((categoryGroup) => {
            const categoryKey = `category-${categoryGroup.id}`;
            const categorySavedPos = nodePositionsRef.current.get(categoryKey);
            const categoryY = categorySavedPos?.y ?? snapToGrid(childYOffset);
            
            positioned.push({
              ...categoryGroup,
              x: snapToGrid(masterX + INDENT_AMOUNT), // Always indent under master (enforce hierarchy)
              y: categoryY,
              column: 'semantic',
              isGroup: true,
              masterGroupId: masterGroup.id
            });

            // Skip children if category group is collapsed
            if (!collapsedGroups.has(categoryGroup.id)) {
              // First, find and position child groups (nested groups)
              const childGroups = graph.columns.groups.filter(g => 
                g.parentGroupId === categoryGroup.id && 
                g.masterGroupId === 'master:semantic'
              ).sort((a, b) => a.name.localeCompare(b.name));
              
              let currentYOffset = snapToGrid(categoryY + ROW_HEIGHT + 8);
              
              // Position child groups first
              childGroups.forEach((childGroup) => {
                const childGroupKey = `category-${childGroup.id}`;
                const childGroupSavedPos = nodePositionsRef.current.get(childGroupKey);
                const childGroupY = childGroupSavedPos?.y ?? snapToGrid(currentYOffset);
                
                positioned.push({
                  ...childGroup,
                  x: snapToGrid(masterX + INDENT_AMOUNT * 2), // Always indent under parent category (enforce hierarchy)
                  y: childGroupY,
                  column: 'semantic',
                  isGroup: true,
                  masterGroupId: masterGroup.id,
                  groupId: categoryGroup.id
                });
                
                // Position tokens under this child group
                if (!collapsedGroups.has(childGroup.id)) {
                  const childGroupTokens = graph.columns.semantic.filter(n => {
                    const hasLink = graph.links.some(link => 
                      link.source === childGroup.id && 
                      link.target === n.id && 
                      link.type === 'group-member'
                    );
                    return hasLink;
                  }).sort(naturalSort);
                  
                  let childTokenYOffset = snapToGrid(childGroupY + ROW_HEIGHT + 8);
                  childGroupTokens.forEach((node) => {
                    const key = `semantic-${node.id}`;
                    const savedPos = nodePositionsRef.current.get(key);
                    positioned.push({
                      ...node,
                      x: snapToGrid(masterX + INDENT_AMOUNT * 3), // Always triple indent under child group (enforce hierarchy)
                      y: savedPos?.y ?? snapToGrid(childTokenYOffset), // Use saved Y position if available
                      column: 'semantic',
                      groupId: childGroup.id,
                      masterGroupId: masterGroup.id
                    });
                    if (!savedPos) {
                      childTokenYOffset = snapToGrid(childTokenYOffset + ROW_HEIGHT + 4);
                    }
                  });
                  
                  if (childGroupTokens.length > 0) {
                    // Use the maximum Y position of children (if they have saved positions) to calculate next offset
                    const maxChildY = childGroupTokens.reduce((max, node) => {
                      const key = `semantic-${node.id}`;
                      const savedPos = nodePositionsRef.current.get(key);
                      return savedPos ? Math.max(max, savedPos.y + ROW_HEIGHT + 4) : max;
                    }, childTokenYOffset);
                    currentYOffset = snapToGrid(maxChildY + 20);
                  } else {
                    currentYOffset = snapToGrid(childGroupY + ROW_HEIGHT + 20);
                  }
                } else {
                  // Child group is collapsed - just add space for the collapsed group header
                  currentYOffset = snapToGrid(childGroupY + ROW_HEIGHT + 20);
                }
                
                if (!childGroupSavedPos) {
                  currentYOffset = snapToGrid(currentYOffset);
                }
              });
              
              // Then position tokens directly under the category (if no child groups or after child groups)
              const category = categoryGroup.category;
              const categoryChildren = graph.columns.semantic.filter(n => {
                // Exclude tokens that belong to child groups
                const belongsToChildGroup = childGroups.some(cg => 
                  graph.links.some(link => 
                    link.source === cg.id && 
                    link.target === n.id && 
                    link.type === 'group-member'
                  )
                );
                if (belongsToChildGroup) return false;
                
                // Check if token belongs to this group via links (for underscore-separated tokens)
                const hasLink = graph.links.some(link => 
                  link.source === categoryGroup.id && 
                  link.target === n.id && 
                  link.type === 'group-member'
                );
                if (hasLink) return true;
                
                // For dot-separated tokens, match by prefix
                if (n.name.includes('.') && !n.name.includes('_')) {
                  const prefix = n.name.split('.')[0];
                  return prefix === category;
                }
                // For underscore-separated tokens, check if token name starts with category
                if (n.name.includes('_') && !n.name.includes('.')) {
                  return n.name.startsWith(category + '_') || n.name === category;
                }
                return false;
              }).sort(naturalSort);
            
              let tokenYOffset = currentYOffset;
              if (childGroups.length === 0) {
                tokenYOffset = snapToGrid(categoryY + ROW_HEIGHT + 8);
              }
              
              categoryChildren.forEach((node) => {
                const key = `semantic-${node.id}`;
                const savedPos = nodePositionsRef.current.get(key);
                positioned.push({
                  ...node,
                  x: snapToGrid(masterX + INDENT_AMOUNT * 2), // Always double indent under category (enforce hierarchy)
                  y: savedPos?.y ?? snapToGrid(tokenYOffset), // Use saved Y position if available
                  column: 'semantic',
                  groupId: categoryGroup.id,
                  masterGroupId: masterGroup.id
                });
                if (!savedPos) {
                  tokenYOffset = snapToGrid(tokenYOffset + ROW_HEIGHT + 4);
                }
              });

              if (categoryChildren.length > 0) {
                // Use the maximum Y position of children (if they have saved positions) to calculate next offset
                const maxChildY = categoryChildren.reduce((max, node) => {
                  const key = `semantic-${node.id}`;
                  const savedPos = nodePositionsRef.current.get(key);
                  return savedPos ? Math.max(max, savedPos.y + ROW_HEIGHT + 4) : max;
                }, tokenYOffset);
                childYOffset = snapToGrid(maxChildY + 20);
              } else if (childGroups.length > 0) {
                // Use currentYOffset which accounts for collapsed child groups
                childYOffset = snapToGrid(currentYOffset);
              } else if (!categorySavedPos) {
                childYOffset = snapToGrid(categoryY + ROW_HEIGHT + 20);
              }
            } else {
              // Group is collapsed - next group should start right after this one
              childYOffset = snapToGrid(categoryY + ROW_HEIGHT + 20); // Space for collapsed category
            }
          });
        } else if (masterGroup.id === 'master:primitives') {
          // Position opacity group first (if it exists)
          const opacityGroup = graph.columns.groups.find(g => g.id === 'group:opacity');
          if (opacityGroup) {
            const opacityKey = `group-${opacityGroup.id}`;
            const opacitySavedPos = nodePositionsRef.current.get(opacityKey);
            const opacityY = opacitySavedPos?.y ?? snapToGrid(childYOffset);
            
            positioned.push({
              ...opacityGroup,
              x: snapToGrid(masterX + INDENT_AMOUNT), // Always indent under master (enforce hierarchy)
              y: opacityY,
              column: 'primitive',
              isGroup: true,
              masterGroupId: masterGroup.id
            });

            // Skip children if opacity group is collapsed
            if (!collapsedGroups.has(opacityGroup.id)) {
            // Position opacity groups (hierarchical structure) under opacity group
            // Find root opacity groups (those with masterGroupId === 'group:opacity' and no parentGroupId)
            const rootOpacityGroups = graph.columns.groups.filter(g => 
              g.masterGroupId === 'group:opacity' && !g.parentGroupId
            ).sort(naturalSort);
            
            // Build nested groups map
            const nestedOpacityGroups = new Map();
            graph.columns.groups.filter(g => 
              g.masterGroupId === 'group:opacity' && g.parentGroupId
            ).forEach(g => {
              if (!nestedOpacityGroups.has(g.parentGroupId)) {
                nestedOpacityGroups.set(g.parentGroupId, []);
              }
              nestedOpacityGroups.get(g.parentGroupId).push(g);
            });
            
            // Recursive function to position opacity groups and their tokens
            const positionOpacityGroup = (group, indentLevel = 2) => {
              const groupKey = `group-${group.id}`;
              const groupSavedPos = nodePositionsRef.current.get(groupKey);
              const groupY = groupSavedPos?.y ?? snapToGrid(opacityPaletteYOffset);
              
              positioned.push({
                ...group,
                x: snapToGrid(masterX + INDENT_AMOUNT * indentLevel),
                y: groupY,
                column: 'primitive',
                isGroup: true,
                masterGroupId: masterGroup.id,
                opacityGroupId: opacityGroup.id,
                groupId: group.parentGroupId || opacityGroup.id
              });
              
              // Skip children if group is collapsed
              if (!collapsedGroups.has(group.id)) {
                // Position child groups first
                const childGroups = nestedOpacityGroups.get(group.id) || [];
                childGroups.forEach(childGroup => {
                  opacityPaletteYOffset = snapToGrid(groupY + ROW_HEIGHT + 8);
                  positionOpacityGroup(childGroup, indentLevel + 1);
                });
                
                // Then position tokens directly under this group
                const groupTokens = graph.columns.primitive.filter(n => {
                  const hasLink = graph.links.some(link => 
                    link.source === group.id && 
                    link.target === n.id && 
                    link.type === 'group-member'
                  );
                  return hasLink;
                }).sort(naturalSort);
                
                let tokenYOffset = snapToGrid(groupY + ROW_HEIGHT + 8 + (childGroups.length * ROW_HEIGHT));
                groupTokens.forEach((childNode) => {
                  const childKey = `primitive-${childNode.id}`;
                  const childSavedPos = nodePositionsRef.current.get(childKey);
                  positioned.push({
                    ...childNode,
                    x: snapToGrid(masterX + INDENT_AMOUNT * (indentLevel + 1)),
                    y: childSavedPos?.y ?? snapToGrid(tokenYOffset),
                    column: 'primitive',
                    groupId: group.id,
                    opacityGroupId: opacityGroup.id,
                    masterGroupId: masterGroup.id
                  });
                  if (!childSavedPos) {
                    tokenYOffset = snapToGrid(tokenYOffset + ROW_HEIGHT + 4);
                  }
                });
                
                if (groupTokens.length > 0) {
                  opacityPaletteYOffset = snapToGrid(tokenYOffset + 20);
                } else if (childGroups.length > 0) {
                  opacityPaletteYOffset = snapToGrid(groupY + ROW_HEIGHT + 20);
                } else {
                  opacityPaletteYOffset = snapToGrid(groupY + ROW_HEIGHT + 20);
                }
              } else {
                opacityPaletteYOffset = snapToGrid(groupY + ROW_HEIGHT + 20);
              }
            };
            
            let opacityPaletteYOffset = snapToGrid(opacityY + ROW_HEIGHT + 8);
            
            // Position all root opacity groups
            rootOpacityGroups.forEach(group => {
              positionOpacityGroup(group);
            });
            
            // Update childYOffset after positioning all opacity groups
            if (!opacitySavedPos) {
              childYOffset = snapToGrid(opacityPaletteYOffset + 20); // Space after opacity group, snapped to grid
            }
            } else {
              // Opacity group is collapsed - next group should start right after this one
              childYOffset = snapToGrid(opacityY + ROW_HEIGHT + 20); // Space for collapsed opacity group
            }
          }
          
          // Position color primitive groups (both palette groups and underscore-separated groups)
          if (graph.columns.groups) {
            // Filter to only color primitive groups (not opacity-related)
            // This includes both palette groups (dot-separated) and underscore groups
            const colorPrimitiveGroups = graph.columns.groups.filter(g => 
              g.masterGroupId === 'master:primitives' && 
              !g.opacityGroupId &&
              g.id !== 'group:opacity' &&
              (g.palette || g.id.startsWith('group:primitive:'))
            );
            
            // Sort groups: root groups first (no parent), then nested groups
            const rootGroups = colorPrimitiveGroups.filter(g => !g.parentGroupId);
            const nestedGroups = new Map();
            colorPrimitiveGroups.filter(g => g.parentGroupId).forEach(g => {
              if (!nestedGroups.has(g.parentGroupId)) {
                nestedGroups.set(g.parentGroupId, []);
              }
              nestedGroups.get(g.parentGroupId).push(g);
            });
            
            // Recursive function to position groups and their children
            const positionPrimitiveGroup = (group, indentLevel = 1) => {
              const groupKey = `group-${group.id}`;
              const groupSavedPos = nodePositionsRef.current.get(groupKey);
              const groupY = groupSavedPos?.y ?? snapToGrid(childYOffset);
              
              positioned.push({
                ...group,
                x: snapToGrid(masterX + INDENT_AMOUNT * indentLevel), // Always enforce hierarchy indentation
                y: groupY,
                column: 'primitive',
                isGroup: true,
                masterGroupId: masterGroup.id,
                groupId: group.parentGroupId || null // Preserve parent relationship for nested groups
              });

              // Skip children if group is collapsed
              if (!collapsedGroups.has(group.id)) {
                // Position child groups first (nested groups)
                const childGroups = nestedGroups.get(group.id) || [];
                childGroups.forEach(childGroup => {
                  childYOffset = snapToGrid(groupY + ROW_HEIGHT + 8);
                  positionPrimitiveGroup(childGroup, indentLevel + 1);
                });
                
                // Then position tokens directly under this group
                let children = [];
                
                // For palette groups (dot-separated tokens)
                if (group.palette && graph.primitiveGroups) {
                  children = graph.primitiveGroups[group.palette] || [];
                }
                // For underscore-separated groups, find tokens via links
                else if (group.id.startsWith('group:primitive:')) {
                  children = graph.columns.primitive.filter(n => {
                    const hasLink = graph.links.some(link => 
                      link.source === group.id && 
                      link.target === n.id && 
                      link.type === 'group-member'
                    );
                    return hasLink;
                  }).sort(naturalSort);
                }
                
                let tokenYOffset = snapToGrid(groupY + ROW_HEIGHT + 8 + (childGroups.length * ROW_HEIGHT));
              
                children.forEach((childNode) => {
                  const childKey = `primitive-${childNode.id}`;
                  const childSavedPos = nodePositionsRef.current.get(childKey);
                  positioned.push({
                    ...childNode,
                    x: snapToGrid(masterX + INDENT_AMOUNT * (indentLevel + 1)), // Always enforce hierarchy indentation
                    y: childSavedPos?.y ?? snapToGrid(tokenYOffset), // Use saved Y position if available
                    column: 'primitive',
                    groupId: group.id,
                    masterGroupId: masterGroup.id
                  });
                  if (!childSavedPos) {
                    tokenYOffset = snapToGrid(tokenYOffset + ROW_HEIGHT + 4);
                  }
                });

                if (children.length > 0) {
                  childYOffset = snapToGrid(tokenYOffset + 20);
                } else if (childGroups.length > 0) {
                  childYOffset = snapToGrid(groupY + ROW_HEIGHT + 20);
                }
              } else {
                // Group is collapsed - next group should start right after this one
                childYOffset = snapToGrid(groupY + ROW_HEIGHT + 20);
              }
            };
            
            // Position all root groups
            rootGroups.forEach(group => {
              positionPrimitiveGroup(group);
            });
            
            // Position any primitive tokens that don't belong to any group
            const ungroupedPrimitives = graph.columns.primitive.filter(n => {
              // Check if token is already positioned (has a group)
              return !positioned.some(p => p.id === n.id && p.column === 'primitive');
            });
            
            if (ungroupedPrimitives.length > 0) {
              let tokenYOffset = snapToGrid(childYOffset);
              ungroupedPrimitives.forEach((node) => {
                const key = `primitive-${node.id}`;
                const savedPos = nodePositionsRef.current.get(key);
                positioned.push({
                  ...node,
                  x: snapToGrid(masterX + INDENT_AMOUNT), // Always enforce hierarchy indentation
                  y: savedPos?.y ?? snapToGrid(tokenYOffset), // Use saved Y position if available
                  column: 'primitive',
                  masterGroupId: masterGroup.id
                });
                if (!savedPos) {
                  tokenYOffset = snapToGrid(tokenYOffset + ROW_HEIGHT + 4);
                }
              });
            }
          }
        }

        // All master groups are top-aligned, so we don't need to update yOffset
      });
    } else {
      // Fallback: position without master groups
      yOffset = 0;
      graph.columns.component.forEach((node) => {
        const key = `component-${node.id}`;
        const savedPos = nodePositionsRef.current.get(key);
        positioned.push({
          ...node,
          x: savedPos?.x ?? SIDEBAR_WIDTH + 50,
          y: savedPos?.y ?? yOffset,
          column: 'component'
        });
        if (!savedPos) {
          yOffset += ROW_HEIGHT + 4;
        }
      });
    }

    // Update ref for document handler access
    positionedNodesRef.current = positioned;
    return positioned;
  }, [graph, nodePositionsVersion, collapsedGroups]);

  // Handle mouse events for panning and node dragging
  const handleMouseDown = (e) => {
    // Panning takes priority with modifier keys or middle mouse
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      isPanningRef.current = true;
      onDraggingChange(true);
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    // Only handle left mouse button for node dragging
    if (e.button !== 0) return;
    
    // Check if clicking on canvas (not a node) - exit focus mode and clear selection
    const target = e.target.closest('.token-node');
    if (!target && containerRef.current?.contains(e.target)) {
      // Clicked on canvas
      if (focusMode) {
        // Exit focus mode
        exitFocusMode();
      }
      // Clear selected tokens if any are selected
      if (selectedTokens.length > 0 && onClearSelection) {
        onClearSelection();
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    // Reset drag tracking
    hasDraggedRef.current = false;
    
    // Check if clicking on a node
    if (target && target.dataset.nodeId) {
      const nodeId = target.dataset.nodeId;
      const node = positionedNodes.find(n => n.id === nodeId);
      if (node) {
        // Only allow dragging groups and master groups, not individual token nodes
        if (!node.isMasterGroup && !node.isGroup) {
          // Individual token nodes are not draggable
          // But in focus mode, allow clicking to switch focus
          if (focusMode && focusMode.chain.includes(nodeId)) {
            // Let the onClick handler in TokenNode handle it
            return;
          }
          return;
        }
        
        // Set up pending drag for groups/master groups only
        const key = node.isMasterGroup ? `master-${nodeId}` :
                   node.isGroup ? (node.id.startsWith('category:') ? `category-${nodeId}` : `group-${nodeId}`) :
                   `${node.column}-${nodeId}`;
        const currentPos = nodePositionsRef.current.get(key) || { x: node.x, y: node.y };
        
        pendingDragRef.current = {
          nodeId,
          startX: e.clientX,
          startY: e.clientY,
          nodePos: { x: currentPos.x, y: currentPos.y }
        };
        
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  };

  const handleMouseMove = (e) => {
    // Check if we have a pending drag that needs to start
    if (pendingDragRef.current && !isDraggingNodeRef.current) {
      const { startX, startY, nodeId, nodePos } = pendingDragRef.current;
      const deltaX = Math.abs(e.clientX - startX);
      const deltaY = Math.abs(e.clientY - startY);
      
      // Check if we've moved past the threshold
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDraggingNodeRef.current = { nodeId, startX, startY };
        dragStartPosRef.current = nodePos;
        hasDraggedRef.current = true;
      onDraggingChange(true);
        
        // Store original positions of node and all children for proper relative movement
        const node = positionedNodes.find(n => n.id === nodeId);
        if (node) {
          const key = node.isMasterGroup ? `master-${nodeId}` :
                     node.isGroup ? (node.id.startsWith('category:') ? `category-${nodeId}` : `group-${nodeId}`) :
                     `${node.column}-${nodeId}`;
          
          // Store original positions
          dragOriginalPositionsRef.current.clear();
          dragOriginalPositionsRef.current.set(key, { x: nodePos.x, y: nodePos.y });
          
          // Helper function to recursively find all descendants of a group
          const findAllDescendants = (groupId) => {
            const descendants = [];
            // Find direct children - must match exactly
            const directChildren = positionedNodes.filter(n => {
              // For groups, check parentGroupId OR groupId (semantic child groups use groupId)
              if (n.isGroup) {
                return n.parentGroupId === groupId || n.groupId === groupId;
              }
              // For tokens, check groupId or opacityGroupId
              if (n.groupId === groupId || n.opacityGroupId === groupId) {
                return true;
              }
              // For semantic and component tokens, also check graph links
              if (n.column === 'semantic' || n.column === 'component') {
                const hasLink = graph.links.some(link => 
                  link.source === groupId && 
                  link.target === n.id && 
                  link.type === 'group-member'
                );
                return hasLink;
              }
              return false;
            });
            
            directChildren.forEach(child => {
              descendants.push(child);
              // If child is a group, recursively find its descendants
              if (child.isGroup) {
                descendants.push(...findAllDescendants(child.id));
              }
            });
            
            return descendants;
          };
          
          // Store children positions if it's a group/master
          if (node.isMasterGroup || node.isGroup) {
            const children = node.isMasterGroup 
              ? positionedNodes.filter(n => n.masterGroupId === nodeId)
              : positionedNodes.filter(n => {
                  // Check direct properties first
                  // For groups: check parentGroupId OR groupId (semantic child groups use groupId)
                  if (n.isGroup && (n.parentGroupId === nodeId || n.groupId === nodeId)) {
                    return true;
                  }
                  // For tokens: check groupId or opacityGroupId
                  if (!n.isGroup && (n.groupId === nodeId || n.opacityGroupId === nodeId)) {
                    return true;
                  }
                  // For semantic and component tokens/groups, also check graph links
                  if (n.column === 'semantic' || n.column === 'component') {
                    const hasLink = graph.links.some(link => 
                      link.source === nodeId && 
                      link.target === n.id && 
                      link.type === 'group-member'
                    );
                    return hasLink;
                  }
                  return false;
                });
            
            // Store all descendants recursively
            const allDescendants = [];
            children.forEach(child => {
              allDescendants.push(child);
              if (child.isGroup) {
                allDescendants.push(...findAllDescendants(child.id));
              }
            });
            
            // Store positions for all descendants
            allDescendants.forEach(descendant => {
              const descendantKey = descendant.isGroup 
                ? (descendant.id.startsWith('category:') ? `category-${descendant.id}` : `group-${descendant.id}`)
                : `${descendant.column}-${descendant.id}`;
              const descendantPos = nodePositionsRef.current.get(descendantKey) || { x: descendant.x, y: descendant.y };
              dragOriginalPositionsRef.current.set(descendantKey, { x: descendantPos.x, y: descendantPos.y });
            });
          }
      }
    } else {
        return;
      }
    }
    
    // Handle node/group dragging - move actual nodes with CSS transform
    if (isDraggingNodeRef.current && dragStartPosRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      // Store event for drop calculation
      lastMouseEventRef.current = e;
      
      const { startX, startY, nodeId } = isDraggingNodeRef.current;
      const screenDeltaX = e.clientX - startX;
      const screenDeltaY = e.clientY - startY;
      let deltaX = screenDeltaX / zoom;
      let deltaY = screenDeltaY / zoom;
      
      // Check if this is a child group (not a master group)
      const node = positionedNodes.find(n => n.id === nodeId);
      if (node && node.isGroup && !node.isMasterGroup) {
        // Child groups can only move vertically - lock X position
        deltaX = 0;
        
        // Constrain Y position to stay within parent's bounds
        const parentNode = positionedNodes.find(n => 
          n.id === node.masterGroupId || 
          n.id === node.groupId || 
          n.id === node.opacityGroupId
        );
        
        if (parentNode) {
          const parentKey = parentNode.isMasterGroup ? `master-${parentNode.id}` :
                           parentNode.isGroup ? (parentNode.id.startsWith('category:') ? `category-${parentNode.id}` : `group-${parentNode.id}`) :
                           `${parentNode.column}-${parentNode.id}`;
          const parentPos = nodePositionsRef.current.get(parentKey) || { x: parentNode.x, y: parentNode.y };
          
          // Get all siblings (other child groups at the same level)
          // For nested groups, siblings share the same parent (groupId, opacityGroupId, or masterGroupId)
          const siblings = positionedNodes.filter(n => {
            if (!n.isGroup || n.isMasterGroup || n.id === nodeId) {
              return false;
            }
            // Direct children of master group (category/palette groups with no parent group)
            if (node.masterGroupId && !node.groupId && !node.opacityGroupId && 
                n.masterGroupId === node.masterGroupId && !n.groupId && !n.opacityGroupId) {
              return true;
            }
            // Children of a regular group (nested groups - like opacity palette groups)
            if (node.groupId && (n.groupId === node.groupId || n.parentGroupId === node.id)) {
              return true;
            }
            // Children of opacity group (opacity palette groups)
            if (node.opacityGroupId && n.opacityGroupId === node.opacityGroupId) {
              return true;
            }
            // For semantic/component groups, also check graph links for sibling groups
            if ((n.column === 'semantic' || n.column === 'component') && 
                (node.column === 'semantic' || node.column === 'component')) {
              // Check if they share the same parent via graph links
              const nodeParentLink = graph.links.find(link => 
                link.target === node.id && link.type === 'group-member'
              );
              const nParentLink = graph.links.find(link => 
                link.target === n.id && link.type === 'group-member'
              );
              if (nodeParentLink && nParentLink && nodeParentLink.source === nParentLink.source) {
                return true;
              }
            }
            return false;
          });
          
          // Calculate parent bounds (from parent node to last sibling or child)
          let parentMinY = parentPos.y + ROW_HEIGHT + 12; // Start below parent
          let parentMaxY = parentMinY;
          
          siblings.forEach(sibling => {
            const siblingKey = sibling.id.startsWith('category:') ? `category-${sibling.id}` : `group-${sibling.id}`;
            const siblingPos = nodePositionsRef.current.get(siblingKey) || { x: sibling.x, y: sibling.y };
            const siblingNode = positionedNodes.find(n => n.id === sibling.id);
            if (siblingNode) {
              // Get all children of this sibling to find its bottom (including nested groups)
              const siblingChildren = positionedNodes.filter(n => {
                // Check direct properties first
                // For groups: check parentGroupId OR groupId (semantic child groups use groupId)
                if (n.isGroup && (n.parentGroupId === sibling.id || n.groupId === sibling.id)) {
                  return true;
                }
                // For tokens: check groupId or opacityGroupId
                if (!n.isGroup && (n.groupId === sibling.id || n.opacityGroupId === sibling.id)) {
                  return true;
                }
                // For semantic and component tokens/groups, also check graph links
                if (n.column === 'semantic' || n.column === 'component') {
                  const hasLink = graph.links.some(link => 
                    link.source === sibling.id && 
                    link.target === n.id && 
                    link.type === 'group-member'
                  );
                  return hasLink;
                }
                return false;
              });
              
              let siblingBottom = siblingPos.y + ROW_HEIGHT;
              siblingChildren.forEach(child => {
                const childKey = child.isGroup 
                  ? (child.id.startsWith('category:') ? `category-${child.id}` : `group-${child.id}`)
                  : `${child.column}-${child.id}`;
                const childPos = nodePositionsRef.current.get(childKey) || { x: child.x, y: child.y };
                const childHeight = child.isGroup ? ROW_HEIGHT : NODE_HEIGHT;
                siblingBottom = Math.max(siblingBottom, childPos.y + childHeight);
              });
              
              parentMaxY = Math.max(parentMaxY, siblingBottom);
            }
          });
          
          // Get dragged node's children to calculate its height (including nested groups)
          const draggedChildren = positionedNodes.filter(n => {
            // Check direct properties first
            // For groups: check parentGroupId OR groupId (semantic child groups use groupId)
            if (n.isGroup && (n.parentGroupId === nodeId || n.groupId === nodeId)) {
              return true;
            }
            // For tokens: check groupId or opacityGroupId
            if (!n.isGroup && (n.groupId === nodeId || n.opacityGroupId === nodeId)) {
              return true;
            }
            // For semantic and component tokens/groups, also check graph links
            if (n.column === 'semantic' || n.column === 'component') {
              const hasLink = graph.links.some(link => 
                link.source === nodeId && 
                link.target === n.id && 
                link.type === 'group-member'
              );
              return hasLink;
            }
            return false;
          });
          
          let draggedNodeBottom = dragStartPosRef.current.y + ROW_HEIGHT;
          draggedChildren.forEach(child => {
            const childKey = child.isGroup 
              ? (child.id.startsWith('category:') ? `category-${child.id}` : `group-${child.id}`)
              : `${child.column}-${child.id}`;
            const childOriginalPos = dragOriginalPositionsRef.current.get(childKey);
            if (childOriginalPos) {
              const childHeight = child.isGroup ? ROW_HEIGHT : NODE_HEIGHT;
              draggedNodeBottom = Math.max(draggedNodeBottom, childOriginalPos.y + childHeight);
            }
          });
          
          const draggedNodeHeight = draggedNodeBottom - dragStartPosRef.current.y;
          
          // Constrain Y position
          const newY = dragStartPosRef.current.y + deltaY;
          const constrainedY = Math.max(parentMinY, Math.min(newY, parentMaxY - draggedNodeHeight));
          deltaY = constrainedY - dragStartPosRef.current.y;
          
          // Calculate insertion point for divider line
          const tempFinalY = snapToGrid(dragStartPosRef.current.y + deltaY);
          
          // Helper function to get sibling height (including descendants)
          const getSiblingHeight = (siblingNode) => {
            const siblingKey = siblingNode.id.startsWith('category:') ? `category-${siblingNode.id}` : `group-${siblingNode.id}`;
            const siblingPos = nodePositionsRef.current.get(siblingKey) || { x: siblingNode.x, y: siblingNode.y };
            
            // Find all descendants to calculate total height
            const findAllDescendantsForDivider = (groupId) => {
              const descendants = [];
              const directChildren = positionedNodes.filter(n => {
                if (n.isGroup) {
                  return n.parentGroupId === groupId || n.groupId === groupId;
                }
                if (n.groupId === groupId || n.opacityGroupId === groupId) {
                  return true;
                }
                if (n.column === 'semantic' || n.column === 'component') {
                  return graph.links.some(link => 
                    link.source === groupId && 
                    link.target === n.id && 
                    link.type === 'group-member'
                  );
                }
                return false;
              });
              
              directChildren.forEach(child => {
                descendants.push(child);
                if (child.isGroup) {
                  descendants.push(...findAllDescendantsForDivider(child.id));
                }
              });
              
              return descendants;
            };
            
            const allDescendants = findAllDescendantsForDivider(siblingNode.id);
            let maxBottom = siblingPos.y + ROW_HEIGHT;
            
            allDescendants.forEach(descendant => {
              const descendantKey = descendant.isGroup 
                ? (descendant.id.startsWith('category:') ? `category-${descendant.id}` : `group-${descendant.id}`)
                : `${descendant.column}-${descendant.id}`;
              const descendantPos = nodePositionsRef.current.get(descendantKey) || { x: descendant.x, y: descendant.y };
              const descendantHeight = descendant.isGroup ? ROW_HEIGHT : NODE_HEIGHT;
              maxBottom = Math.max(maxBottom, descendantPos.y + descendantHeight);
            });
            
            return maxBottom - siblingPos.y;
          };
          
          // Get all siblings including the dragged one with heights
          const allSiblingsForDivider = [...siblings, node].map(sibling => {
            const siblingKey = sibling.id.startsWith('category:') ? `category-${sibling.id}` : `group-${sibling.id}`;
            const siblingPos = nodePositionsRef.current.get(siblingKey) || { x: sibling.x, y: sibling.y };
            const height = getSiblingHeight(sibling);
            return { node: sibling, originalY: siblingPos.y, height };
          });
          
          // Sort by original Y position
          allSiblingsForDivider.sort((a, b) => a.originalY - b.originalY);
          
          // Find insertion point
          const draggedIndex = allSiblingsForDivider.findIndex(s => s.node.id === nodeId);
          const draggedSibling = allSiblingsForDivider[draggedIndex];
          allSiblingsForDivider.splice(draggedIndex, 1);
          
          // Find where it would be inserted
          let insertIndex = 0;
          for (let i = 0; i < allSiblingsForDivider.length; i++) {
            if (tempFinalY < allSiblingsForDivider[i].originalY) {
              insertIndex = i;
              break;
            }
            insertIndex = i + 1;
          }
          
          // Calculate divider Y position using actual sibling heights
          const parentBottom = parentPos.y + ROW_HEIGHT;
          const spacing = 20;
          // Use same start offset as reordering logic
          const startOffset = (node.column === 'semantic' || node.column === 'component') ? 8 : 12;
          let dividerY = snapToGrid(parentBottom + startOffset);
          
          // Calculate position based on insertion index using actual heights
          for (let i = 0; i < insertIndex; i++) {
            dividerY = snapToGrid(dividerY + allSiblingsForDivider[i].height + spacing);
          }
          
          // Show divider line at insertion point
          const dividerWidth = NODE_WIDTH + (INDENT_AMOUNT * 2); // Width of group node
          setInsertionDivider({
            x: parentPos.x + INDENT_AMOUNT,
            y: dividerY - 1, // Position divider at insertion point
            width: dividerWidth
          });
        } else {
          // Not a child group - hide divider
          setInsertionDivider(null);
        }
      } else {
        // Not dragging a group - hide divider
        setInsertionDivider(null);
      }
      
      // Move all nodes by the same delta using transform (GPU accelerated)
      dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
        // Find the nodeId from the key
        let nodeId = null;
        if (nodeKey.startsWith('master-')) {
          nodeId = nodeKey.replace('master-', '');
        } else if (nodeKey.startsWith('category-')) {
          nodeId = nodeKey.replace('category-', '');
        } else if (nodeKey.startsWith('group-')) {
          nodeId = nodeKey.replace('group-', '');
        } else {
          // component/semantic/primitive-{nodeId}
          const parts = nodeKey.split('-');
          nodeId = parts.slice(1).join('-');
        }
        
        const nodeElement = draggedNodeRefs.current.get(nodeId);
        if (nodeElement) {
          nodeElement.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
          nodeElement.style.zIndex = '1000';
        }
      });
      
      // Calculate container bounds for parent node and all its children
      const draggedNode = positionedNodes.find(n => n.id === isDraggingNodeRef.current.nodeId);
      if (draggedNode) {
        // Get all nodes that are being dragged (parent + all children)
        const allDraggedNodes = [];
        allDraggedNodes.push(draggedNode);
        
        // Add all children from dragOriginalPositionsRef
        dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
          // Find the nodeId from the key
          let childNodeId = null;
          if (nodeKey.startsWith('master-')) {
            childNodeId = nodeKey.replace('master-', '');
          } else if (nodeKey.startsWith('category-')) {
            childNodeId = nodeKey.replace('category-', '');
          } else if (nodeKey.startsWith('group-')) {
            childNodeId = nodeKey.replace('group-', '');
          } else {
            // component/semantic/primitive-{nodeId}
            const parts = nodeKey.split('-');
            if (parts.length >= 2) {
              childNodeId = parts.slice(1).join('-');
            }
          }
          
          if (childNodeId && childNodeId !== draggedNode.id) {
            const childNode = positionedNodes.find(n => n.id === childNodeId);
            if (childNode) {
              allDraggedNodes.push(childNode);
            }
          }
        });
        
        // Calculate bounds of all dragged nodes at their current positions
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        allDraggedNodes.forEach(draggedNode => {
          const key = draggedNode.isMasterGroup ? `master-${draggedNode.id}` :
                     draggedNode.isGroup ? (draggedNode.id.startsWith('category:') ? `category-${draggedNode.id}` : `group-${draggedNode.id}`) :
                     `${draggedNode.column}-${draggedNode.id}`;
          const originalPos = dragOriginalPositionsRef.current.get(key);
          if (originalPos) {
            const currentX = originalPos.x + deltaX;
            const currentY = originalPos.y + deltaY;
            const nodeHeight = draggedNode.isMasterGroup ? 40 : NODE_HEIGHT;
            
            minX = Math.min(minX, currentX);
            minY = Math.min(minY, currentY);
            maxX = Math.max(maxX, currentX + NODE_WIDTH);
            maxY = Math.max(maxY, currentY + nodeHeight);
          }
        });
        
        // Update placeholder to show container bounds
        if (minX !== Infinity && minY !== Infinity) {
          const containerX = snapToGrid(minX);
          const containerY = snapToGrid(minY);
          const containerWidth = maxX - minX;
          const containerHeight = maxY - minY;
          
          if (placeholderPosition?.x !== containerX || placeholderPosition?.y !== containerY ||
              placeholderPosition?.width !== containerWidth || placeholderPosition?.height !== containerHeight) {
            setPlaceholderPosition({
              x: containerX,
              y: containerY,
              width: containerWidth,
              height: containerHeight
          });
        }
        }
      }
      
      return;
    }
    
    // Handle panning
    if (isPanningRef.current) {
      const deltaX = e.clientX - lastPanRef.current.x;
      const deltaY = e.clientY - lastPanRef.current.y;
      onPan(deltaX, deltaY);
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleMouseUp = (e) => {
    // Restore text selection
    document.body.style.userSelect = '';
    
    // Hide placeholder and divider
    setPlaceholderPosition(null);
    setInsertionDivider(null);
    
    // Clear pending drag
    pendingDragRef.current = null;
    
    // Only prevent default if we were actually dragging/panning
    if (isPanningRef.current || isDraggingNodeRef.current) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      }
    }
    
    if (isPanningRef.current) {
      isPanningRef.current = false;
      onDraggingChange(false);
    }
    
    // Handle node drag release
    if (isDraggingNodeRef.current && dragStartPosRef.current) {
      const { nodeId, startX, startY } = isDraggingNodeRef.current;
      const node = positionedNodes.find(n => n.id === nodeId);
      
      // Get final position from last mouse position
      const lastEvent = lastMouseEventRef.current || e;
      if (!lastEvent) {
        // If no last event, just clear the drag state
        isDraggingNodeRef.current = null;
        dragStartPosRef.current = null;
        dragOriginalPositionsRef.current.clear();
        onDraggingChange(false);
        return;
      }
      
      const screenDeltaX = lastEvent.clientX - startX;
      const screenDeltaY = lastEvent.clientY - startY;
      const deltaX = screenDeltaX / zoom;
      const deltaY = screenDeltaY / zoom;
      
      let finalX = snapToGrid(dragStartPosRef.current.x + deltaX);
      let finalY = snapToGrid(dragStartPosRef.current.y + deltaY);
      
      // If this is a child group, handle reordering of siblings
      if (node && node.isGroup && !node.isMasterGroup) {
        // Lock X position for child groups
        finalX = dragStartPosRef.current.x;
        
        // Helper function to recursively find all descendants of a group
        const findAllDescendants = (groupId) => {
          const descendants = [];
          // Find direct children - must match exactly
          const directChildren = positionedNodes.filter(n => {
            // For groups, check parentGroupId OR groupId (semantic child groups use groupId)
            if (n.isGroup) {
              return n.parentGroupId === groupId || n.groupId === groupId;
            }
            // For tokens, check groupId or opacityGroupId
            if (n.groupId === groupId || n.opacityGroupId === groupId) {
              return true;
            }
            // For semantic and component tokens, also check graph links
            if (n.column === 'semantic' || n.column === 'component') {
              const hasLink = graph.links.some(link => 
                link.source === groupId && 
                link.target === n.id && 
                link.type === 'group-member'
              );
              return hasLink;
            }
            return false;
          });
          
          directChildren.forEach(child => {
            descendants.push(child);
            // If child is a group, recursively find its descendants
            if (child.isGroup) {
              descendants.push(...findAllDescendants(child.id));
            }
          });
          
          return descendants;
        };
        
        // Get parent and siblings
        // For semantic/component groups, check graph links first to find parent
        let parentNode = null;
        if ((node.column === 'semantic' || node.column === 'component') && node.isGroup) {
          // Find parent via graph links
          const parentLink = graph.links.find(link => 
            link.target === node.id && link.type === 'group-member'
          );
          if (parentLink) {
            parentNode = positionedNodes.find(n => n.id === parentLink.source);
          }
        }
        
        // Fallback to property-based parent detection
        // Priority: groupId > parentGroupId > opacityGroupId > masterGroupId
        // This ensures semantic child groups find their category parent, not the master group
        if (!parentNode) {
          if (node.groupId) {
            parentNode = positionedNodes.find(n => n.id === node.groupId);
          }
          if (!parentNode && node.parentGroupId) {
            parentNode = positionedNodes.find(n => n.id === node.parentGroupId);
          }
          if (!parentNode && node.opacityGroupId) {
            parentNode = positionedNodes.find(n => n.id === node.opacityGroupId);
          }
          if (!parentNode && node.masterGroupId) {
            parentNode = positionedNodes.find(n => n.id === node.masterGroupId);
          }
        }
        
        if (parentNode) {
          // Get all siblings (other child groups at the same level)
          // For nested groups, siblings share the same parent (groupId, opacityGroupId, parentGroupId, or masterGroupId)
          const siblings = positionedNodes.filter(n => {
            if (!n.isGroup || n.isMasterGroup || n.id === nodeId) {
              return false;
            }
            
            // For semantic/component groups, check graph links for siblings
            if ((n.column === 'semantic' || n.column === 'component') && 
                (node.column === 'semantic' || node.column === 'component')) {
              // Check if they share the same parent via graph links
              const nodeParentLink = graph.links.find(link => 
                link.target === node.id && link.type === 'group-member'
              );
              const nParentLink = graph.links.find(link => 
                link.target === n.id && link.type === 'group-member'
              );
              if (nodeParentLink && nParentLink && nodeParentLink.source === nParentLink.source) {
                return true;
              }
            }
            
            // Direct children of master group (category/palette groups with no parent group)
            if (node.masterGroupId && !node.groupId && !node.opacityGroupId && !node.parentGroupId && 
                n.masterGroupId === node.masterGroupId && !n.groupId && !n.opacityGroupId && !n.parentGroupId) {
              return true;
            }
            // Children of a regular group (nested groups - like opacity palette groups)
            if (node.groupId && n.groupId === node.groupId) {
              return true;
            }
            // Children of opacity group (opacity palette groups)
            if (node.opacityGroupId && n.opacityGroupId === node.opacityGroupId) {
              return true;
            }
            // Children by parentGroupId (for primitive nested groups)
            if (node.parentGroupId && n.parentGroupId === node.parentGroupId) {
              return true;
            }
            
            return false;
          });
          
          // Get parent position to start children directly below it
          const parentKey = parentNode.isMasterGroup ? `master-${parentNode.id}` :
                           parentNode.isGroup ? (parentNode.id.startsWith('category:') ? `category-${parentNode.id}` : `group-${parentNode.id}`) :
                           `${parentNode.column}-${parentNode.id}`;
          const parentPos = nodePositionsRef.current.get(parentKey) || { x: parentNode.x, y: parentNode.y };
          const parentBottom = parentPos.y + ROW_HEIGHT;
          
          // Get all siblings including the dragged one, with their original positions and heights
          const allSiblings = [...siblings, node].map(sibling => {
            const siblingKey = sibling.id.startsWith('category:') ? `category-${sibling.id}` : `group-${sibling.id}`;
            const siblingPos = nodePositionsRef.current.get(siblingKey) || { x: sibling.x, y: sibling.y };
            
            // Calculate this sibling's total height (including ALL descendants recursively)
            // This should match the initial positioning logic: ROW_HEIGHT for the group itself,
            // plus the space needed for all descendants
            const allSiblingDescendants = findAllDescendants(sibling.id);
            
            let siblingHeight = ROW_HEIGHT; // At least the group itself
            if (allSiblingDescendants.length > 0) {
              // Find the bottom-most descendant
              // Start from the group's bottom (y + ROW_HEIGHT)
              let maxChildBottom = siblingPos.y + ROW_HEIGHT;
              let minChildTop = Infinity;
              
              allSiblingDescendants.forEach(descendant => {
                const descendantKey = descendant.isGroup 
                  ? (descendant.id.startsWith('category:') ? `category-${descendant.id}` : `group-${descendant.id}`)
                  : `${descendant.column}-${descendant.id}`;
                const descendantPos = nodePositionsRef.current.get(descendantKey) || { x: descendant.x, y: descendant.y };
                const descendantHeight = descendant.isGroup ? ROW_HEIGHT : NODE_HEIGHT;
                // Use the actual bottom position of the descendant
                maxChildBottom = Math.max(maxChildBottom, descendantPos.y + descendantHeight);
                // Track the minimum top position to ensure group is above its children
                minChildTop = Math.min(minChildTop, descendantPos.y);
              });
              
              // Height is from group top to bottom-most descendant bottom
              siblingHeight = maxChildBottom - siblingPos.y;
              
              // If any descendant is above the group, adjust the height calculation
              // This ensures the group is always above its children
              if (minChildTop < siblingPos.y + ROW_HEIGHT) {
                // Children are starting too high - this shouldn't happen, but if it does,
                // we need to ensure the group is positioned correctly
                // The height should still be from group top to bottom-most child
                // But we should ensure group Y is at least ROW_HEIGHT above the first child
                const expectedGroupY = minChildTop - ROW_HEIGHT - 8; // 8px spacing between group and first child
                if (siblingPos.y > expectedGroupY + 10) {
                  // Group is too far below where it should be - this indicates a positioning issue
                  // But we'll still use the calculated height for now
                }
              }
            }
            
            return { 
              node: sibling, 
              key: siblingKey, 
              originalY: siblingPos.y,
              height: siblingHeight
            };
          });
          
          // Determine the new order based on where the dragged node should be
          // Sort all siblings by their original Y position to get the initial order
          allSiblings.sort((a, b) => a.originalY - b.originalY);
          
          // Find where the dragged node should be inserted based on finalY
          const draggedIndex = allSiblings.findIndex(s => s.node.id === nodeId);
          const draggedSibling = allSiblings[draggedIndex];
          
          // Remove dragged sibling from its current position
          allSiblings.splice(draggedIndex, 1);
          
          // Find the new insertion point based on finalY
          let newIndex = 0;
          for (let i = 0; i < allSiblings.length; i++) {
            if (finalY < allSiblings[i].originalY) {
              newIndex = i;
              break;
            }
            newIndex = i + 1;
          }
          
          // Check if the position actually changed
          const originalIndex = allSiblings.findIndex(s => s.node.id === nodeId);
          const positionChanged = newIndex !== originalIndex;
          
          // If position didn't change and the dragged node is close to its original position,
          // just move it back without reordering all siblings to preserve spacing
          if (!positionChanged && Math.abs(finalY - draggedSibling.originalY) < 50) {
            // Just update the dragged node's position without reordering
            const draggedKey = draggedSibling.key;
            const draggedCurrentPos = nodePositionsRef.current.get(draggedKey) || { x: draggedSibling.node.x, y: draggedSibling.node.y };
            const draggedDeltaY = finalY - draggedSibling.originalY;
            
            // Update finalY to match the dragged position (snapped)
            finalY = snapToGrid(finalY);
            // finalX is already set correctly (locked for child groups)
            
            // Update dragged node position
            nodePositionsRef.current.set(draggedKey, {
              x: draggedCurrentPos.x,
              y: finalY
            });
            
            // Move ALL descendants by the same delta
            const allDraggedDescendants = findAllDescendants(nodeId);
            allDraggedDescendants.forEach(descendant => {
              const descendantKey = descendant.isGroup 
                ? (descendant.id.startsWith('category:') ? `category-${descendant.id}` : `group-${descendant.id}`)
                : `${descendant.column}-${descendant.id}`;
              const descendantPos = nodePositionsRef.current.get(descendantKey) || { x: descendant.x, y: descendant.y };
              nodePositionsRef.current.set(descendantKey, {
                x: descendantPos.x,
                y: snapToGrid(descendantPos.y + draggedDeltaY)
              });
            });
            
            // Clear transforms from all dragged nodes
            dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
              // Find the nodeId from the key
              let descendantNodeId = null;
              if (nodeKey.startsWith('master-')) {
                descendantNodeId = nodeKey.replace('master-', '');
              } else if (nodeKey.startsWith('category-')) {
                descendantNodeId = nodeKey.replace('category-', '');
              } else if (nodeKey.startsWith('group-')) {
                descendantNodeId = nodeKey.replace('group-', '');
              } else {
                // component/semantic/primitive-{nodeId}
                const parts = nodeKey.split('-');
                descendantNodeId = parts.slice(1).join('-');
              }
              
              const nodeElement = draggedNodeRefs.current.get(descendantNodeId);
              if (nodeElement) {
                nodeElement.style.transform = '';
                nodeElement.style.zIndex = '';
              }
            });
            
            // Trigger re-render with new positions
            setNodePositionsVersion(prev => prev + 1);
            
            // Skip the rest of the positioning logic since we've already updated positions
            // But we still need to update the main node position in the ref for consistency
            const key = node.isMasterGroup ? `master-${nodeId}` :
                       node.isGroup ? (node.id.startsWith('category:') ? `category-${nodeId}` : `group-${nodeId}`) :
                       `${node.column}-${nodeId}`;
            nodePositionsRef.current.set(key, { x: finalX, y: finalY });
          } else {
            // Position changed - reorder all siblings
            // Insert dragged sibling at new position
            allSiblings.splice(newIndex, 0, draggedSibling);
            
            // Now reorder all siblings with even spacing
            // Use the same spacing as initial positioning: 20 pixels between groups
            const spacing = 20; // Even spacing between groups (matches initial positioning)
            // Start position should match initial positioning
            // For semantic/component: parentBottom + 8 (matches line 182, 345)
            // For others: parentBottom + 12 (matches line 154)
            const startOffset = (node.column === 'semantic' || node.column === 'component') ? 8 : 12;
            let currentY = snapToGrid(parentBottom + startOffset); // Start directly below parent
            
            allSiblings.forEach((sibling, index) => {
              const siblingKey = sibling.node.id.startsWith('category:') ? `category-${sibling.node.id}` : `group-${sibling.node.id}`;
              const siblingCurrentPos = nodePositionsRef.current.get(siblingKey) || { x: sibling.node.x, y: sibling.node.y };
              // Get ALL descendants of this sibling (recursively)
              const allSiblingDescendants = findAllDescendants(sibling.node.id);
              
              // Calculate delta for this sibling
              const deltaY = currentY - sibling.originalY;
              
              // Move ALL descendants first to get their new positions
              const descendantNewPositions = new Map();
              allSiblingDescendants.forEach(descendant => {
                const descendantKey = descendant.isGroup 
                  ? (descendant.id.startsWith('category:') ? `category-${descendant.id}` : `group-${descendant.id}`)
                  : `${descendant.column}-${descendant.id}`;
                const descendantPos = nodePositionsRef.current.get(descendantKey) || { x: descendant.x, y: descendant.y };
                const newDescendantY = snapToGrid(descendantPos.y + deltaY);
                descendantNewPositions.set(descendantKey, { x: descendantPos.x, y: newDescendantY, isGroup: descendant.isGroup });
              });
              
              // Find the minimum Y position of child tokens (not nested groups)
              let minTokenY = Infinity;
              descendantNewPositions.forEach((pos, key) => {
                if (!pos.isGroup) {
                  minTokenY = Math.min(minTokenY, pos.y);
                }
              });
              
              // Ensure group is always above its first child token
              // Tokens should be at groupY + ROW_HEIGHT + 8
              let newSiblingY = snapToGrid(currentY);
              if (minTokenY !== Infinity && minTokenY < newSiblingY + ROW_HEIGHT + 8) {
                // First token is too close to or above the group - adjust group position
                newSiblingY = snapToGrid(minTokenY - ROW_HEIGHT - 8);
              }
              
              // Update sibling position
              nodePositionsRef.current.set(siblingKey, {
                x: siblingCurrentPos.x, // Keep X position
                y: newSiblingY
              });
              
              // Recalculate delta based on final group position
              const finalDeltaY = newSiblingY - sibling.originalY;
              
              // Update all descendants with corrected positions
              descendantNewPositions.forEach((pos, descendantKey) => {
                // If group position was adjusted, adjust tokens accordingly
                const adjustedY = pos.isGroup 
                  ? snapToGrid(pos.y + (finalDeltaY - deltaY))
                  : snapToGrid(pos.y + (finalDeltaY - deltaY));
                
                // Ensure tokens are at least ROW_HEIGHT + 8 below group
                const finalY = !pos.isGroup && adjustedY < newSiblingY + ROW_HEIGHT + 8
                  ? snapToGrid(newSiblingY + ROW_HEIGHT + 8)
                  : adjustedY;
                
                nodePositionsRef.current.set(descendantKey, {
                  x: pos.x,
                  y: finalY
                });
              });
              
              // Recalculate height after repositioning to ensure it's accurate
              let recalculatedHeight = ROW_HEIGHT;
              if (allSiblingDescendants.length > 0) {
                let maxChildBottom = newSiblingY + ROW_HEIGHT;
                descendantNewPositions.forEach((pos, descendantKey) => {
                  const descendantHeight = pos.isGroup ? ROW_HEIGHT : NODE_HEIGHT;
                  const finalPos = nodePositionsRef.current.get(descendantKey);
                  if (finalPos) {
                    maxChildBottom = Math.max(maxChildBottom, finalPos.y + descendantHeight);
                  }
                });
                recalculatedHeight = maxChildBottom - newSiblingY;
              }
              
              // Update currentY for next sibling: current position + this sibling's height + spacing
              currentY = snapToGrid(currentY + recalculatedHeight + spacing);
            });
          }
          
          // Set finalY to the calculated position for the dragged node
          // Recalculate to get the exact position using the same start offset
          let calculatedY = snapToGrid(parentBottom + startOffset);
          for (let i = 0; i < newIndex; i++) {
            calculatedY = snapToGrid(calculatedY + allSiblings[i].height + spacing);
          }
          finalY = calculatedY;
        }
      }
      
      const finalDeltaX = finalX - dragStartPosRef.current.x;
      const finalDeltaY = finalY - dragStartPosRef.current.y;
      
      if (node) {
        const key = node.isMasterGroup ? `master-${nodeId}` :
                   node.isGroup ? (node.id.startsWith('category:') ? `category-${nodeId}` : `group-${nodeId}`) :
                   `${node.column}-${nodeId}`;
        
        // Update position in ref
        nodePositionsRef.current.set(key, { x: finalX, y: finalY });
        
        // Move all stored nodes by the final delta (using original positions)
        dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
          if (nodeKey !== key) { // Skip the main node, already updated
            nodePositionsRef.current.set(nodeKey, {
              x: originalPos.x + finalDeltaX,
              y: originalPos.y + finalDeltaY
            });
          }
        });
        
        // Clear transforms from all dragged nodes
        dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
          // Find the nodeId from the key
          let nodeId = null;
          if (nodeKey.startsWith('master-')) {
            nodeId = nodeKey.replace('master-', '');
          } else if (nodeKey.startsWith('category-')) {
            nodeId = nodeKey.replace('category-', '');
          } else if (nodeKey.startsWith('group-')) {
            nodeId = nodeKey.replace('group-', '');
          } else {
            // component/semantic/primitive-{nodeId}
            const parts = nodeKey.split('-');
            nodeId = parts.slice(1).join('-');
          }
          
          const nodeElement = draggedNodeRefs.current.get(nodeId);
          if (nodeElement) {
            nodeElement.style.transform = '';
            nodeElement.style.zIndex = '';
          }
        });
        
        // Trigger re-render with new positions
        setNodePositionsVersion(prev => prev + 1);
      }
      
      // Clear drag state
      dragOriginalPositionsRef.current.clear();
      isDraggingNodeRef.current = null;
      dragStartPosRef.current = null;
      lastMouseEventRef.current = null;
      setInsertionDivider(null); // Hide divider on drag end
      onDraggingChange(false);
    }
  };

  // Handle wheel for zooming
  const handleWheel = (e) => {
    // Zoom with Cmd/Ctrl, pan with Shift, otherwise allow normal scroll
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      // Get mouse position relative to container (toolbar is floating, no offset needed)
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate new zoom - scroll down zooms out, scroll up zooms in (standard behavior)
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(3, zoom * zoomFactor));
      const delta = newZoom - zoom;
      
      if (delta !== 0) {
        // Pass coordinates relative to the container for zoom center point
        onZoom(delta, mouseX, mouseY);
      }
    } else if (e.shiftKey) {
      // Shift + wheel = horizontal pan
      e.preventDefault();
      onPan(e.deltaY, 0);
    }
    // Otherwise allow normal scrolling
  };

  // Prevent scrolling when dragging nodes - add document-level listeners
  useEffect(() => {
    const handleDocumentMouseMove = (e) => {
      // Only prevent if we're actually dragging/panning
      if (isDraggingNodeRef.current || isPanningRef.current) {
        // Don't prevent if it's on the container (let container handle it)
        if (!containerRef.current?.contains(e.target)) {
        e.preventDefault();
        }
      }
    };

    const handleDocumentMouseUp = (e) => {
      // If we're dragging/panning, ensure proper release
      if (isDraggingNodeRef.current || isPanningRef.current) {
        // Restore text selection
        document.body.style.userSelect = '';
        
        // Hide placeholder
        if (setPlaceholderPositionRef.current) {
          setPlaceholderPositionRef.current(null);
        }
        
        // Clear pending drag
        pendingDragRef.current = null;
        
        // Handle panning release
        if (isPanningRef.current) {
          isPanningRef.current = false;
          onDraggingChange(false);
        }
        
        // Handle node drag release
        if (isDraggingNodeRef.current && dragStartPosRef.current) {
          const { nodeId, startX, startY } = isDraggingNodeRef.current;
          const node = positionedNodesRef.current.find(n => n.id === nodeId);
          
          // Get final position from last mouse position
          const lastEvent = lastMouseEventRef.current || e;
          if (lastEvent) {
            const screenDeltaX = lastEvent.clientX - startX;
            const screenDeltaY = lastEvent.clientY - startY;
            const deltaX = screenDeltaX / zoom;
            const deltaY = screenDeltaY / zoom;
            
            const finalX = snapToGrid(dragStartPosRef.current.x + deltaX);
            const finalY = snapToGrid(dragStartPosRef.current.y + deltaY);
            const finalDeltaX = finalX - dragStartPosRef.current.x;
            const finalDeltaY = finalY - dragStartPosRef.current.y;
            
            if (node) {
              const key = node.isMasterGroup ? `master-${nodeId}` :
                         node.isGroup ? (node.id.startsWith('category:') ? `category-${nodeId}` : `group-${nodeId}`) :
                         `${node.column}-${nodeId}`;
              
              // Update position in ref
              nodePositionsRef.current.set(key, { x: finalX, y: finalY });
              
              // Move all stored nodes by the final delta (using original positions)
              dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
                if (nodeKey !== key) { // Skip the main node, already updated
                  nodePositionsRef.current.set(nodeKey, {
                    x: originalPos.x + finalDeltaX,
                    y: originalPos.y + finalDeltaY
                  });
                }
              });
              
              // Clear transforms from all dragged nodes
              dragOriginalPositionsRef.current.forEach((originalPos, nodeKey) => {
                // Find the nodeId from the key
                let nodeId = null;
                if (nodeKey.startsWith('master-')) {
                  nodeId = nodeKey.replace('master-', '');
                } else if (nodeKey.startsWith('category-')) {
                  nodeId = nodeKey.replace('category-', '');
                } else if (nodeKey.startsWith('group-')) {
                  nodeId = nodeKey.replace('group-', '');
                } else {
                  // component/semantic/primitive-{nodeId}
                  const parts = nodeKey.split('-');
                  nodeId = parts.slice(1).join('-');
                }
                
                const nodeElement = draggedNodeRefs.current.get(nodeId);
                if (nodeElement) {
                  nodeElement.style.transform = '';
                  nodeElement.style.zIndex = '';
                }
              });
              
              // Trigger re-render with new positions
              if (setNodePositionsVersionRef.current) {
                setNodePositionsVersionRef.current(prev => prev + 1);
              }
            }
          }
          
          // Clear drag state
          dragOriginalPositionsRef.current.clear();
          isDraggingNodeRef.current = null;
          dragStartPosRef.current = null;
          lastMouseEventRef.current = null;
          onDraggingChange(false);
        }
        
        // Prevent default to stop any unwanted behavior
        if (!containerRef.current?.contains(e.target)) {
        e.preventDefault();
        }
      }
    };

    const handleDocumentSelectStart = (e) => {
      // Only prevent selection during drag/pan
      if (isDraggingNodeRef.current || isPanningRef.current) {
        e.preventDefault();
      }
    };

    // Add listeners - use capture phase but don't block everything
    document.addEventListener('mousemove', handleDocumentMouseMove, { passive: false });
    document.addEventListener('mouseup', handleDocumentMouseUp, { passive: false });
    document.addEventListener('selectstart', handleDocumentSelectStart, { passive: false });

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('selectstart', handleDocumentSelectStart);
    };
  }, [zoom, onDraggingChange]);


  // Helper to convert underscore-separated names to dot-separated (lowercase)
  const convertUnderscoreToDot = (name) => {
    if (!name || typeof name !== 'string') return name;
    if (!name.includes('_')) return name.toLowerCase();
    return name.toLowerCase().replace(/_/g, '.');
  };

  // Helper to resolve a raw value to an actual token ID
  const resolveTokenId = useCallback((rawValue) => {
    if (!rawValue || typeof rawValue !== 'string' || rawValue.startsWith('#')) {
      return null;
    }
    
    // Try multiple lookup strategies (same as rebuildLinksWithPrimitives)
    // 1. Try original name as-is (e.g., 'NEUTRAL_69')
    let targetNode = allNodes.find(n => n.id === rawValue || n.originalName === rawValue);
    if (targetNode) return targetNode.id;
    
    // 2. Try converted name (e.g., 'neutral.69')
    const convertedValue = convertUnderscoreToDot(rawValue);
    if (convertedValue !== rawValue) {
      targetNode = allNodes.find(n => n.id === convertedValue || n.originalName === convertedValue);
      if (targetNode) return targetNode.id;
    }
    
    // 3. Check if rawValue matches an originalName of a semantic token
    targetNode = allNodes.find(n => n.originalName === rawValue);
    if (targetNode) return targetNode.id;
    
    // 4. Check if converted rawValue matches any node's id or originalName
    targetNode = allNodes.find(n => 
      n.id === convertedValue || 
      n.originalName === convertedValue ||
      (n.originalName && convertUnderscoreToDot(n.originalName) === convertedValue)
    );
    if (targetNode) return targetNode.id;
    
    // 5. Try case-insensitive search as last resort
    targetNode = allNodes.find(n => {
      const nConverted = convertUnderscoreToDot(n.name || n.id || '');
      return nConverted.toLowerCase() === convertedValue.toLowerCase() || 
             n.name?.toLowerCase() === rawValue.toLowerCase() ||
             n.id?.toLowerCase() === rawValue.toLowerCase() ||
             n.originalName?.toLowerCase() === rawValue.toLowerCase();
    });
    if (targetNode) return targetNode.id;
    
    return null;
  }, [allNodes]);

  // Trace connection chain from a token down to primitive tokens
  const traceConnectionChain = useCallback((tokenId, visited = new Set()) => {
    if (visited.has(tokenId)) return []; // Prevent cycles
    visited.add(tokenId);
    
    const chain = [tokenId];
    const token = allNodes.find(n => n.id === tokenId);
    if (!token) return chain;
    
    // If it's already a primitive, we're done
    if (token.layer === 'primitive') {
      return chain;
    }
    
    // Find the token's value in the current mode
    let targetTokenId = null;
    if (token.modes && token.modes[selectedMode]) {
      const value = token.modes[selectedMode];
      if (typeof value === 'string' && !value.startsWith('#')) {
        // It's a reference to another token - resolve it to the actual token ID
        targetTokenId = resolveTokenId(value);
      }
    }
    
    // If we found a reference, trace it
    if (targetTokenId) {
      const nextChain = traceConnectionChain(targetTokenId, visited);
      return [...chain, ...nextChain];
    }
    
    return chain;
  }, [allNodes, selectedMode, resolveTokenId]);
  
  // Function to enter focus mode (called on double click)
  const enterFocusMode = useCallback((tokenId) => {
    // Check if it's an actual token (not a group or master group)
    // Try allNodes first since it's more reliable, then positionedNodesRef
    const selectedNode = allNodes.find(n => n.id === tokenId) ||
                        positionedNodesRef.current.find(n => n.id === tokenId);
    
    // Only enter focus mode for actual tokens, not groups or master groups
    if (!selectedNode || selectedNode.isMasterGroup || selectedNode.isGroup) {
      return;
    }
    
    // Enter focus mode for actual tokens
    // Get referenced chain (tokens that the selected token references - left side)
    // traceConnectionChain returns [selectedToken, ...chainToPrimitive], so we remove selected and reverse
    const referencedChainFull = traceConnectionChain(tokenId);
    const referencedChain = referencedChainFull.length > 1 ? referencedChainFull.slice(1).reverse() : [];
    
    // Get consuming tokens (tokens that reference the selected token - right side)
    const consumingTokens = graph.links
      .filter(link => link.target === tokenId && link.type !== 'group-member' && link.type !== 'master-group-member')
      .map(link => allNodes.find(n => n.id === link.source))
      .filter(Boolean)
      .filter(node => !node.isMasterGroup && !node.isGroup); // Only actual tokens, not groups
    
    // Store original view (only if not already in focus mode - preserve the original view)
    if (!focusMode) {
      originalViewRef.current = { panX, panY, zoom };
    }
    
    // Clear selection when entering/switching focus mode
    if (onTokenSelect && selectedTokens.length > 0) {
      // Clear all selections
      selectedTokens.forEach(tokenId => {
        // This will be handled by the parent component's clear selection
      });
      // Call clear selection if available, or we'll handle it in the component
    }
    
    // Build the full chain: [referenced tokens] -> [selected token] -> [consuming tokens]
    const allChainNodes = [
      ...referencedChain.map(id => allNodes.find(n => n.id === id)).filter(Boolean),
      ...consumingTokens
    ];
    
    // Always enter focus mode if we have a token (even if no chain or consuming tokens)
    if (selectedNode && !selectedNode.isMasterGroup && !selectedNode.isGroup) {
      // Get viewport dimensions
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Find the node's current position in the positioned nodes
      // First try to find it in the current positioned nodes
      const positionedNode = positionedNodesRef.current.find(n => n.id === tokenId);
      let selectedNodeGraphX, selectedNodeGraphY;
      
      if (positionedNode && typeof positionedNode.x === 'number' && !isNaN(positionedNode.x) && 
          typeof positionedNode.y === 'number' && !isNaN(positionedNode.y)) {
        // Use position from positioned nodes (most reliable)
        selectedNodeGraphX = positionedNode.x;
        selectedNodeGraphY = positionedNode.y + NODE_HEIGHT / 2; // Adjust for node center
      } else {
        // Fallback: try to get from saved positions or node properties
        const key = selectedNode.isMasterGroup ? `master-${selectedNode.id}` :
                   selectedNode.isGroup ? (selectedNode.id.startsWith('category:') ? `category-${selectedNode.id}` : `group-${selectedNode.id}`) :
                   `${selectedNode.column}-${selectedNode.id}`;
        const currentPos = nodePositionsRef.current.get(key);
        if (currentPos && typeof currentPos.x === 'number' && !isNaN(currentPos.x) && 
            typeof currentPos.y === 'number' && !isNaN(currentPos.y)) {
          selectedNodeGraphX = currentPos.x;
          selectedNodeGraphY = currentPos.y + NODE_HEIGHT / 2;
        } else if (selectedNode.x !== undefined && selectedNode.y !== undefined) {
          selectedNodeGraphX = selectedNode.x;
          selectedNodeGraphY = selectedNode.y + NODE_HEIGHT / 2;
        } else {
          console.error('Could not find position for token:', tokenId, selectedNode);
          return; // Can't proceed without a valid position
        }
      }
      
      // Final validation - if we still don't have valid coordinates, abort
      if (typeof selectedNodeGraphX !== 'number' || isNaN(selectedNodeGraphX) || !isFinite(selectedNodeGraphX) ||
          typeof selectedNodeGraphY !== 'number' || isNaN(selectedNodeGraphY) || !isFinite(selectedNodeGraphY)) {
        console.warn('Unable to determine valid graph position for token:', { tokenId, selectedNodeGraphX, selectedNodeGraphY });
        return;
      }
      
      // Use even spacing for all nodes
      const evenSpacing = NODE_WIDTH + 100; // Consistent spacing between all nodes
      
      // Calculate positions:
      // Referenced chain on the left (reversed so primitive is leftmost)
      const referencedNodes = referencedChain.map(id => allNodes.find(n => n.id === id)).filter(Boolean);
      const referencedCount = referencedNodes.length;
      
      // Consuming tokens on the right (stacked vertically)
      const consumingCount = consumingTokens.length;
      
      // Calculate total number of nodes horizontally (referenced + selected + consuming column)
      const totalHorizontalNodes = referencedCount + 1 + (consumingCount > 0 ? 1 : 0);
      
      // Calculate total width needed for horizontal layout
      const totalWidth = totalHorizontalNodes > 1 ? (totalHorizontalNodes - 1) * evenSpacing + NODE_WIDTH : NODE_WIDTH;
      
      // Calculate total height needed for consuming tokens (stacked vertically)
      const maxConsumingHeight = consumingCount > 0 ? consumingCount * (NODE_HEIGHT + 20) - 20 : 0;
      const totalHeight = Math.max(NODE_HEIGHT, maxConsumingHeight);
      
      // Validate that we have valid graph coordinates
      if (typeof selectedNodeGraphX !== 'number' || isNaN(selectedNodeGraphX) || !isFinite(selectedNodeGraphX) ||
          typeof selectedNodeGraphY !== 'number' || isNaN(selectedNodeGraphY) || !isFinite(selectedNodeGraphY)) {
        console.warn('Invalid node graph position for focus mode:', { selectedNodeGraphX, selectedNodeGraphY, tokenId });
        return;
      }
      
      // Use the token's current position as the center for the layout
      // This ensures the layout is centered around where the token actually is
      const graphCenterX = selectedNodeGraphX;
      const graphCenterY = selectedNodeGraphY;
      
      // Start X position: center minus half the total width
      const startX = graphCenterX - totalWidth / 2;
      const chainY = graphCenterY; // Center vertically in graph coordinates
      
      // Validate calculated positions are valid
      if (isNaN(startX) || !isFinite(startX) || isNaN(chainY) || !isFinite(chainY)) {
        console.warn('Invalid calculated positions for focus mode:', { startX, chainY, graphCenterX, graphCenterY, totalWidth });
        return;
      }
      
      // Build linear positions (in graph coordinates)
      const linearPositions = [];
      
      // Add referenced nodes (left side, primitive is leftmost)
      referencedNodes.forEach((node, index) => {
        const focusX = startX + index * evenSpacing;
        const focusY = chainY - NODE_HEIGHT / 2;
        if (isNaN(focusX) || !isFinite(focusX) || isNaN(focusY) || !isFinite(focusY)) {
          console.warn('Invalid position for referenced node:', { nodeId: node.id, focusX, focusY, startX, index, evenSpacing });
          return;
        }
        linearPositions.push({
          id: node.id,
          focusX,
          focusY
        });
      });
      
      // Add selected node (after referenced nodes)
      const selectedNodeX = startX + referencedCount * evenSpacing;
      const selectedNodeY = chainY - NODE_HEIGHT / 2;
      if (!isNaN(selectedNodeX) && isFinite(selectedNodeX) && !isNaN(selectedNodeY) && isFinite(selectedNodeY)) {
        linearPositions.push({
          id: tokenId,
          focusX: selectedNodeX,
          focusY: selectedNodeY
        });
      } else {
        console.warn('Invalid position for selected node:', { tokenId, selectedNodeX, selectedNodeY });
        return;
      }
      
      // Add consuming tokens (right side, stacked vertically)
      const consumingStartX = startX + (referencedCount + 1) * evenSpacing;
      const consumingStartY = chainY - (maxConsumingHeight / 2) + (NODE_HEIGHT / 2);
      consumingTokens.forEach((node, index) => {
        const focusX = consumingStartX;
        const focusY = consumingStartY + index * (NODE_HEIGHT + 20);
        if (isNaN(focusX) || !isFinite(focusX) || isNaN(focusY) || !isFinite(focusY)) {
          console.warn('Invalid position for consuming node:', { nodeId: node.id, focusX, focusY });
          return;
        }
        linearPositions.push({
          id: node.id,
          focusX,
          focusY
        });
      });
      
      // Filter out any positions with invalid coordinates
      const validPositions = linearPositions.filter(p => 
        typeof p.focusX === 'number' && !isNaN(p.focusX) && isFinite(p.focusX) &&
        typeof p.focusY === 'number' && !isNaN(p.focusY) && isFinite(p.focusY)
      );
      
      if (validPositions.length === 0) {
        console.warn('No valid positions after filtering for focus mode');
        return;
      }
      
      const minX = Math.min(...validPositions.map(p => p.focusX));
      const maxX = Math.max(...validPositions.map(p => p.focusX)) + NODE_WIDTH;
      const minY = Math.min(...validPositions.map(p => p.focusY));
      const maxY = Math.max(...validPositions.map(p => p.focusY)) + NODE_HEIGHT;
      
      // Validate bounding box
      if (isNaN(minX) || isNaN(maxX) || isNaN(minY) || isNaN(maxY) || 
          !isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
        console.warn('Invalid bounding box for focus mode:', { minX, maxX, minY, maxY });
        return;
      }
      
      const chainWidth = maxX - minX;
      const chainHeight = maxY - minY;
      
      // Add padding around the chain
      const padding = 80;
      const paddedWidth = Math.max(chainWidth + padding * 2, NODE_WIDTH + padding * 2);
      const paddedHeight = Math.max(chainHeight + padding * 2, NODE_HEIGHT + padding * 2);
      
      // Calculate zoom to fit all nodes, capped at 120%
      // Ensure we don't divide by zero or get invalid values
      const availableWidth = Math.max(viewportWidth - SIDEBAR_WIDTH, 100);
      const availableHeight = Math.max(viewportHeight, 100);
      
      const zoomX = paddedWidth > 0 ? availableWidth / paddedWidth : 1.2;
      const zoomY = paddedHeight > 0 ? availableHeight / paddedHeight : 1.2;
      
      // Ensure zoom values are valid numbers
      const validZoomX = isNaN(zoomX) || !isFinite(zoomX) ? 1.2 : zoomX;
      const validZoomY = isNaN(zoomY) || !isFinite(zoomY) ? 1.2 : zoomY;
      
      const calculatedZoom = Math.max(0.1, Math.min(validZoomX, validZoomY, 1.2)); // Cap at 120%, minimum 0.1
      
      // Calculate center of chain in graph coordinates
      const chainCenterX = (minX + maxX) / 2;
      const chainCenterY = (minY + maxY) / 2;
      
      // Build full chain array for focus mode
      const fullChain = [
        ...referencedChain,
        tokenId,
        ...consumingTokens.map(n => n.id)
      ];
        
      // Only set focus mode if we have valid linear positions
      const validLinearPositions = linearPositions.filter(p => 
        typeof p.focusX === 'number' && !isNaN(p.focusX) && isFinite(p.focusX) &&
        typeof p.focusY === 'number' && !isNaN(p.focusY) && isFinite(p.focusY)
      );
      
      if (validLinearPositions.length === 0) {
        console.warn('No valid linear positions for focus mode, aborting');
        return;
      }
      
      setFocusMode({
        selectedTokenId: tokenId,
        chain: fullChain,
        linearPositions: validLinearPositions,
        consumingTokens: consumingTokens.map(n => n.id),
        originalPan: { x: panX, y: panY },
        originalZoom: zoom
      });
      
      // Get container bounds for coordinate conversion
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        console.warn('Container rect not available for focus mode');
        return;
      }
      
      // Get the selected token's position from the NEW linear positions (focus layout)
      const selectedTokenPos = validLinearPositions.find(p => p.id === tokenId);
      if (!selectedTokenPos) {
        console.warn('Selected token position not found in linear positions');
        return;
      }
      
      // Calculate the token's position in the NEW linear layout (graph coordinates)
      const tokenFocusX = selectedTokenPos.focusX;
      const tokenFocusY = selectedTokenPos.focusY;
      
      // Calculate the token's current screen position using the NEW linear position
      const tokenScreenX = tokenFocusX * zoom + panX;
      const tokenScreenY = tokenFocusY * zoom + panY;
      
      // Convert to container-relative coordinates (onZoom expects container-relative)
      const tokenContainerX = tokenScreenX - containerRect.left;
      const tokenContainerY = tokenScreenY - containerRect.top;
      
      // Use the chain center for zoom point to ensure the whole chain is visible
      const chainCenterScreenX = chainCenterX * zoom + panX;
      const chainCenterScreenY = chainCenterY * zoom + panY;
      const chainCenterContainerX = chainCenterScreenX - containerRect.left;
      const chainCenterContainerY = chainCenterScreenY - containerRect.top;
      
      // Determine zoom point - use chain center for better centering
      let zoomPointX, zoomPointY;
      if (focusMode && focusMode.linearPositions) {
        // Switching focus: use the chain center from current focus layout
        const currentChainCenter = {
          x: (Math.min(...focusMode.linearPositions.map(p => p.focusX)) + 
              Math.max(...focusMode.linearPositions.map(p => p.focusX))) / 2,
          y: (Math.min(...focusMode.linearPositions.map(p => p.focusY)) + 
              Math.max(...focusMode.linearPositions.map(p => p.focusY))) / 2
        };
        const currentScreenX = currentChainCenter.x * zoom + panX;
        const currentScreenY = currentChainCenter.y * zoom + panY;
        zoomPointX = currentScreenX - containerRect.left;
        zoomPointY = currentScreenY - containerRect.top;
      } else {
        // Entering focus mode: zoom at the chain center
        zoomPointX = chainCenterContainerX;
        zoomPointY = chainCenterContainerY;
      }
      
      // Calculate where we want the chain center to be on screen (target position)
      const targetScreenCenterX = (viewportWidth - SIDEBAR_WIDTH) / 2 + SIDEBAR_WIDTH;
      const targetScreenCenterY = viewportHeight / 2;
      
      // Calculate what the pan needs to be to center the chain after zoom
      // Formula: targetScreenX = chainCenterX * newZoom + newPanX
      // Solving: newPanX = targetScreenX - chainCenterX * newZoom
      const targetPanX = targetScreenCenterX - chainCenterX * calculatedZoom;
      const targetPanY = targetScreenCenterY - chainCenterY * calculatedZoom;
      
      // Calculate what pan will be after zoom (onZoom adjusts pan to keep zoom point fixed)
      // onZoom formula from App.jsx: newPanX = panX + (centerX - panX) * (1 - zoomRatio)
      // where centerX is container-relative
      const zoomRatio = calculatedZoom / zoom;
      const panAfterZoomX = panX + (zoomPointX - panX) * (1 - zoomRatio);
      const panAfterZoomY = panY + (zoomPointY - panY) * (1 - zoomRatio);
      
      // Calculate the pan delta needed to go from post-zoom position to target position
      const panDeltaX = targetPanX - panAfterZoomX;
      const panDeltaY = targetPanY - panAfterZoomY;
      
      // Apply zoom - onZoom will handle pan adjustment internally
      onZoom(calculatedZoom - zoom, zoomPointX, zoomPointY);
      
      // After zoom, pan to center the chain
      // Use requestAnimationFrame to ensure zoom state has updated
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Apply the pan adjustment to center the chain
          // onPan is additive, so we pass the delta
          onPan(panDeltaX, panDeltaY);
        });
      });
    }
  }, [panX, panY, zoom, onPan, onZoom, traceConnectionChain, allNodes, graph, focusMode]);
  
  // Function to exit focus mode
  const exitFocusMode = useCallback(() => {
    if (focusMode && originalViewRef.current.panX !== null && originalViewRef.current.panY !== null && originalViewRef.current.zoom !== null) {
      const originalPanX = originalViewRef.current.panX;
      const originalPanY = originalViewRef.current.panY;
      const originalZoom = originalViewRef.current.zoom;
      
      // Get container bounds for coordinate conversion
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        // Fallback: just restore values directly
        setFocusMode(null);
        originalViewRef.current = { panX: null, panY: null, zoom: null };
        return;
      }
      
      // Calculate the center of the current viewport in container-relative coordinates
      const viewportCenterX = (window.innerWidth - SIDEBAR_WIDTH) / 2 + SIDEBAR_WIDTH - containerRect.left;
      const viewportCenterY = window.innerHeight / 2 - containerRect.top;
      
      // Calculate zoom delta
      const deltaZoom = originalZoom - zoom;
      
      // Calculate what the pan will be after zoom (onZoom adjusts pan internally)
      // Use the same formula that onZoom uses: newPanX = panX + (centerX - panX) * (1 - zoomRatio)
      const zoomRatio = originalZoom / zoom;
      const panAfterZoomX = panX + (viewportCenterX - panX) * (1 - zoomRatio);
      const panAfterZoomY = panY + (viewportCenterY - panY) * (1 - zoomRatio);
      
      // Calculate pan adjustment needed to restore original position
      const panAdjustX = originalPanX - panAfterZoomX;
      const panAdjustY = originalPanY - panAfterZoomY;
      
      // Apply zoom first (it will adjust pan internally)
      if (Math.abs(deltaZoom) > 0.001) {
        onZoom(deltaZoom, viewportCenterX, viewportCenterY);
      }
      
      // Then apply the pan adjustment to restore original position
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onPan(panAdjustX, panAdjustY);
        });
      });
    }
    setFocusMode(null);
    originalViewRef.current = { panX: null, panY: null, zoom: null };
  }, [focusMode, panX, panY, zoom, onPan, onZoom]);

  // Keyboard shortcuts (moved after exitFocusMode definition to avoid initialization error)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape: Exit focus mode or clear selection
      if (e.code === 'Escape') {
        if (focusMode) {
          exitFocusMode();
          e.preventDefault();
        }
        return;
      }
      
      // Don't handle shortcuts when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      if (e.code === 'KeyZ' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Z = zoom in at viewport center
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          onZoom(0.1, centerX, centerY);
        } else {
          onZoom(0.1, 0, 0);
        }
        e.preventDefault();
      } else if (e.code === 'KeyZ' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Shift+Z = zoom out at viewport center
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          onZoom(-0.1, centerX, centerY);
        } else {
          onZoom(-0.1, 0, 0);
        }
        e.preventDefault();
      } else if (e.code === 'ArrowUp' && !e.metaKey && !e.ctrlKey) {
        onPan(0, 30 * (e.shiftKey ? 10 : 1)); // Arrow Up = pan up
        e.preventDefault();
      } else if (e.code === 'ArrowDown' && !e.metaKey && !e.ctrlKey) {
        onPan(0, -30 * (e.shiftKey ? 10 : 1)); // Arrow Down = pan down
        e.preventDefault();
      } else if (e.code === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        onPan(30 * (e.shiftKey ? 10 : 1), 0); // Arrow Left = pan left
        e.preventDefault();
      } else if (e.code === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        onPan(-30 * (e.shiftKey ? 10 : 1), 0); // Arrow Right = pan right
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPan, onZoom, focusMode, exitFocusMode]);

  // Get connections for rendering (exclude group-member and master-group-member links)
  // Calculate which nodes are connected to selected tokens (for interactive highlighting)
  const connectedToSelectedNodes = useMemo(() => {
    if (!interactiveHighlighting || selectedTokens.length === 0 || !graph.links) {
      return new Set();
    }
    
    const connected = new Set(selectedTokens); // Include selected tokens themselves
    
    // Find all nodes connected to selected tokens
    graph.links.forEach(link => {
      if (selectedTokens.includes(link.source)) {
        connected.add(link.target);
      }
      if (selectedTokens.includes(link.target)) {
        connected.add(link.source);
      }
    });
    
    return connected;
  }, [interactiveHighlighting, selectedTokens, graph.links]);

  // Skip calculation during drag for performance
  // Memoize positionedNodesMap for faster lookups
  const positionedNodesMap = useMemo(() => {
    if (!positionedNodes || positionedNodes.length === 0) return new Map();
    const map = new Map();
    positionedNodes.forEach(node => {
      map.set(node.id, node);
    });
    return map;
  }, [positionedNodes]);
  
  const connections = useMemo(() => {
    if (isDraggingNodeRef.current) return []; // Skip during drag
    if (!graph.links || !positionedNodes || positionedNodes.length === 0) return [];
    
    // In focus mode, show connections in the chain and to consuming tokens
    if (focusMode) {
      const chainConnections = [];
      const selectedTokenId = focusMode.selectedTokenId;
      
      // Create a map for faster lookups
      const linearPositionsMap = new Map(focusMode.linearPositions.map(p => [p.id, p]));
      
      // Get referenced chain (left side) - these are before the selected token in the chain
      const selectedIndex = focusMode.chain.indexOf(selectedTokenId);
      const referencedChain = selectedIndex > 0 ? focusMode.chain.slice(0, selectedIndex) : [];
      
      // Add connections in the referenced chain (left side)
      for (let i = 0; i < referencedChain.length - 1; i++) {
        const sourceId = referencedChain[i];
        const targetId = referencedChain[i + 1];
        const sourcePos = linearPositionsMap.get(sourceId);
        const targetPos = linearPositionsMap.get(targetId);
        if (sourcePos && targetPos && 
            typeof sourcePos.focusX === 'number' && !isNaN(sourcePos.focusX) &&
            typeof sourcePos.focusY === 'number' && !isNaN(sourcePos.focusY) &&
            typeof targetPos.focusX === 'number' && !isNaN(targetPos.focusX) &&
            typeof targetPos.focusY === 'number' && !isNaN(targetPos.focusY)) {
          const connectionY = sourcePos.focusY + NODE_HEIGHT / 2;
          chainConnections.push({
            source: sourceId,
            target: targetId,
            sourceX: sourcePos.focusX + NODE_WIDTH,
            sourceY: connectionY,
            targetX: targetPos.focusX,
            targetY: connectionY,
            type: 'reference',
            isChain: true,
            isHorizontal: true,
            sourceSide: 'right',
            targetSide: 'left'
          });
        }
      }
      
      // Add connection from last referenced token to selected token (or from first token if no referenced chain)
      const selectedPos = linearPositionsMap.get(selectedTokenId);
      if (selectedPos && 
          typeof selectedPos.focusX === 'number' && !isNaN(selectedPos.focusX) &&
          typeof selectedPos.focusY === 'number' && !isNaN(selectedPos.focusY)) {
        if (referencedChain.length > 0) {
          // Connect from last referenced token to selected token
          const lastReferencedId = referencedChain[referencedChain.length - 1];
          const lastReferencedPos = linearPositionsMap.get(lastReferencedId);
          if (lastReferencedPos &&
              typeof lastReferencedPos.focusX === 'number' && !isNaN(lastReferencedPos.focusX) &&
              typeof lastReferencedPos.focusY === 'number' && !isNaN(lastReferencedPos.focusY)) {
            const connectionY = selectedPos.focusY + NODE_HEIGHT / 2;
            chainConnections.push({
              source: lastReferencedId,
              target: selectedTokenId,
              sourceX: lastReferencedPos.focusX + NODE_WIDTH,
              sourceY: connectionY,
              targetX: selectedPos.focusX,
              targetY: connectionY,
              type: 'reference',
              isChain: true,
              isHorizontal: true,
              sourceSide: 'right',
              targetSide: 'left'
            });
          }
        }
        // Note: If there's no referenced chain, the selected token is a primitive
        // Connections to consuming tokens are handled below
      }
      
      // Add connections from selected token to consuming tokens (right side)
      if (focusMode.consumingTokens && selectedPos) {
        focusMode.consumingTokens.forEach(consumingId => {
          const consumingPos = linearPositionsMap.get(consumingId);
          if (selectedPos && consumingPos &&
              typeof selectedPos.focusX === 'number' && !isNaN(selectedPos.focusX) &&
              typeof selectedPos.focusY === 'number' && !isNaN(selectedPos.focusY) &&
              typeof consumingPos.focusX === 'number' && !isNaN(consumingPos.focusX) &&
              typeof consumingPos.focusY === 'number' && !isNaN(consumingPos.focusY)) {
            // For stacked consuming tokens, create a path that goes horizontally from selected,
            // then vertically to the consuming token
            const midX = selectedPos.focusX + NODE_WIDTH + 40; // Horizontal offset before vertical line
            chainConnections.push({
              source: selectedTokenId,
              target: consumingId,
              sourceX: selectedPos.focusX + NODE_WIDTH, // Right side of selected
              sourceY: selectedPos.focusY + NODE_HEIGHT / 2,
              targetX: consumingPos.focusX, // Left side of consuming token
              targetY: consumingPos.focusY + NODE_HEIGHT / 2,
              midX: midX, // Intermediate point for L-shaped path
              type: 'reference',
              isChain: true,
              isHorizontal: false, // L-shaped path
              sourceSide: 'right',
              targetSide: 'left'
            });
          }
        });
      }
      
      return chainConnections;
    }
    
    return graph.links
      .filter(link => link.type !== 'group-member' && link.type !== 'master-group-member')
      .map(link => {
        const sourceNode = positionedNodesMap.get(link.source);
        const targetNode = positionedNodesMap.get(link.target);
        if (sourceNode && targetNode) {
          // Validate node positions are valid numbers
          const sourceX = typeof sourceNode.x === 'number' && !isNaN(sourceNode.x) ? sourceNode.x : 0;
          const sourceY = typeof sourceNode.y === 'number' && !isNaN(sourceNode.y) ? sourceNode.y : 0;
          const targetX = typeof targetNode.x === 'number' && !isNaN(targetNode.x) ? targetNode.x : 0;
          const targetY = typeof targetNode.y === 'number' && !isNaN(targetNode.y) ? targetNode.y : 0;
          
          // Skip if positions are invalid
          if (isNaN(sourceX) || isNaN(sourceY) || isNaN(targetX) || isNaN(targetY)) {
            return null;
          }
          
          // Determine which side to connect from based on relative positions
          // If target is to the right of source, connect from source's right side to target's left side
          // If target is to the left of source, connect from source's left side to target's right side
          const sourceCenterX = sourceX + NODE_WIDTH / 2;
          const targetCenterX = targetX + NODE_WIDTH / 2;
          const sourceYCenter = sourceY + NODE_HEIGHT / 2;
          const targetYCenter = targetY + NODE_HEIGHT / 2;
          
          // Choose connection side based on which is closer/better aligned
          const useRightSide = targetCenterX > sourceCenterX;
          
          return {
            ...link,
            sourceX: useRightSide ? sourceX + NODE_WIDTH : sourceX,
            sourceY: sourceYCenter,
            targetX: useRightSide ? targetX : targetX + NODE_WIDTH,
            targetY: targetYCenter,
            sourceSide: useRightSide ? 'right' : 'left',
            targetSide: useRightSide ? 'left' : 'right'
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [graph.links, positionedNodesMap, focusMode]);

  // Helper function to get all children (including grandchildren) of a node
  const getAllChildren = useCallback((nodeId) => {
    const allChildren = [];
    const nodes = positionedNodesRef.current;
    
    // Direct children
    let children = nodes.filter(n => 
      n.masterGroupId === nodeId || 
      n.groupId === nodeId || 
      n.opacityGroupId === nodeId
    );
    
    allChildren.push(...children);
    
    // Grandchildren (children of child groups)
    children.forEach(child => {
      if (child.isGroup) {
        const grandchildren = nodes.filter(n => 
          n.groupId === child.id || 
          n.opacityGroupId === child.id
        );
        allChildren.push(...grandchildren);
      }
    });
    
    return allChildren;
  }, []);


  const distributeHorizontal = useCallback(() => {
    if (selectedTokens.length < 3) return;
    const positions = selectedTokens.map(id => {
      const node = positionedNodesRef.current.find(n => n.id === id);
      if (!node) return null;
      const key = node.isMasterGroup ? `master-${id}` :
                 node.isGroup ? (node.id.startsWith('category:') ? `category-${id}` : `group-${id}`) :
                 `${node.column}-${id}`;
      const pos = nodePositionsRef.current.get(key) || { x: node.x, y: node.y };
      return { id, key, x: pos.x };
    }).filter(Boolean).sort((a, b) => a.x - b.x);
    
    if (positions.length < 3) return;
    const minX = positions[0].x;
    const maxX = positions[positions.length - 1].x;
    const spacing = (maxX - minX) / (positions.length - 1);
    
    positions.forEach(({ id, key }, index) => {
      const current = nodePositionsRef.current.get(key);
      if (current) {
        nodePositionsRef.current.set(key, { ...current, x: snapToGrid(minX + spacing * index) });
      }
    });
    setNodePositionsVersion(prev => prev + 1);
  }, [selectedTokens]);

  const distributeVertical = useCallback(() => {
    if (selectedTokens.length < 3) return;
    const positions = selectedTokens.map(id => {
      const node = positionedNodesRef.current.find(n => n.id === id);
      if (!node) return null;
      const key = node.isMasterGroup ? `master-${id}` :
                 node.isGroup ? (node.id.startsWith('category:') ? `category-${id}` : `group-${id}`) :
                 `${node.column}-${id}`;
      const pos = nodePositionsRef.current.get(key) || { x: node.x, y: node.y };
      return { id, key, y: pos.y };
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    
    if (positions.length < 3) return;
    const minY = positions[0].y;
    const maxY = positions[positions.length - 1].y;
    const spacing = (maxY - minY) / (positions.length - 1);
    
    positions.forEach(({ id, key }, index) => {
      const current = nodePositionsRef.current.get(key);
      if (current) {
        nodePositionsRef.current.set(key, { ...current, y: snapToGrid(minY + spacing * index) });
      }
    });
    setNodePositionsVersion(prev => prev + 1);
  }, [selectedTokens]);

  // Expose methods and positioned nodes via ref
  useImperativeHandle(ref, () => ({
    isInFocusMode: () => !!focusMode,
    getPositionedNodes: () => positionedNodesRef.current
  }), [focusMode]);

  // Determine container class based on state
  const containerClass = [
    'token-graph-container',
    isDragging ? 'is-dragging' : '',
    isPanningRef.current ? 'is-panning' : '',
    focusMode ? 'has-focus-mode' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={containerClass}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Focus mode overlay */}
      {focusMode && <div className="focus-mode-overlay" />}
      <div
        className="graph-content"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }}
      >
        {/* Render connections (excluding group relationships) - hide during drag for performance */}
        {!isDraggingNodeRef.current && (
          <svg className="connections-layer" width="50000" height="50000" viewBox="0 0 50000 50000">
            {(() => {
              // Separate connections into highlighted (connected to selected) and non-highlighted
              const highlightedConnections = [];
              const normalConnections = [];
              
              connections.forEach((conn, idx) => {
                // In focus mode, show all chain connections (they're all highlighted)
                // Outside focus mode, highlight connections to selected tokens
                const isChainConnection = focusMode && conn.isChain === true;
                const isConnectedToSelected = !focusMode && selectedTokens.length > 0 && 
                  (selectedTokens.includes(conn.source) || selectedTokens.includes(conn.target));
                
                if (isChainConnection || isConnectedToSelected) {
                  highlightedConnections.push({ conn, idx, isChainConnection });
                } else {
                  // In focus mode, don't show non-chain connections
                  if (!focusMode) {
                    normalConnections.push({ conn, idx, isChainConnection });
                  }
                }
              });
              
              // Render normal connections first (faded when token is selected), then highlighted ones on top
              const hasSelection = selectedTokens.length > 0;
              return (
                <>
                  {normalConnections.map(({ conn, idx, isChainConnection }) => {
                    // Fade to 15% only when a token is selected, otherwise normal opacity
                    const opacity = focusMode && !isChainConnection ? 0.1 : (hasSelection ? 0.15 : 0.4);
                    return (
                      <TokenConnection
                        key={`normal-${conn.source}-${conn.target}-${idx}`}
                        connection={conn}
                        isHighlighted={false}
                        style={{ opacity }}
                      />
                    );
                  })}
                  {highlightedConnections.map(({ conn, idx, isChainConnection }) => {
                    const opacity = focusMode && !isChainConnection ? 0.1 : (isChainConnection ? 1 : 1);
                    return (
                      <TokenConnection
                        key={`highlighted-${conn.source}-${conn.target}-${idx}`}
                        connection={conn}
                        isHighlighted={true}
                        strokeColor="var(--purple-3)"
                        style={{ opacity }}
                      />
                    );
                  })}
                </>
              );
            })()}
        </svg>
        )}

        {/* Render drag placeholder */}
        {placeholderPosition && (
          <div
            className="drag-placeholder"
            style={{
              left: `${placeholderPosition.x}px`,
              top: `${placeholderPosition.y}px`,
              width: `${placeholderPosition.width}px`,
              height: `${placeholderPosition.height}px`
            }}
          />
        )}
        
        {/* Render insertion divider for child groups */}
        {insertionDivider && (
          <div
            className="insertion-divider"
            style={{
              left: `${insertionDivider.x}px`,
              top: `${insertionDivider.y}px`,
              width: `${insertionDivider.width}px`
            }}
          />
        )}

        {/* Render sidebar indicators for parent-child relationships - hide in focus mode and during drag */}
        {!focusMode && !isDraggingNodeRef.current && positionedNodes && positionedNodes.length > 0 && positionedNodes.map(node => {
          if (node.isMasterGroup || node.isGroup) {
            // Find all direct children of this parent
            let children = [];
            if (node.isMasterGroup) {
              // Master group's direct children are category/palette groups (including opacity group)
              children = positionedNodes.filter(n => 
                n.masterGroupId === node.id && 
                n.isGroup && 
                !n.isMasterGroup &&
                !n.opacityGroupId // Exclude opacity palette groups (they're children of opacity group)
              );
            } else if (node.id === 'group:opacity') {
              // Opacity group's direct children are opacity palette groups (e.g., "black", "blue")
              children = positionedNodes.filter(n => 
                n.opacityGroupId === node.id && 
                n.isGroup && 
                !n.isMasterGroup
              );
            } else if (node.isGroup && node.opacityGroupId) {
              // Opacity palette group's direct children are opacity tokens
              children = positionedNodes.filter(n => 
                n.groupId === node.id && 
                !n.isGroup && 
                !n.isMasterGroup
              );
            } else if (node.isGroup) {
              // Regular category/palette group's direct children are tokens
              children = positionedNodes.filter(n => 
                n.groupId === node.id && 
                !n.isGroup && 
                !n.isMasterGroup
              );
            }
            
            if (children.length > 0) {
              const firstChild = children[0];
              const lastChild = children[children.length - 1];
              const sidebarX = node.x + 4; // Moved 8px to the right (from -4 to +4)
              const sidebarTop = node.y + NODE_HEIGHT;
              const sidebarHeight = lastChild.y + NODE_HEIGHT - sidebarTop;
              
              return (
                <div
                  key={`sidebar-${node.id}`}
                  className="parent-sidebar"
                  style={{
                    left: `${sidebarX}px`,
                    top: `${sidebarTop}px`,
                    height: `${sidebarHeight}px`,
                    width: '2px'
                  }}
                />
              );
            }
          }
          return null;
        })}

        {/* Render nodes */}
        {positionedNodes && positionedNodes.length > 0 && positionedNodes.map((node, index) => {
          // In focus mode, use linear positions for chain nodes, fade others
          const isInChain = focusMode && focusMode.chain.includes(node.id);
          const linearPos = focusMode?.linearPositions?.find(p => p.id === node.id);
          const displayX = focusMode && linearPos ? linearPos.focusX : node.x;
          const displayY = focusMode && linearPos ? linearPos.focusY : node.y;
          
          // Check if this node is being dragged
          const key = node.isMasterGroup ? `master-${node.id}` :
                     node.isGroup ? (node.id.startsWith('category:') ? `category-${node.id}` : `group-${node.id}`) :
                     `${node.column}-${node.id}`;
          const isBeingDragged = isDraggingNodeRef.current && dragOriginalPositionsRef.current.has(key);
          
          // In focus mode, fade non-chain nodes. During drag, hide dragged nodes (container shows instead)
          // Chain nodes should be on top (higher z-index) and fully visible
          // Selected token should be on top of everything
          const isSelectedToken = focusMode && focusMode.selectedTokenId === node.id;
          
          // Calculate opacity based on focus mode, drag state, and interactive highlighting
          let opacity = 1;
          if (isBeingDragged) {
            opacity = 0;
          } else if (focusMode && !isInChain) {
            opacity = 0.15;
          } else if (interactiveHighlighting && selectedTokens.length > 0 && !focusMode) {
            // If interactive highlighting is enabled and tokens are selected, fade nodes that aren't selected or connected
            const isSelected = selectedTokens.includes(node.id);
            const isConnected = connectedToSelectedNodes.has(node.id);
            if (!isSelected && !isConnected) {
              opacity = 0.15;
            }
          }
          
          const zIndex = isSelectedToken ? 300 : (focusMode && isInChain ? 200 : (isBeingDragged ? 1000 : 1));
          
          // Find which sides this node has connections on
          const nodeConnections = connections.filter(conn => 
            conn.source === node.id || conn.target === node.id
          );
          const hasLeftConnection = nodeConnections.some(conn => 
            (conn.source === node.id && conn.sourceSide === 'left') ||
            (conn.target === node.id && conn.targetSide === 'left')
          );
          const hasRightConnection = nodeConnections.some(conn => 
            (conn.source === node.id && conn.sourceSide === 'right') ||
            (conn.target === node.id && conn.targetSide === 'right')
          );
          
          // Find parent node for sidebar indicator
          // For opacity tokens: opacityGroupId -> opacity palette group -> opacity group -> master group
          // For regular tokens: groupId -> category/palette group -> master group
          const parentNode = node.groupId 
            ? positionedNodes.find(n => n.id === node.groupId)
            : node.opacityGroupId && node.opacityGroupId !== 'group:opacity'
            ? positionedNodes.find(n => n.id === node.opacityGroupId)
            : node.masterGroupId 
            ? positionedNodes.find(n => n.id === node.masterGroupId)
            : null;
          
          // Store ref for direct DOM manipulation
          const nodeRef = (el) => {
            if (el) {
              draggedNodeRefs.current.set(node.id, el);
            } else {
              draggedNodeRefs.current.delete(node.id);
            }
          };
          
                    return (
            <TokenNode
              key={`node-${node.id}-${node.column || 'none'}-${index}`}
              ref={nodeRef}
              node={{
                ...node,
                x: displayX,
                y: displayY
              }}
              allNodes={allNodes}
              parentNode={parentNode}
              isSelected={isSelectedToken || (!focusMode && selectedTokens.includes(node.id))}
              isHovered={hoverNodeId === node.id}
              onSelect={() => {
                // Only select if we didn't drag
                if (!hasDraggedRef.current) {
                  // In focus mode, only allow selecting tokens in the chain
                  if (focusMode) {
                    const isInChain = focusMode.chain.includes(node.id);
                    if (isInChain && !node.isMasterGroup && !node.isGroup) {
                      // Switch focus to the selected token in the chain
                      enterFocusMode(node.id);
                    }
                    // Don't call onTokenSelect for non-chain tokens in focus mode
                  } else {
                    // Normal selection when not in focus mode
                    onTokenSelect(node.id);
                  }
                }
                // Reset the flag
                hasDraggedRef.current = false;
              }}
              onDoubleClick={() => {
                // Double click: groups collapse/expand, tokens enter focus mode
                if (!hasDraggedRef.current) {
                  if (node.isMasterGroup || node.isGroup) {
                    // Toggle collapse state for groups
                    setCollapsedGroups(prev => {
                      const newSet = new Set(prev);
                      if (newSet.has(node.id)) {
                        newSet.delete(node.id);
                      } else {
                        newSet.add(node.id);
                      }
                      return newSet;
                    });
                  } else {
                    // Enter focus mode for tokens
                    enterFocusMode(node.id);
                  }
                }
              }}
              onHover={() => onHoverNodeChange(node.id)}
              onLeave={() => onHoverNodeChange('')}
              selectedMode={selectedMode}
              style={{ opacity, zIndex }}
              isDraggable={node.isMasterGroup || node.isGroup}
              hasLeftConnection={hasLeftConnection}
              hasRightConnection={hasRightConnection}
            />
                    );
                  })}
              </div>
    </div>
  );
});

export default TokenGraph;
