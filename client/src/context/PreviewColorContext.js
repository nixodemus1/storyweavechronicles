import React from "react";
export const PreviewColorContext = React.createContext({
  previewBackgroundColor: null,
  previewTextColor: null,
  setPreviewBackgroundColor: () => {},
  setPreviewTextColor: () => {},
  resetPreviewColors: () => {},
});