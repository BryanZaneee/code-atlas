const ROWS = [{ id: "1", name: "ada" }];

export async function findAll() {
  return ROWS;
}

export async function findById(id: string) {
  return ROWS.find((r) => r.id === id) ?? null;
}
