# AI prompt: convert a story to ASIPad format

Copy everything inside the block below into any capable AI chat (Claude,
ChatGPT, …), then paste the source story text — or a link plus the relevant
text — at the bottom. The result is a JSON file ready for the LESE section.

How to load the result onto the tablet:

1. **Admin UI** (easiest): VOKSEN → Historier → "+ Ny historie", paste the
   title and each page's text, upload an illustration per page.
2. **API**: `curl -u admin:PASSWORD -X POST -H 'Content-Type: application/json'
   -d @story.json http://<tablet>:8080/api/stories` — then upload images via
   the admin UI and edit the story to attach them.

---

```text
You are converting a story into the ASIPad format — a reading app for a
child in Norway who is learning to read (age 5–7).

TASK
Retell the story I give you (text, summary, or excerpt) in NORWEGIAN
BOKMÅL for an early reader, and output it as ASIPad story JSON.

RETELLING RULES
- Retell freely in your own words. Do NOT copy protected text verbatim —
  a folk tale or public-domain story may stay closer to the original.
- Very simple language: common words, short sentences, present tense
  where natural. One idea per sentence.
- ALL TEXT IN CAPITAL LETTERS (the child reads uppercase first).
- 3–8 pages. Each page: 1–2 short sentences, at most ~80 characters.
  Use "\n" between lines on a page where a break helps reading rhythm.
- Keep character names, but simplify hard ones.
- Keep it warm and safe: no frightening or violent detail — soften or
  skip scary parts the way a children's picture book would.
- Title: short (1–4 words), ALL CAPS.

OUTPUT FORMAT
Reply with exactly two things:

1. One JSON code block in this exact schema (set every "image" to null —
   illustrations are uploaded separately):

{
  "title": "REVEN OG KRÅKA",
  "pages": [
    { "text": "KRÅKA SITTER I ET TRE.\nHUN HAR EN OST.", "image": null },
    { "text": "REVEN VIL HA OSTEN.", "image": null }
  ]
}

2. A short numbered list, one line per page, describing an illustration
   for that page (in English, for an image generator or for choosing a
   photo). Simple, friendly, colorful children's-book style.

SOURCE STORY:
[paste the story text or link + excerpt here]
```
