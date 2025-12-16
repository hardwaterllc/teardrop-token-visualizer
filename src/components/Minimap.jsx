import React, { useMemo, useState, useEffect } from 'react';
import './Minimap.css';

const CANVAS_WIDTH = 50000;
const CANVAS_HEIGHT = 50000;
const SIDEBAR_WIDTH_DEFAULT = 280;
const NODE_WIDTH = 450;
const NODE_HEIGHT = 36;

function Minimap({ 
  panX, 
  panY, 
  zoom, 
  positionedNodes,
  onPanTo,
  sidebarCollapsed
}) {
  const [nodes, setNodes] = useState(positionedNodes || []);
  const SIDEBAR_WIDTH = sidebarCollapsed ? 0 : SIDEBAR_WIDTH_DEFAULT;

  // Update nodes when positionedNodes changes
  useEffect(() => {
    if (positionedNodes) {
      setNodes(positionedNodes);
    }
  }, [positionedNodes]);

  // Calculate bounds of all nodes (including master groups)
  const bounds = useMemo(() => {
    if (!nodes || nodes.length === 0) {
      return { minX: 0, maxX: CANVAS_WIDTH, minY: 0, maxY: CANVAS_HEIGHT };
    }

    // Include all nodes (tokens, groups, and master groups) for bounds calculation
    const allPositionedNodes = nodes.filter(n => n.x !== undefined && n.y !== undefined);
    if (allPositionedNodes.length === 0) {
      return { minX: 0, maxX: CANVAS_WIDTH, minY: 0, maxY: CANVAS_HEIGHT };
    }

    const minX = Math.min(...allPositionedNodes.map(n => n.x));
    const maxX = Math.max(...allPositionedNodes.map(n => n.x + (n.isMasterGroup || n.isGroup ? NODE_WIDTH : NODE_WIDTH)));
    const minY = Math.min(...allPositionedNodes.map(n => n.y));
    const maxY = Math.max(...allPositionedNodes.map(n => n.y + (n.isMasterGroup || n.isGroup ? 40 : NODE_HEIGHT)));

    // Add padding
    const padding = 100;
    return { 
      minX: minX - padding, 
      maxX: maxX + padding, 
      minY: minY - padding, 
      maxY: maxY + padding 
    };
  }, [nodes]);

  // Calculate viewport bounds in graph coordinates
  const viewportBounds = useMemo(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Convert screen coordinates to graph coordinates
    // screenX = graphX * zoom + panX
    // graphX = (screenX - panX) / zoom
    const viewportLeft = (SIDEBAR_WIDTH - panX) / zoom;
    const viewportRight = (viewportWidth - panX) / zoom;
    const viewportTop = (0 - panY) / zoom;
    const viewportBottom = (viewportHeight - panY) / zoom;

    return {
      left: viewportLeft,
      right: viewportRight,
      top: viewportTop,
      bottom: viewportBottom
    };
  }, [panX, panY, zoom]);

  // Calculate minimap scale
  const minimapScale = useMemo(() => {
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const minimapWidth = 200;
    const minimapHeight = 150;
    
    const scaleX = minimapWidth / Math.max(contentWidth, 1000);
    const scaleY = minimapHeight / Math.max(contentHeight, 1000);
    
    return Math.min(scaleX, scaleY, 1); // Don't scale up
  }, [bounds]);

  // Calculate minimap dimensions
  const minimapWidth = 200;
  const minimapHeight = 150;
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const scaledWidth = contentWidth * minimapScale;
  const scaledHeight = contentHeight * minimapScale;
  
  // Center the content in the minimap
  const contentLeft = (minimapWidth - scaledWidth) / 2;
  const contentTop = (minimapHeight - scaledHeight) / 2;

  // Calculate viewport rectangle in minimap coordinates
  const viewportRect = useMemo(() => {
    const viewportWidth = (viewportBounds.right - viewportBounds.left) * minimapScale;
    const viewportHeight = (viewportBounds.bottom - viewportBounds.top) * minimapScale;
    const viewportX = contentLeft + (viewportBounds.left - bounds.minX) * minimapScale;
    const viewportY = contentTop + (viewportBounds.top - bounds.minY) * minimapScale;

    return {
      x: Math.max(0, Math.min(viewportX, minimapWidth)),
      y: Math.max(0, Math.min(viewportY, minimapHeight)),
      width: Math.max(10, Math.min(viewportWidth, minimapWidth)),
      height: Math.max(10, Math.min(viewportHeight, minimapHeight))
    };
  }, [viewportBounds, minimapScale, bounds, minimapWidth, minimapHeight, contentLeft, contentTop]);

  const handleMinimapClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Convert minimap coordinates to graph coordinates
    // Account for centered content
    const relativeX = clickX - contentLeft;
    const relativeY = clickY - contentTop;
    const graphX = bounds.minX + (relativeX / minimapScale);
    const graphY = bounds.minY + (relativeY / minimapScale);
    
    // Calculate new pan to center viewport on clicked point
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = viewportWidth - SIDEBAR_WIDTH;
    const viewportCenterX = SIDEBAR_WIDTH + availableWidth / 2;
    const viewportCenterY = viewportHeight / 2;
    
    // Calculate pan: viewportCenter = graphX * zoom + panX
    const newPanX = viewportCenterX - graphX * zoom;
    const newPanY = viewportCenterY - graphY * zoom;
    
    if (onPanTo) {
      onPanTo(newPanX, newPanY);
    }
  };

  return (
    <div className="minimap-container">
      <div 
        className="minimap"
        onClick={handleMinimapClick}
        style={{
          width: `${minimapWidth}px`,
          height: `${minimapHeight}px`
        }}
      >
        {/* Content bounds background */}
        <div 
          className="minimap-content"
          style={{
            left: `${contentLeft}px`,
            top: `${contentTop}px`,
            width: `${scaledWidth}px`,
            height: `${scaledHeight}px`
          }}
        />
        
        {/* Viewport indicator */}
        <div 
          className="minimap-viewport"
          style={{
            left: `${viewportRect.x}px`,
            top: `${viewportRect.y}px`,
            width: `${viewportRect.width}px`,
            height: `${viewportRect.height}px`
          }}
        />
        
        {/* Node dots */}
        {nodes && nodes
          .filter(n => !n.isMasterGroup && !n.isGroup)
          .map((node, index) => {
            const nodeX = contentLeft + (node.x - bounds.minX) * minimapScale;
            const nodeY = contentTop + (node.y - bounds.minY) * minimapScale;
            return (
              <div
                key={`minimap-${node.id}-${node.column || 'none'}-${index}`}
                className="minimap-node"
                style={{
                  left: `${nodeX}px`,
                  top: `${nodeY}px`
                }}
              />
            );
          })}
      </div>
    </div>
  );
}

export default Minimap;

