import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { type PrinterBlueprint, chalk } from "@codemod-com/printer";
import { type KnownEngines, doubleQuotify } from "@codemod-com/utilities";
import { AxiosError } from "axios";
import inquirer from "inquirer";
import { Project } from "ts-morph";
import { createCodeDiff } from "../apis.js";
import {
  findLastlyModifiedFile,
  findModifiedFiles,
  getFileFromCommit,
  getGitDiffForFile,
  getLatestCommitHash,
  isFileInGitDirectory,
} from "../gitCommands.js";
import { openURL } from "../utils.js";

// remove all special characters and whitespaces
const removeSpecialCharacters = (str: string) =>
  str.replace(/[{}()[\]:;,/?'"<>|=`!]/g, "").replace(/\s/g, "");

const isJSorTS = (name: string) =>
  name.startsWith(".ts") || name.startsWith(".js");

const getFileExtension = (filePath: string) => {
  return extname(filePath).toLowerCase();
};

const UrlParamKeys = {
  Engine: "engine" as const,
  DiffId: "diffId" as const,
  IV: "iv" as const,
  Command: "command" as const,
};

const createCodemodStudioURL = ({
  engine,
  diffId,
  iv,
}: {
  engine: KnownEngines;
  diffId: string;
  iv: string;
}): string | null => {
  try {
    const url = new URL(process.env.CODEMOD_STUDIO_URL);
    const searchParams = new URLSearchParams([
      [UrlParamKeys.Engine, engine],
      [UrlParamKeys.DiffId, diffId],
      [UrlParamKeys.IV, iv],
      [UrlParamKeys.Command, "learn"],
    ]);

    url.search = searchParams.toString();

    return url.toString();
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const handleLearnCliCommand = async (options: {
  printer: PrinterBlueprint;
  target: string | null;
  source: string | null;
}) => {
  const { printer, target, source } = options;

  if (target !== null && !isFileInGitDirectory(target)) {
    printer.printOperationMessage({
      kind: "error",
      message:
        "The file on which you tried to run operation is not in a git repository.",
    });
    return;
  }

  const modifiedPaths = findModifiedFiles();

  if (modifiedPaths === null || modifiedPaths.length === 0) {
    printer.printOperationMessage({
      kind: "error",
      message: "We could not find any modified file to run the command on.",
    });
    return;
  }

  const skipped: string[] = [];
  let paths = modifiedPaths.filter((path) => {
    if (isJSorTS(getFileExtension(path))) {
      return true;
    }

    skipped.push(resolve(path));
    return false;
  });

  if (skipped.length > 0) {
    printer.printOperationMessage({
      kind: "error",
      message: chalk(
        "This feature currently only supports codemod generation using jscodeshift engine, so the files must be either a JavaScript or TypeScript file (.js, .jsx, .ts, .tsx).",
        `\nThe following files will not be processed:\n${skipped
          .map((path) => `  - ${chalk.bold(path)}`)
          .join("\n")}`,
        "\nSoon, we will support other engines and hence other extensions including .md, .mdx and more!",
      ),
    });
  }

  if (paths.length > 1) {
    const { paths: userSelectedPaths } = await inquirer.prompt<{
      paths: string[];
    }>({
      type: "checkbox",
      name: "paths",
      message: "Select the files you want to learn the diffs from",
      choices: paths.map((path) => ({
        name: path.split(sep).slice(-2).join(sep),
        value: path,
        checked: true,
      })),
    });

    paths = userSelectedPaths;
  }

  printer.printConsoleMessage(
    "info",
    chalk.cyan(
      "Learning",
      chalk.bold(doubleQuotify("git diff")),
      "has begun...",
      "\n",
    ),
  );

  const diffs: Record<string, { before: string; after: string }[]> = {};

  for (const dirtyPath of paths) {
    const latestCommitHash = getLatestCommitHash(dirname(dirtyPath));
    if (latestCommitHash === null) {
      printer.printOperationMessage({
        kind: "error",
        message: `Unexpected error occurred while getting the latest commit hash. - ${dirtyPath}`,
      });
      continue;
    }

    const path = dirtyPath.replace(/\$/g, "\\$").replace(/\^/g, "\\^");

    const gitDiff = getGitDiffForFile(latestCommitHash, path);
    if (gitDiff === null) {
      printer.printOperationMessage({
        kind: "error",
        message: `Unexpected error occurred while running ${chalk.bold(
          "git diff",
        )} command. - ${path}`,
      });
      continue;
    }

    if (gitDiff.length === 0) {
      continue;
    }

    const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
    const hunks: {
      header: string;
      hunk: string;
      details: {
        removed: { at: number; count: number } | null;
        added: { at: number; count: number } | null;
      } | null;
    }[] = [];
    let match = hunkPattern.exec(gitDiff);

    while (match !== null) {
      const hunkStart = match.index;

      // Find the next hunk or end of diff
      const nextHunkIndex = gitDiff.indexOf("@@", hunkPattern.lastIndex);
      const hunkEnd = nextHunkIndex !== -1 ? nextHunkIndex : gitDiff.length;
      const hunkContent = gitDiff.substring(hunkStart, hunkEnd);

      hunks.push({
        header: match[0],
        hunk: hunkContent,
        details: {
          removed: match[1]
            ? {
                at: Number.parseInt(match[1], 10),
                count: match[2] ? Number.parseInt(match[2], 10) : 1,
              }
            : null,
          added: match[3]
            ? {
                at: Number.parseInt(match[3], 10),
                count: match[4] ? Number.parseInt(match[4], 10) : 1,
              }
            : null,
        },
      });

      hunkPattern.lastIndex = hunkEnd;
      match = hunkPattern.exec(gitDiff);
    }

    const oldFile = await getFileFromCommit(latestCommitHash, path);
    const newFile = await readFile(path, "utf-8");

    if (!oldFile || !newFile) {
      printer.printOperationMessage({
        kind: "error",
        message: "Unexpected error occurred while reading the file.",
      });

      return;
    }

    diffs[path] = hunks.map(({ header, hunk, details }) => {
      const { removed, added } = details ?? { removed: null, added: null };

      return {
        before: removed
          ? oldFile
              .split("\n")
              .slice(removed.at - 1, removed.at + removed.count)
              .join("\n")
          : "",
        after: added
          ? newFile
              .split("\n")
              .slice(added.at - 1, added.at + added.count)
              .join("\n")
          : "",
      };
    });
  }

  if (Object.keys(diffs).length === 0) {
    printer.printOperationMessage({
      kind: "error",
      message: chalk.yellow("No diffs found in selected files. Aborting..."),
    });
    return;
  }

  printer.printConsoleMessage(
    "info",
    chalk.cyan(`A total of ${diffs.length} diffs found in the files.`),
  );

  if (source !== null) {
    // Improve existing codemod
    await Promise.all(
      Object.entries(diffs).map(async ([path, fileDiffs]) =>
        fileDiffs.map(({ before, after }, i) => {
          const spinner = printer.withLoaderMessage(
            `Processing diff #${i + 1}`,
          );

          try {
            // 1. send request to AI service
            // 2. update the codemod in the source by adding the test fixture and updating the source code
            spinner.succeed();
          } catch (err) {
            spinner.fail();
            const error = err as AxiosError<{ message: string }> | Error;
            printer.printConsoleMessage(
              "error",
              `Failed to process diff for file: ${path} - ${
                error instanceof AxiosError
                  ? error.response?.data.message
                  : error.message
              }`,
            );
            return;
          }
        }),
      ),
    );
    return;
  }

  // Regular studio flow as before (will require multiple diffs support implemented in studio)
  const { id: diffId, iv } = await createCodeDiff(Object.values(diffs).flat());

  const url = createCodemodStudioURL({
    // TODO: Support other engines in the future
    engine: "jscodeshift",
    diffId,
    iv,
  });

  if (url === null) {
    printer.printOperationMessage({
      kind: "error",
      message: "Unexpected error occurred while creating a URL.",
    });
    return;
  }

  printer.printConsoleMessage(
    "info",
    chalk.cyan("Learning went successful! Opening the Codemod Studio...\n"),
  );

  const success = openURL(url);
  if (!success) {
    printer.printOperationMessage({
      kind: "error",
      message: "Unexpected error occurred while opening the Codemod Studio.",
    });
    return;
  }
};
