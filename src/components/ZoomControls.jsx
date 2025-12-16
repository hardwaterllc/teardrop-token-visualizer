import React from 'react';
import './ZoomControls.css';

function ZoomControls({ zoom, onZoom, onResetView }) {
  const zoomPercent = Math.round(zoom * 100);
  
  return (
    <div className="zoom-controls">
      <button 
        className="zoom-btn" 
        onClick={() => onZoom(-0.1)}
        title="Zoom out (Shift+Z)"
        aria-label="Zoom out"
      >
        −
      </button>
      
      <button 
        className="zoom-level"
        onClick={onResetView}
        title="Reset view"
        aria-label="Reset zoom to 100%"
      >
        {zoomPercent}%
      </button>
      
      <button 
        className="zoom-btn" 
        onClick={() => onZoom(0.1)}
        title="Zoom in (Z)"
        aria-label="Zoom in"
      >
        +
      </button>
      
      <div className="zoom-divider" />
      
      <button 
        className="zoom-btn zoom-fit"
        onClick={onResetView}
        title="Fit to view"
        aria-label="Fit to view"
      >
        ⌗
      </button>
    </div>
  );
}

export default ZoomControls;

