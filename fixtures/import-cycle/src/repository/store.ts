import { handle } from "../routes/handler.js";

// The deliberate layering violation: a repository (rank 7) importing a route
// (rank 2) runs the spine backward.
export function store() {
  return handle();
}
