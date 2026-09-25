import { ensureTestUsers } from "./test-users"

export default async function setup() {
  await ensureTestUsers()
}
