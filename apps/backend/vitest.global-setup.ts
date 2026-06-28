/// <reference path="./src/vitest.d.ts" />
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { GlobalSetupContext } from "vitest/node";

let container: StartedPostgreSqlContainer | undefined;

export default async function ({ provide }: GlobalSetupContext) {
  const existing = process.env.TEST_DATABASE_URL;
  if (existing) {
    provide("databaseUrl", existing);
    return;
  }

  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  provide("databaseUrl", container.getConnectionUri());

  return async () => {
    await container?.stop();
  };
}