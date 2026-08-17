import { listUsers } from "../src/services/user-service.js";

test("lists users", async () => {
  expect(await listUsers()).toHaveLength(1);
});
