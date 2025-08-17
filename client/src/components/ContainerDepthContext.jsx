
import React, { useContext } from "react";
import { ContainerDepthContext, useContainerDepth } from "./ContainerDepthContextUtils";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";

export function ContainerDepthProvider({ children }) {
  // Always start at depth 0 for top-level
  return (
    <ContainerDepthContext.Provider value={0}>
      {children}
    </ContainerDepthContext.Provider>
  );
}

export function SteppedContainer({ step = 1, children, style = {}, ...props }) {
  const depth = useContainerDepth();
  const { theme, backgroundColor } = useContext(ThemeContext);
  // Compute stepped background color
  const steppedBg = stepColor(backgroundColor, theme, depth + step);
  const mergedStyle = { ...style, background: steppedBg };
  return (
    <ContainerDepthContext.Provider value={depth + step}>
      <div style={mergedStyle} {...props}>{children}</div>
    </ContainerDepthContext.Provider>
  );
}
