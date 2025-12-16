import React from 'react';

function TokenConnection({ connection, isHighlighted, style, strokeColor }) {
  // Validate all coordinates are valid numbers
  const isValidNumber = (n) => typeof n === 'number' && !isNaN(n) && isFinite(n);
  
  // If coordinates are invalid, don't render the path (silently skip)
  if (!isValidNumber(connection.sourceX) || !isValidNumber(connection.sourceY) || 
      !isValidNumber(connection.targetX) || !isValidNumber(connection.targetY)) {
    return null;
  }
  
  const sourceX = connection.sourceX;
  const sourceY = connection.sourceY;
  const targetX = connection.targetX;
  const targetY = connection.targetY;
  
  // For horizontal chain connections, use straight line; otherwise use curved or L-shaped path
  let path;
  if (connection.isHorizontal) {
    // Straight horizontal line for chain view
    path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  } else if (connection.midX !== undefined && isValidNumber(connection.midX)) {
    // L-shaped path for stacked consuming tokens (horizontal then vertical)
    path = `M ${sourceX} ${sourceY} L ${connection.midX} ${sourceY} L ${connection.midX} ${targetY} L ${targetX} ${targetY}`;
  } else {
    // Curved path for normal connections
    const midX = (sourceX + targetX) / 2;
    path = `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
  }

  const stroke = strokeColor || (isHighlighted ? 'var(--purple-3)' : 'var(--neutral-3)');
  const strokeWidth = isHighlighted ? 2 : 1;
  const opacity = style?.opacity !== undefined ? style.opacity : (isHighlighted ? 1 : 0.3);

  return (
    <path
      d={path}
      stroke={stroke}
      strokeWidth={strokeWidth}
      fill="none"
      opacity={opacity}
      style={{
        transition: 'opacity 0.3s ease'
      }}
    />
  );
}

export default TokenConnection;

