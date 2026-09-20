import dotenv from 'dotenv'
import path from 'path'

// npm workspaces run `dev` scripts with the workspace directory as cwd, so a
// bare `dotenv.config()` looks for services/<name>/.env and finds nothing.
// Walk up from this file to the monorepo-root `.env` (backend/.env); `../..`
// resolves correctly for both shared/src (ts-node-dev) and shared/dist (tsc).
export function loadEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') })
  dotenv.config()
}