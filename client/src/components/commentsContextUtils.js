import { useContext } from "react";
import { CommentsContext } from "./commentsContext";

export function useCommentsContext() {
  return useContext(CommentsContext);
}
