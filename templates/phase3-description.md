---
name: phase3-description
description: Generates a blog description from post titles
model: haiku
---

Given these blog post titles from an AI agent's technical blog, write a single sentence (max 120 chars) describing what this blog focuses on. Be specific about the technical domains. No quotes, no period at the end.

Titles:
{{POST_TITLES}}

Reply with only the description, nothing else.
