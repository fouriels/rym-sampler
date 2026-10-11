# The Ultimate RYM Sampler: dashboard and genre atlas

The web companion to [The Ultimate RYM Sampler](https://www.youtube.com/watch?v=bElxttxaPnc) videos on the
[Musique Non-Stop YouTube channel](https://www.youtube.com/@VirulentHorizon): every one of the 2,613 genres on RateYourMusic, one song each.

- **Dashboard**: facts about the genres: how many releases each has, when each genre's top record came out, where its artist is from, how long it runs.
- **Genre Atlas**: browse the genre tree and listen to each genre's song, with a now-playing bar that stays with you as you move around the page.

By [Fouriels](https://ko-fi.com/fouriels).

## Run it

Needs Node.js 20 or newer.

```
npm ci
npm run dev       # http://localhost:5183
npm run build     # the finished site, in dist/
```

The result is plain static files: put `dist/` on any static host (it expects to be served from the root of a domain).

## What is in here

- `src/`: the TypeScript source (Vite). All the words on the page are in `src/copy.json`.
- `public/data/`: the JSON the pages read (genres, the genre graph, summary statistics).
- `public/art/`: the album covers, as 320 px and 64 px WebP.
- `hero.html`, `src/hero/`: the layouts used to draw the Reddit images.

## What is not

This is the site only. The scripts that gather and prepare the data are not here, and neither are the audio files for the few
videos that cannot be embedded in a page: for those genres the atlas says so and links to YouTube instead.

## Data and credits

The genre tree and charts come from RateYourMusic; track details from Spotify, MusicBrainz, Discogs and Wikidata; videos are on YouTube.
Not affiliated with or endorsed by RateYourMusic or Sonemic.
