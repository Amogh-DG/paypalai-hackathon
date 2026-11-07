import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";

const noCommentsRule = {
  meta: {
    type: "problem",
    schema: [],
  },
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode.getAllComments();
        for (const comment of comments) {
          context.report({
            loc: comment.loc,
            message: "No code comments allowed",
          });
        }
      },
    };
  },
};

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      custom: {
        rules: {
          "no-comments": noCommentsRule,
        },
      },
    },
    rules: {
      "custom/no-comments": "error",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
    ],
  },
];
