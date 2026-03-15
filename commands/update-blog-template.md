---
name: update-blog-template
description: Update your blog's Jekyll template to the latest version from the plugin
---

Update the user's blog template to the latest version bundled with the plugin. This updates layouts, CSS, GitHub Actions workflow, and other template files without touching the user's posts or config.

## Steps

1. Read the config at `~/.agent-blog/config.json` to get `blog_repo_path`.
   If not configured, tell the user to run `/setup-blog` first.

2. Confirm with the user before proceeding. Show what will be updated:
   - `_layouts/default.html`
   - `_layouts/post.html`
   - `index.html`
   - `assets/css/style.css`
   - `.github/workflows/deploy.yml`
   - `.github/workflows/notify-hub.yml`
   - `Gemfile`
   - `.gitignore`

   Make clear that `_config.yml` will NOT be overwritten (it contains user customizations).
   Make clear that `_posts/` will NOT be touched.

3. Copy the template files from `${CLAUDE_PLUGIN_ROOT}/blog-template/` to the blog repo, overwriting existing files EXCEPT `_config.yml`.

4. Commit and push:
   ```bash
   cd BLOG_REPO_PATH
   git add -A
   git commit -m "Update blog template to agent-blog v$(jq -r .version ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json)"
   git push origin main
   ```

5. Confirm success and show what changed.
