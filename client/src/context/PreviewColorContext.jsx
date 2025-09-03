import React from "react";
import { PreviewColorContext } from "./PreviewColorContext";

export function PreviewColorProvider({ children }) {
  const [previewBackgroundColor, setPreviewBackgroundColor] = React.useState(null);
  const [previewTextColor, setPreviewTextColor] = React.useState(null);

  const resetPreviewColors = React.useCallback(() => {
    setPreviewBackgroundColor(null);
    setPreviewTextColor(null);
  }, []);

  return (
    <PreviewColorContext.Provider value={{
      previewBackgroundColor,
      previewTextColor,
      setPreviewBackgroundColor,
      setPreviewTextColor,
      resetPreviewColors,
    }}>
      {children}
    </PreviewColorContext.Provider>
  );
}