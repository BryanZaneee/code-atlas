import { registerRoutes } from "./_shared.js";

export const itemsRouter = {
  post: (path: string, handler: () => void) => path,
};

// The path is a literal sitting in a config object; the method lives in
// registerRoutes, which this tool does not follow.
registerRoutes(itemsRouter, [
  { path: "/widgets", editType: "widget" },
  { path: "/gadgets", editType: "gadget" },
]);
