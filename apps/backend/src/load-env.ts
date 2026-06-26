import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(here, "../../../.env");

loadDotenv({ path: rootEnvPath });