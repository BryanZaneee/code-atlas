import { findAll, findById } from "../repository/user-repo";

export async function listUsers() {
  return findAll();
}

export async function getUser(id: string) {
  return findById(id);
}
