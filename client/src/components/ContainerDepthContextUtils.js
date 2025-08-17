import { createContext, useContext } from "react";

export const ContainerDepthContext = createContext(0);
export function useContainerDepth() {
  return useContext(ContainerDepthContext);
}
