import React, { useState } from 'react';
import './Toolbar.css';
import ImportModal from './ImportModal';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ZoomOutIcon,
  ZoomInIcon,
  Cross2Icon,
  ChevronDownIcon,
  CheckIcon,
  HamburgerMenuIcon,
  UploadIcon,
  ChevronRightIcon,
  ChevronLeftIcon
} from '@radix-ui/react-icons';

function Toolbar({ 
  zoom, 
  onZoom, 
  onResetView,
  onZoomToFit,
  onZoomToPercent,
  selectedTokens,
  onTokenRemove,
  onClearSelection,
  onImportJSON,
  onImportTSX,
  currentFileName,
  onReturnToTeardrop,
  showMinimap,
  onMinimapChange,
  interactiveHighlighting,
  onInteractiveHighlightingChange,
  sidebarCollapsed,
  onSidebarToggle
}) {
  const [showImportModal, setShowImportModal] = useState(false);
  const zoomPercent = Math.round(zoom * 100);

  const handleImportClick = () => {
    setShowImportModal(true);
  };

  const handleZoomIn = () => {
    // Get container center for zoom (coordinates relative to container)
    const container = document.querySelector('.token-graph-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      onZoom(0.1, centerX, centerY);
    } else {
      onZoom(0.1, 0, 0);
    }
  };

  const handleZoomOut = () => {
    // Get container center for zoom (coordinates relative to container)
    const container = document.querySelector('.token-graph-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      onZoom(-0.1, centerX, centerY);
    } else {
      onZoom(-0.1, 0, 0);
    }
  };
  
  return (
    <>
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportJSON={onImportJSON}
        onImportTSX={onImportTSX}
      />
      
      <div className={`toolbar ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${selectedTokens.length > 0 ? 'has-tokens' : ''}`}>
        {/* Left side: Controls */}
      <div className="toolbar-left">
        {/* Sidebar toggle button */}
        <div className="toolbar-group">
          <button
            className="toolbar-btn"
            onClick={onSidebarToggle}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            {sidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        </div>
        
        {/* Zoom Controls - Split button with zoom in/out */}
        <div className="toolbar-group toolbar-zoom-group">
          <button
            className="toolbar-btn toolbar-zoom-btn"
            onClick={handleZoomOut}
            title="Zoom out (Shift+Z)"
            aria-label="Zoom out"
          >
            <ZoomOutIcon />
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button 
                className="toolbar-btn toolbar-btn-text toolbar-zoom-dropdown"
                title="Zoom options"
                aria-label="Zoom options"
              >
                {zoomPercent}%
                <ChevronDownIcon style={{ width: '12px', height: '12px', marginLeft: '4px' }} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="toolbar-dropdown-content" sideOffset={5}>
                <DropdownMenu.Item 
                  className="toolbar-dropdown-item"
                  onSelect={() => onZoomToFit && onZoomToFit()}
                >
                  Zoom to fit
                </DropdownMenu.Item>
                <DropdownMenu.Item 
                  className="toolbar-dropdown-item"
                  onSelect={() => onZoomToPercent && onZoomToPercent(50)}
                >
                  Zoom to 50%
                </DropdownMenu.Item>
                <DropdownMenu.Item 
                  className="toolbar-dropdown-item"
                  onSelect={() => onZoomToPercent && onZoomToPercent(100)}
                >
                  Zoom to 100%
                </DropdownMenu.Item>
                <DropdownMenu.Item 
                  className="toolbar-dropdown-item"
                  onSelect={() => onZoomToPercent && onZoomToPercent(200)}
                >
                  Zoom to 200%
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            className="toolbar-btn toolbar-zoom-btn"
            onClick={handleZoomIn}
            title="Zoom in (Z)"
            aria-label="Zoom in"
          >
            <ZoomInIcon />
          </button>
        </div>


        {/* Hamburger menu with Interactive Highlighting, Show Mini Map, and Upload Tokens */}
        <div className="toolbar-group">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="toolbar-btn"
                title="More options"
                aria-label="More options"
              >
                <HamburgerMenuIcon />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="toolbar-dropdown-content" sideOffset={5}>
                <DropdownMenu.CheckboxItem
                  className="toolbar-dropdown-item toolbar-dropdown-checkbox"
                  checked={interactiveHighlighting}
                  onCheckedChange={onInteractiveHighlightingChange}
                  onSelect={(e) => e.preventDefault()}
                >
                  <DropdownMenu.ItemIndicator className="toolbar-dropdown-indicator">
                    <CheckIcon />
                  </DropdownMenu.ItemIndicator>
                  Interactive highlighting
                </DropdownMenu.CheckboxItem>
                <DropdownMenu.CheckboxItem
                  className="toolbar-dropdown-item toolbar-dropdown-checkbox"
                  checked={showMinimap}
                  onCheckedChange={onMinimapChange}
                  onSelect={(e) => e.preventDefault()}
                >
                  <DropdownMenu.ItemIndicator className="toolbar-dropdown-indicator">
                    <CheckIcon />
                  </DropdownMenu.ItemIndicator>
                  Show minimap
                </DropdownMenu.CheckboxItem>
                <DropdownMenu.Separator className="toolbar-dropdown-separator" />
                <DropdownMenu.Item 
                  className="toolbar-dropdown-item"
                  onSelect={handleImportClick}
                >
                  <UploadIcon />
                  Upload tokens
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Right side: Current file indicator and selected tokens */}
      {(currentFileName || selectedTokens.length > 0) && (
        <div className="toolbar-right">
          {/* Current file indicator */}
          {currentFileName && (
            <>
              <div className="toolbar-file-info">
                <span className="toolbar-file-label">Viewing:</span>
                <span className="toolbar-file-name" title={currentFileName}>
                  {currentFileName}
                </span>
              </div>
              <button
                className="toolbar-btn toolbar-return-btn"
                onClick={onReturnToTeardrop}
                title="Return to Teardrop tokens"
              >
                ← Teardrop
              </button>
              <div className="toolbar-divider" />
            </>
          )}

          {/* Selected tokens as tags */}
          {selectedTokens.length > 0 && (
            <>
            <div className="toolbar-tags">
              {selectedTokens.map(tokenId => (
                <span key={tokenId} className="toolbar-tag">
                  <span className="toolbar-tag-text">{tokenId}</span>
                  <button
                    className="toolbar-tag-remove"
                    onClick={() => onTokenRemove(tokenId)}
                    aria-label={`Remove ${tokenId}`}
                  >
                    <Cross2Icon />
                  </button>
                </span>
              ))}
            </div>
            {selectedTokens.length > 1 && (
              <button 
                className="toolbar-clear"
                onClick={onClearSelection}
                title="Clear all selections"
              >
                Clear all
              </button>
            )}
            </>
          )}
        </div>
      )}
    </div>
    </>
  );
}

export default Toolbar;

