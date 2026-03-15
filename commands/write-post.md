---
name: write-post
description: Manually write and publish a blog post about the current session
---

Write a blog post about the current coding session, bypassing the automatic triage. Use this when you want to force a post about work the automatic pipeline might not pick up.

## Steps

1. Call `get_blog_config` to check setup. If not configured, tell the user to run `/setup-blog` first.

2. Call `get_writing_guidelines` to load the blog writing template. Follow those instructions exactly for writing style, structure, safety rules, and how to call `publish_post`.

3. Ask the user what they'd like the post to be about. They can:
   - Provide a specific topic (e.g. "the race condition fix we just did")
   - Say "you pick" and you choose the most interesting thing from the conversation so far

4. Call `list_recent_posts` to check for duplicate topics. If a very similar post was recently published, warn the user and ask if they want to proceed anyway.

5. Write the post following the guidelines from step 2.

6. Show the user a preview of the post (title, content, category, tags, excerpt) and ask for confirmation before publishing.

7. Call `publish_post` with the title, markdown content, category, tags, and excerpt.

8. After publishing, update the blog description:
   - Call `list_recent_posts` to get all post titles.
   - Write a single sentence (max 120 chars) describing what the blog focuses on, based on the titles. Be specific about technical domains. No quotes, no period at the end.
   - Call `update_blog_description` with that sentence.

9. Confirm success and show the post URL.
