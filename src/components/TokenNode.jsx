import React, { forwardRef } from 'react';
import './TokenNode.css';

const NODE_WIDTH = 450;
const NODE_HEIGHT = 36; // 20px base + 8px top + 8px bottom padding

const TokenNode = forwardRef(function TokenNode({ node, allNodes, parentNode, isSelected, isHovered, onSelect, onHover, onLeave, selectedMode, style, onDoubleClick, isDraggable = false, hasLeftConnection = false, hasRightConnection = false, graphLinks = [] }, ref) {
  // Resolve token reference recursively to get the final color value and opacity
  const resolveTokenColor = (tokenId, visited = new Set()) => {
    // Prevent infinite loops
    if (visited.has(tokenId)) {
      return null;
    }
    visited.add(tokenId);

    const token = allNodes.find(n => n.id === tokenId);
    if (!token) {
      return null;
    }

    // If it's a primitive with a color, return it
    if (token.color) {
      return token.color;
    }
    
    // Also check token.value if it's a direct color
    if (token.value && typeof token.value === 'string' && (token.value.startsWith('#') || token.value.startsWith('rgba(') || token.value.startsWith('rgb('))) {
      return token.value;
    }

    // If it has modes, check the selected mode
    if (token.modes && selectedMode && token.modes[selectedMode]) {
      const value = token.modes[selectedMode];
      
      // If it's a color (hex, rgba, or rgb), return it
      if (typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgba(') || value.startsWith('rgb('))) {
        return value;
      }
      
      // If it's a reference to another token, resolve it
      if (typeof value === 'string') {
        return resolveTokenColor(value, visited);
      }
    }

    return null;
  };

  // Helper to convert rgba/rgb to hex
  const rgbaToHex = (rgbaStr) => {
    if (!rgbaStr || typeof rgbaStr !== 'string') return null;
    
    // Match rgba(r, g, b, a) or rgb(r, g, b)
    const rgbaMatch = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!rgbaMatch) return null;
    
    const r = parseInt(rgbaMatch[1], 10);
    const g = parseInt(rgbaMatch[2], 10);
    const b = parseInt(rgbaMatch[3], 10);
    const a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
    
    // Convert to hex
    const toHex = (n) => {
      const hex = Math.round(n).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return {
      hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
      opacity: a < 1 ? Math.round(a * 100) : null
    };
  };
  
  // Helper to extract opacity from token name (e.g., "opacity.neutral.72" -> 72)
  const extractOpacityFromName = (tokenName) => {
    if (!tokenName || typeof tokenName !== 'string') return null;
    
    // Check if it's an opacity token: opacity.color.value (e.g., "opacity.neutral.72")
    // Pattern: opacity.{color}.{number}
    const opacityMatch = tokenName.match(/^opacity\.(?:black|white|neutral|red|blue|green|yellow|purple|pink|orange|teal)\.(\d+)$/i);
    if (opacityMatch) {
      const opacityValue = parseInt(opacityMatch[1], 10);
      if (!isNaN(opacityValue) && opacityValue >= 0 && opacityValue <= 100) {
        return opacityValue;
      }
    }
    return null;
  };

  // Resolve token reference and return both color and opacity
  const resolveTokenWithOpacity = (tokenId, visited = new Set()) => {
    // Prevent infinite loops
    if (visited.has(tokenId)) {
      return { color: null, opacity: null };
    }
    visited.add(tokenId);

    const token = allNodes.find(n => n.id === tokenId);
    if (!token) {
      return { color: null, opacity: null };
    }

    // Check if token name indicates it's an opacity token (e.g., "opacity.neutral.72")
    const opacityFromName = extractOpacityFromName(token.id) || extractOpacityFromName(token.name);
    
    // If this token has opacity property, use it
    let opacity = null;
    if (token.opacity !== undefined && token.opacity !== null) {
      opacity = token.opacity;
    } else if (opacityFromName !== null) {
      // Extract opacity from token name if it's an opacity token
      opacity = opacityFromName;
    }

    // If we have opacity, we need to resolve the base color
    if (opacity !== null) {
      // For opacity tokens, the color should be resolved from the base color
      // e.g., opacity.neutral.72 should resolve to the neutral color
      const color = token.color || resolveTokenColor(tokenId);
      return { color, opacity };
    }

    // If it's a primitive with a color, return it
    if (token.color) {
      return { color: token.color, opacity: null };
    }

    // If it has modes, check the selected mode
    if (token.modes && selectedMode && token.modes[selectedMode]) {
      const value = token.modes[selectedMode];
      
      // If it's a hex color, return it
      if (typeof value === 'string' && value.startsWith('#')) {
        return { color: value, opacity: null };
      }
      
      // If it's a reference to another token, resolve it recursively
      if (typeof value === 'string') {
        return resolveTokenWithOpacity(value, visited);
      }
    }

    return { color: null, opacity: null };
  };

  const getResolvedColor = () => {
    if (node.isLayerGroup) {
      return 'var(--neutral-6)';
    }
    if (node.isGroup) {
      return 'var(--neutral-7)';
    }
    
    // For regular tokens, use neutral background and show color as swatch
    return 'var(--neutral-8)';
  };

  // Get the color value for the swatch (separate from background)
  const getColorSwatch = () => {
    if (node.isLayerGroup || node.isGroup) {
      return null;
    }
    
    // Resolve color and opacity (checking referenced tokens for opacity)
    const { color: resolvedColor, opacity: resolvedOpacity } = resolveTokenWithOpacity(node.id);
    
    // Use node's own opacity if it exists, otherwise use resolved opacity
    const opacity = node.opacity !== undefined && node.opacity !== null 
      ? node.opacity 
      : resolvedOpacity;
    
    // Apply opacity to the swatch color if we have it
    if (opacity !== null && opacity !== undefined) {
      const baseColor = resolvedColor || node.color || '#000000';
      // Convert opacity percentage to hex alpha (0-255)
      const alphaHex = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0');
      // Return color with alpha channel
      if (baseColor && baseColor.length === 7) { // #RRGGBB format
        return baseColor + alphaHex;
      }
      return baseColor;
    }
    
    // Return resolved color if it's a valid color format (hex, rgba, or rgb)
    if (resolvedColor && (resolvedColor.startsWith('#') || resolvedColor.startsWith('rgba(') || resolvedColor.startsWith('rgb('))) {
      return resolvedColor;
    }
    
    // Also check node.color directly if resolvedColor didn't work
    if (node.color && (node.color.startsWith('#') || node.color.startsWith('rgba(') || node.color.startsWith('rgb('))) {
      return node.color;
    }
    
    return null;
  };


  const getNodeValue = () => {
    if (node.isLayerGroup || node.isGroup) {
      return `${node.childCount} tokens`;
    }
    
    // Check if this is an opacity token (by name pattern)
    const opacityFromName = extractOpacityFromName(node.id) || extractOpacityFromName(node.name);
    
    // For primitive tokens, show the resolved color with opacity if applicable
    if (node.layer === 'primitive') {
      // Resolve color and opacity (checking referenced tokens for opacity)
      const { color: resolvedColor, opacity: resolvedOpacity } = resolveTokenWithOpacity(node.id);
      
      // Get the color to display (prefer resolved, then node.color, then node.value)
      let colorToDisplay = resolvedColor || node.color || node.value;
      
      // Convert rgba/rgb to hex if needed
      let hexColor = null;
      let opacity = null;
      
      if (colorToDisplay && typeof colorToDisplay === 'string') {
        if (colorToDisplay.startsWith('rgba(') || colorToDisplay.startsWith('rgb(')) {
          const converted = rgbaToHex(colorToDisplay);
          if (converted) {
            hexColor = converted.hex;
            opacity = converted.opacity;
          }
        } else if (colorToDisplay.startsWith('#')) {
          hexColor = colorToDisplay;
        }
      }
      
      // Use node's own opacity if it exists, otherwise use resolved opacity, or extracted from rgba, or from name
      const finalOpacity = node.opacity !== undefined && node.opacity !== null 
        ? node.opacity 
        : (resolvedOpacity !== null && resolvedOpacity !== undefined 
          ? resolvedOpacity 
          : (opacity !== null ? opacity : opacityFromName));
      
      // If we have a hex color and opacity, format as "#HEX @ opacity%"
      if (hexColor && finalOpacity !== null && finalOpacity !== undefined) {
        return `${hexColor} @ ${finalOpacity}%`;
      }
      
      // If we have a hex color, just return it
      if (hexColor) {
        return hexColor;
      }
      
      // Fallback to original color if conversion failed
      if (colorToDisplay) {
        return colorToDisplay;
      }
    } else {
      // For non-primitive tokens (semantic, component, global, shared), show the referenced token name
      // The actual connection will be shown as a line, not text
      if (node.modes && selectedMode && node.modes[selectedMode]) {
        const reference = node.modes[selectedMode];
        // Only show if it's a token reference (not a hex color or rgba)
        if (typeof reference === 'string' && !reference.startsWith('#') && !reference.startsWith('rgba(') && !reference.startsWith('rgb(')) {
          return reference;
        }
      }
      // Fallback: check node.value if it's a reference
      if (node.value && typeof node.value === 'string' && !node.value.startsWith('#') && !node.value.startsWith('rgba(') && !node.value.startsWith('rgb(')) {
        return node.value;
      }
    }
    
    // Fallback: try to resolve color for display
    const resolvedColor = resolveTokenColor(node.id);
    if (resolvedColor) {
      // Convert rgba to hex if needed
      if (resolvedColor.startsWith('rgba(') || resolvedColor.startsWith('rgb(')) {
        const converted = rgbaToHex(resolvedColor);
        if (converted) {
          if (converted.opacity !== null) {
            return `${converted.hex} @ ${converted.opacity}%`;
          }
          return converted.hex;
        }
      }
      return resolvedColor;
    }
    
    // Final fallback
    if (node.modes && selectedMode && node.modes[selectedMode]) {
      const modeValue = node.modes[selectedMode];
      // Convert rgba to hex if needed
      if (typeof modeValue === 'string' && (modeValue.startsWith('rgba(') || modeValue.startsWith('rgb('))) {
        const converted = rgbaToHex(modeValue);
        if (converted) {
          if (converted.opacity !== null) {
            return `${converted.hex} @ ${converted.opacity}%`;
          }
          return converted.hex;
        }
      }
      return modeValue;
    }
    
    return '';
  };

  // Helper function to calculate relative luminance of a color
  const getLuminance = (hex) => {
    if (!hex || !hex.startsWith('#')) return 0.5; // Default to medium
    
    // Remove # and convert to RGB
    const rgb = hex.slice(1).match(/.{2}/g)?.map(x => parseInt(x, 16)) || [128, 128, 128];
    const [r, g, b] = rgb.map(val => {
      val = val / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // Determine if background is light or dark and get appropriate text color
  const getTextColor = () => {
    // For layer groups and groups, use light text on dark backgrounds
    if (node.isLayerGroup || node.isGroup) {
      return resolveTokenColor('text.overlay.light') || '#ffffff';
    }
    
    // For regular tokens with neutral backgrounds, always use light text
    return resolveTokenColor('text.overlay.light') || '#ffffff';
  };

  // Helper function to check if a value should use monospace (hex code or token name)
  const isMonospaceValue = (value) => {
    if (!value) return false;
    // Check if it's a hex color (#RGB, #RRGGBB, or #RRGGBBAA)
    if (typeof value === 'string' && /^#[0-9A-Fa-f]{3,8}$/.test(value)) {
      return true;
    }
    // Check if it's a token name (contains dots, like "radio.background.selected")
    if (typeof value === 'string' && value.includes('.')) {
      return true;
    }
    return false;
  };

  const resolvedColor = getResolvedColor();
  const displayValue = getNodeValue();
  const textColor = getTextColor();
  const valueIsMonospace = isMonospaceValue(displayValue);
  const colorSwatch = getColorSwatch();
  
  // Determine if this is a non-primitive token (for styling the value differently)
  const isNonPrimitive = !node.isLayerGroup && !node.isGroup && node.layer !== 'primitive';
  
  // Determine if this node has a parent (for sidebar indicator)
  const hasParent = !!parentNode;

  return (
    <div
      ref={ref}
      className={`token-node ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''} ${node.isLayerGroup ? 'layer-group' : ''} ${node.isGroup ? 'group-node' : ''} ${hasParent ? 'has-parent' : ''} column-${node.column} ${isDraggable ? 'draggable' : 'not-draggable'}`}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${NODE_WIDTH}px`,
        height: `${NODE_HEIGHT}px`,
        backgroundColor: resolvedColor,
        color: textColor,
        ...style
      }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      data-node-id={node.id}
      data-parent-id={parentNode?.id}
    >
      {/* Connection dots on left and right sides */}
      {hasLeftConnection && (
        <div className="connection-dot connection-dot-left" />
      )}
      {hasRightConnection && (
        <div className="connection-dot connection-dot-right" />
      )}
      
      <div className="token-node-content">
        {colorSwatch && (
          <div className="token-color-swatch-wrapper">
            <div 
              className="token-color-swatch"
              style={{ backgroundColor: colorSwatch }}
            />
          </div>
        )}
        <span className="token-node-name">{node.name}</span>
        {displayValue && (
          <span 
            className={`token-node-value ${valueIsMonospace ? 'monospace' : ''} ${isNonPrimitive ? 'token-reference' : ''}`}
          >
            {displayValue}
          </span>
        )}
      </div>
    </div>
  );
});

export default TokenNode;

