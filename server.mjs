#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";

const CONFIG_PATH = join(homedir(), ".agent-blog", "config.json");
const HISTORY_PATH = join(homedir(), ".agent-blog", "history.json");

// --- Secret scrubbing ---

const SECRET_PATTERNS = [
  // API keys and tokens
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{16,}["']?/gi,
  // AWS
  /AKIA[0-9A-Z]{16}/g,
  /(?:aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  // Generic secrets
  /(?:password|passwd|pwd|secret)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi,
  // Private keys
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  // Connection strings
  /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi,
  // Anthropic/OpenAI keys
  /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
];

function scrubSecrets(text) {
  const findings = [];
  let scrubbed = text;

  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = scrubbed.match(pattern);
    if (matches) {
      for (const match of matches) {
        findings.push(match.slice(0, 20) + "...");
      }
      scrubbed = scrubbed.replace(pattern, "[REDACTED]");
    }
  }

  return { scrubbed, findings };
}

// --- Helpers ---

function expandHome(filepath) {
  if (filepath.startsWith("~/")) {
    return join(homedir(), filepath.slice(2));
  }
  if (filepath.startsWith("~")) {
    return join(homedir(), filepath.slice(1));
  }
  return filepath;
}

async function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
  // Expand ~ in paths
  if (config.blog_repo_path) {
    config.blog_repo_path = expandHome(config.blog_repo_path);
  }
  return config;
}

async function readHistory() {
  if (!existsSync(HISTORY_PATH)) return { posts: [] };
  return JSON.parse(await readFile(HISTORY_PATH, "utf-8"));
}

async function writeHistory(history) {
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}

// --- MCP Server ---

const server = new McpServer({
  name: "agent-blog",
  version: "0.1.1",
});

// Tool: get_blog_config
server.registerTool(
  "get_blog_config",
  {
    description:
      "Get the user's Agent Blog configuration. Returns null if not configured.",
    inputSchema: {},
  },
  async () => {
    const config = await readConfig();
    return {
      content: [
        {
          type: "text",
          text: config
            ? JSON.stringify(config, null, 2)
            : "Not configured. User needs to run /setup-blog first.",
        },
      ],
    };
  }
);

// Tool: list_recent_posts
server.registerTool(
  "list_recent_posts",
  {
    description:
      "List recently published blog posts. Use this to avoid writing duplicate topics.",
    inputSchema: {
      count: z
        .number()
        .optional()
        .describe("Number of recent posts to return (default: 10)"),
    },
  },
  async ({ count }) => {
    const limit = count ?? 10;
    const config = await readConfig();
    if (!config) {
      return {
        content: [{ type: "text", text: "Not configured." }],
      };
    }

    const postsDir = join(config.blog_repo_path, "_posts");
    if (!existsSync(postsDir)) {
      return {
        content: [{ type: "text", text: "No posts directory found." }],
      };
    }

    const files = await readdir(postsDir);
    const posts = files
      .filter((f) => f.endsWith(".md") && f !== ".gitkeep")
      .sort()
      .reverse()
      .slice(0, limit);

    if (posts.length === 0) {
      return {
        content: [{ type: "text", text: "No posts published yet." }],
      };
    }

    const postList = posts
      .map((f) => {
        const match = f.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
        if (!match) return `- ${f}`;
        const [, date, slug] = match;
        return `- ${date}: ${slug.replace(/-/g, " ")}`;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: postList }],
    };
  }
);

// Tool: publish_post
server.registerTool(
  "publish_post",
  {
    description:
      "Publish a blog post. By default, commits directly to main and the post goes live immediately. If the user has configured use_drafts=true, commits to a drafts branch and creates a PR instead.",
    inputSchema: {
      title: z.string().describe("Blog post title"),
      content: z
        .string()
        .describe("Blog post body in markdown (without front matter)"),
      category: z
        .enum([
          "debugging",
          "architecture",
          "performance",
          "til",
          "tooling",
          "integration",
        ])
        .describe("Post category"),
      tags: z
        .array(z.string())
        .describe("2-4 specific technical tags"),
    },
  },
  async ({ title, content, category, tags }) => {
    const config = await readConfig();
    if (!config) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Agent Blog not configured. Run /setup-blog first.",
          },
        ],
      };
    }

    const repoPath = config.blog_repo_path;
    if (!existsSync(repoPath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Blog repo not found at ${repoPath}`,
          },
        ],
      };
    }

    const useDrafts = config.use_drafts === true;

    // --- Secret scrubbing ---
    const { scrubbed: scrubbedTitle, findings: titleFindings } =
      scrubSecrets(title);
    const { scrubbed: scrubbedContent, findings: contentFindings } =
      scrubSecrets(content);
    const allFindings = [...titleFindings, ...contentFindings];

    if (allFindings.length > 0) {
      console.error(
        `[agent-blog] Scrubbed ${allFindings.length} potential secret(s) from post`
      );
    }

    // --- Generate file ---
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const timestamp = now
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z/, " +0000");
    const slug = scrubbedTitle
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = `${date}-${slug}.md`;

    const frontMatter = [
      "---",
      "layout: post",
      `title: "${scrubbedTitle.replace(/"/g, '\\"')}"`,
      `date: ${timestamp}`,
      `categories: [${category}]`,
      `tags: [${tags.join(", ")}]`,
      "---",
    ].join("\n");

    const postContent = `${frontMatter}\n\n${scrubbedContent}\n`;

    const git = simpleGit(repoPath);
    const targetBranch = useDrafts ? "drafts" : "main";

    try {
      await git.fetch("origin");

      if (useDrafts) {
        // --- Drafts mode: commit to drafts branch, create PR ---
        const branches = await git.branch(["-r"]);
        const draftExists = branches.all.some((b) =>
          b.includes("origin/drafts")
        );

        if (draftExists) {
          await git.checkout("drafts");
          await git.pull("origin", "drafts", { "--rebase": null });
        } else {
          await git.checkout("main");
          await git.pull("origin", "main", { "--rebase": null });
          await git.checkoutLocalBranch("drafts");
        }
      } else {
        // --- Direct mode: commit to main ---
        await git.checkout("main");
        await git.pull("origin", "main", { "--rebase": null });
      }

      // Write post file
      const postsDir = join(repoPath, "_posts");
      await mkdir(postsDir, { recursive: true });
      const filepath = join(postsDir, filename);
      await writeFile(filepath, postContent);

      // Commit and push (retry once on conflict for multi-machine setups)
      await git.add(join("_posts", filename));
      await git.commit(`Add post: ${scrubbedTitle}`);
      try {
        await git.push("origin", targetBranch, useDrafts ? { "--set-upstream": null } : {});
      } catch (pushErr) {
        // Likely a conflict from another machine — pull rebase and retry
        await git.pull("origin", targetBranch, { "--rebase": null });
        await git.push("origin", targetBranch, useDrafts ? { "--set-upstream": null } : {});
      }

      // Switch back to main if on drafts
      if (useDrafts) {
        await git.checkout("main");
      }
    } catch (err) {
      try {
        await git.checkout("main");
      } catch {}
      return {
        content: [
          {
            type: "text",
            text: `Error during git operations: ${err.message}`,
          },
        ],
      };
    }

    // --- Create PR if drafts mode ---
    let prUrl = "";
    if (useDrafts) {
      try {
        const prBody = `## New Blog Post\n\n**${scrubbedTitle}**\n\nCategory: ${category} | Tags: ${tags.join(", ")}\n\n---\n\n${scrubbedContent.slice(0, 2000)}${scrubbedContent.length > 2000 ? "\n\n..." : ""}`;

        prUrl = execSync(
          `gh pr create --repo "${config.github_username}/my-agent-blog" --head drafts --base main --title "${scrubbedTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
          { cwd: repoPath, encoding: "utf-8", timeout: 30000 }
        ).trim();
      } catch (err) {
        const errMsg = err.message || "";
        if (errMsg.includes("already exists")) {
          prUrl = "(PR already open for drafts → main)";
        } else {
          prUrl = `(PR creation failed: ${errMsg.slice(0, 100)})`;
        }
      }
    }

    // Record in history
    const history = await readHistory();
    history.posts.push({
      title: scrubbedTitle,
      date,
      slug,
      filename,
      category,
      tags,
      mode: useDrafts ? "drafts" : "direct",
      ...(prUrl && { pr: prUrl }),
      secretsScrubbed: allFindings.length,
    });
    await writeHistory(history);

    const warnings =
      allFindings.length > 0
        ? `\nWARNING: ${allFindings.length} potential secret(s) were redacted. Please review the post.`
        : "";

    if (useDrafts) {
      return {
        content: [
          {
            type: "text",
            text: `Draft created: "${scrubbedTitle}"\nFile: _posts/${filename}\nBranch: drafts\nPR: ${prUrl}\n\nThe post will be published when the PR is merged.${warnings}`,
          },
        ],
      };
    }

    const blogUrl = `https://${config.github_username}.github.io/my-agent-blog/${category}/${date.replace(/-/g, "/")}/${slug}/`;
    return {
      content: [
        {
          type: "text",
          text: `Published: "${scrubbedTitle}"\nFile: _posts/${filename}\nURL: ${blogUrl}${warnings}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Blog MCP server running");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
