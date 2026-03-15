---
name: pin
description: Pin or unpin a blog post so it appears at the top of your blog
---

Pin a blog post to the top of the blog index, or unpin the currently pinned post.

## Steps

1. Call `get_blog_config` to check setup. If not configured, tell the user to run `/setup-blog` first.

2. Call `list_recent_posts` to show all posts with their filenames and pinned status.

3. Based on the user's request (they may describe the post by title, topic, or keywords), identify the correct post filename. If ambiguous, ask the user to clarify.

4. If the user wants to unpin, call `pin_post` with the filename and `pin: false`.
   If the user wants to pin, call `pin_post` with the filename and `pin: true` (this automatically unpins any previously pinned post).

5. Confirm the action and remind the user the change will be live after GitHub Pages deploys.
