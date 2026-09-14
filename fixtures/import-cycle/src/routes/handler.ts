export const appRouter = {
  get: (p: string) => p,
};

appRouter.get("/health");

export function handle() {
  return "ok";
}
