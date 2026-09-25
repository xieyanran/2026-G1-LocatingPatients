import { ensureTestUsers } from "../integration/setup/test-users"

export default async function globalSetup() {
  await ensureTestUsers()
}
