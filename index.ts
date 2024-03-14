import git from "isomorphic-git";
import * as Diff from "diff";

import { mkdtemp } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import fs from "node:fs";

function makeTempDir() {
  return mkdtemp(join(tmpdir(), "git-"));
}

async function diff(dir: string, sha: string) {
  const commit = await git.readCommit({ fs, dir, oid: sha });

  function removeNoiseFromPatch(patch: string) {
    return patch.split("\n").slice(2).join("\n");
  }

  return git.walk({
    fs,
    dir,
    trees: [
      git.TREE({
        ref:
          commit.commit.parent?.[0] ||
          "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      }),
      git.TREE({ ref: commit.oid }),
    ],
    async map(filepath, [A, B]) {
      if (filepath === ".") return;
      if ((await A?.type()) === "tree" || (await B?.type()) === "tree") return;

      // Get the file mode for the file at this point of time.
      const aMode = await A?.mode();
      const bMode = await B?.mode();
      // console.log({ aMode, bMode });

      // Determine the type of change that happened.
      const aOID = await A?.oid();
      const bOID = await B?.oid();
      // console.log({ aOID, bOID });

      let type: "add" | "equal" | "modify" | "remove" = "equal";
      if (aOID !== bOID) type = "modify";
      if (aOID === undefined) type = "add";
      if (bOID === undefined) type = "remove";
      if (aOID === undefined && bOID === undefined) {
        throw new Error(
          `Something weird happened while trying to walk on: ${filepath}`,
        );
      }

      switch (type) {
        case "add": {
          const content = await B?.content().then(
            (blob) => blob && new TextDecoder("utf8").decode(blob),
          );
          const patch = Diff.createPatch(filepath, "", content ?? "");

          // eslint-disable-next-line consistent-return
          return {
            diff: removeNoiseFromPatch(patch),
            new_path: filepath,
            old_path: null,
            a_mode: aMode ? String(aMode) : null,
            b_mode: bMode ? String(bMode) : null,
            new_file: true,
            renamed_file: false,
            deleted_file: false,
          };
        }

        case "modify": {
          const aContent = await A?.content().then(
            (blob) => blob && new TextDecoder("utf8").decode(blob),
          );
          const bContent = await B?.content().then(
            (blob) => blob && new TextDecoder("utf8").decode(blob),
          );

          const patch = Diff.createPatch(
            filepath,
            aContent ?? "",
            bContent ?? "",
          );

          // eslint-disable-next-line consistent-return
          return {
            diff: removeNoiseFromPatch(patch),
            new_path: filepath,
            old_path: filepath,
            a_mode: aMode ? String(aMode) : null,
            b_mode: bMode ? String(aMode) : null,
            new_file: false,
            renamed_file: false,
            deleted_file: false,
          };
        }

        case "remove": {
          const aContent = await A?.content().then(
            (blob) => blob && new TextDecoder("utf8").decode(blob),
          );
          const bContent = await B?.content().then(
            (blob) => blob && new TextDecoder("utf8").decode(blob),
          );
          const patch = Diff.createPatch(
            filepath,
            aContent ?? "",
            bContent ?? "",
          );

          // eslint-disable-next-line consistent-return
          return {
            diff: removeNoiseFromPatch(patch),
            new_path: null,
            old_path: filepath,
            a_mode: aMode ? String(aMode) : null,
            b_mode: bMode ? String(aMode) : null,
            new_file: false,
            renamed_file: false,
            deleted_file: true,
          };
        }

        case "equal": {
          // `equal` events happen because as we're walking through the tree we receive a list
          // of all the files that exist in the repository at that point in time. These files
          // haven't changed so there's no diff to show.
          return;
        }

        default:
          throw new Error(`${type} changes are umplemented.`);
      }
    },
  });
}

async function main() {
  const dir = await makeTempDir();
  const author = { name: "Owlbert", email: "owlbert@readme.io" };

  console.log(`Creating git repo in ${dir}`);

  await git.init({ fs, dir, defaultBranch: "main" });

  const filePath1 = join(dir, "page-1.md");
  console.log("Creating first file and committing", filePath1);
  fs.writeFileSync(filePath1, "# This is the first page");
  await git.add({ fs, dir, filepath: basename(filePath1) });
  await git.commit({
    fs,
    dir,
    message: "Initial commit, adding first file",
    author,
  });

  const filePath2 = join(dir, "page-2.md");
  console.log("Creating second file and committing", filePath2);
  fs.writeFileSync(filePath2, "# This is the second page");
  await git.add({ fs, dir, filepath: basename(filePath2) });
  await git.commit({
    fs,
    dir,
    message: "Initial commit, adding second file",
    author,
  });

  const [firstCommit, secondCommit] = (await git.log({ fs, dir })).reverse();

  console.log(firstCommit.commit.message, await diff(dir, firstCommit.oid));
  console.log(secondCommit.commit.message, await diff(dir, secondCommit.oid));
}

main();
