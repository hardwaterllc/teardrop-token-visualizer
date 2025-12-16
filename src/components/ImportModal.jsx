import React, { useRef, useState } from 'react';
import './ImportModal.css';
import { Cross2Icon } from '@radix-ui/react-icons';

function ImportModal({ isOpen, onClose, onImportJSON, onImportTSX, onImportCSS }) {
  const jsonInputRef = useRef(null);
  const cssInputRef = useRef(null);
  const primitivesInputRef = useRef(null);
  const semanticInputRef = useRef(null);
  const [primitivesFile, setPrimitivesFile] = useState(null);

  if (!isOpen) return null;

  const handleJSONClick = () => {
    jsonInputRef.current?.click();
  };

  const handleCSSClick = () => {
    cssInputRef.current?.click();
  };

  const handleTSXClick = () => {
    primitivesInputRef.current?.click();
  };

  const handleJSONChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onImportJSON) {
      onImportJSON(file);
      onClose();
    }
    if (jsonInputRef.current) {
      jsonInputRef.current.value = '';
    }
  };

  const handleCSSChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onImportCSS) {
      onImportCSS(file);
      onClose();
    }
    if (cssInputRef.current) {
      cssInputRef.current.value = '';
    }
  };

  const handlePrimitivesChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPrimitivesFile(file);
      // Now ask for semantic file
      setTimeout(() => {
        semanticInputRef.current?.click();
      }, 100);
    }
    if (primitivesInputRef.current) {
      primitivesInputRef.current.value = '';
    }
  };

  const handleSemanticChange = (e) => {
    const semanticFile = e.target.files?.[0];
    
    if (primitivesFile && semanticFile && onImportTSX) {
      onImportTSX(primitivesFile, semanticFile);
      setPrimitivesFile(null);
      onClose();
    }
    if (semanticInputRef.current) {
      semanticInputRef.current.value = '';
    }
  };

  return (
    <div className="import-modal-overlay" onClick={onClose}>
      <div className="import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-header">
          <h2>Import Token File</h2>
          <button className="import-modal-close" onClick={onClose} aria-label="Close">
            <Cross2Icon />
          </button>
        </div>
        
        <div className="import-modal-content">
          <div className="import-option">
            <button className="import-option-btn" onClick={handleJSONClick}>
              Upload JSON
            </button>
            <p className="import-option-desc">Import a single JSON file with token definitions</p>
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json"
              onChange={handleJSONChange}
              style={{ display: 'none' }}
            />
          </div>

          <div className="import-divider">
            <span>OR</span>
          </div>

          <div className="import-option">
            <button className="import-option-btn" onClick={handleCSSClick}>
              Upload CSS
            </button>
            <p className="import-option-desc">Import a CSS file with CSS custom properties (shows token relationships via var() references)</p>
            <input
              ref={cssInputRef}
              type="file"
              accept=".css"
              onChange={handleCSSChange}
              style={{ display: 'none' }}
            />
          </div>

          <div className="import-divider">
            <span>OR</span>
          </div>

          <div className="import-option">
            <button className="import-option-btn" onClick={handleTSXClick}>
              Upload TSX
            </button>
            <p className="import-option-desc">
              Import TSX files: <strong>First</strong> upload Primitives (raw colors), <strong>then</strong> Semantic (token definitions)
            </p>
            <input
              ref={primitivesInputRef}
              type="file"
              accept=".tsx,.ts"
              onChange={handlePrimitivesChange}
              style={{ display: 'none' }}
            />
            <input
              ref={semanticInputRef}
              type="file"
              accept=".tsx,.ts"
              onChange={handleSemanticChange}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImportModal;

