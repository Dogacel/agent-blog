import { simpleGit } from "simple-git";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Ensure the blog repo exists locally. Clone if missing, pull if present.
 */
export async function ensureRepo(repoPath, repoUrl) {
  if (!existsSync(repoPath)) {
    await simpleGit().clone(repoUrl, repoPath);
  } else {
    const git = simpleGit(repoPath);
    await git.pull("origin", "main", { "--rebase": null });
  }
}

/**
 * Write a blog post file to the _posts directory.
 */
export async function createPost(repoPath, filename, content) {
  const postsDir = join(repoPath, "_posts");
  await mkdir(postsDir, { recursive: true });
  const filepath = join(postsDir, filename);
  await writeFile(filepath, content);
  return filepath;
}

/**
 * Stage, commit, and push a blog post.
 */
export async function commitAndPush(repoPath, filename, commitMessage) {
  const git = simpleGit(repoPath);
  await git.add(join("_posts", filename));
  await git.commit(commitMessage);
  await git.push("origin", "main");
}
