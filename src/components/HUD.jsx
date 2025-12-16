import React from 'react';
import './HUD.css';

function HUD({ selectedTokens, onTokenRemove, onClearSelection }) {
  return (
    <div className="hud">
      {selectedTokens.length > 0 ? (
        <>
          <div className="hud-label">Selected:</div>
          <div className="hud-tokens">
            {selectedTokens.map(tokenId => (
              <span key={tokenId} className="hud-token-pill">
                {tokenId}
                <button
                  className="hud-token-remove"
                  onClick={() => onTokenRemove(tokenId)}
                  aria-label={`Remove ${tokenId}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <button className="hud-clear" onClick={onClearSelection}>
            Clear all
          </button>
        </>
      ) : (
        <div className="hud-hints">
          <span className="hud-hint"><kbd>⌘</kbd> + drag to pan</span>
          <span className="hud-hint"><kbd>⌘</kbd> + scroll to zoom</span>
          <span className="hud-hint">Click tokens to select</span>
        </div>
      )}
    </div>
  );
}

export default HUD;

