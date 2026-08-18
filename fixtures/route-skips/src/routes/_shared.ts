export function registerRoutes(
  router: { post: (path: string, handler: () => void) => void },
  list: { path: string }[],
) {
  for (const cfg of list) {
    router.post(cfg.path, () => {});
  }
}
