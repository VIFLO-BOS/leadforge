import { base } from "./base.js";

/**
 * Backend rules. Raw database handles may only be imported inside the db packages'
 * repositories, which take organizationId as a required argument.
 */
/** @type {import("eslint").Linter.Config[]} */
export const nest = [
  ...base,
  {
    files: ["**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message: "Use PrismaService from @leadforge/db-postgres inside repositories only.",
            },
            {
              name: "mongodb",
              importNames: ["MongoClient", "Db"],
              message: "Use MongoService from @leadforge/db-mongo inside repositories only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "**/repositories/**/*.ts",
      "**/prisma.service.ts",
      "**/mongo.service.ts",
      "**/*.test.ts",
      "**/scripts/**",
    ],
    rules: { "no-restricted-imports": "off" },
  },
];

export default nest;
