# Editing the page's words

All the dashboard's copy (titles, captions, hints, tile labels, section intros, the footer) and the text on
the hero images lives in **`copy.json`**, one passage per key (`popularity.caveat`, `hero.map.title`, ...).

## In the browser (WYSIWYG)

1. Start the dev server (`npm run dev` from the project root) and open http://localhost:5183/.
2. Click **✎ Edit text** (bottom right). Every editable passage gets a dashed outline.
3. Click into one and type. **Ctrl+B** bolds; Enter, italics and underline are switched off.
4. **Save** writes `copy.json` and reloads; **Discard** undoes unsaved edits; **Done** leaves edit mode.

Hero images: open `http://localhost:5183/hero.html?which=popularity&edit=1` (or `map`, `regional`), edit, Save,
then re-render the PNGs with `node site/scripts/render-hero-images.mjs`.

**Orange chips** are live numbers the code fills in (the median, a country name...). Move them, or delete them
if you no longer want that number mentioned, but don't retype them. To put a number somewhere new, type its
name in braces, e.g. `{median}`: a chip's name shows when you hover it.

## In a text editor

Edit the strings in `copy.json` directly. Keep `{names}` exactly as they are, write `<b>...</b>` for bold, and
escape a double quote as `\"`. The page reloads when you save.

## Safety

Every Save keeps a timestamped copy in `.copy-backups/` (the newest 40). To undo, copy one back over
`copy.json`. The editor exists only on the dev server; the public build contains none of it.

## Not editable here

Text the code builds from data on the fly stays in the code: chart axis labels, tooltips, the level legend,
table headers, the "Loading..." / per-country result headings, and the Genre Atlas tab's labels.
