import React from 'react';
import './Sidebar.css';

function Sidebar({
  searchQuery,
  onSearchChange,
  selectedMode,
  onModeChange,
  modes,
  selectedTokens,
  onTokenRemove,
  collapsed,
  isTeardropOnly
}) {
  // Get display name for mode
  const getModeDisplayName = (mode) => {
    // For Teardrop only: rename "hws" to "Hardwater Studios"
    if (isTeardropOnly && mode === 'hws') {
      return 'Hardwater Studios';
    }
    // Otherwise, just capitalize first letter
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  };
  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <section className="sidebar-top">
        <div className="branding">
          <div className="logo"></div>
            <h1>Token Visualizer</h1>
        </div>

        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Mode</label>
            <div className="radio-group">
              {modes.map(mode => (
                <label key={mode} className="radio-option">
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={selectedMode === mode}
                    onChange={(e) => onModeChange(e.target.value)}
                  />
                  <span>{getModeDisplayName(mode)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sidebar-middle">
        <div className="keyboard-shortcuts">
          <h3>Keyboard Shortcuts</h3>
          <ul>
            <li><span>Double-click token</span> <kbd>Focus mode</kbd></li>
            <li><span>Exit focus / Clear</span> <kbd>Esc</kbd></li>
            <li><span>Pan fast</span> <kbd>Shift</kbd> + <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></li>
            <li><span>Zoom in</span> <kbd>Z</kbd></li>
            <li><span>Zoom out</span> <kbd>Shift</kbd> + <kbd>Z</kbd></li>
            <li><span>Scroll</span> <kbd>Zoom</kbd></li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default Sidebar;

