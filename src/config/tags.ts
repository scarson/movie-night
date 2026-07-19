// ABOUTME: Shared tag vocabulary for taste profiles and session moods.
// ABOUTME: MOOD_TAGS and GENRE_TAGS are the preset chips; custom freetext tags are allowed on top.
export const MOOD_TAGS = [
  "Cozy", "Thrilling", "Cerebral", "Feel-Good", "Dark", "Funny", "Romantic",
  "Mind-Bending", "Adventurous", "Emotional", "Suspenseful", "Lighthearted",
  "Heavy", "Slow-Burn", "Intense", "Quirky",
] as const;

export const GENRE_TAGS = [
  "Horror", "Musical", "Romance", "Sci-Fi", "Animation", "Documentary",
  "Western", "War", "True Crime", "Superhero", "Action", "Drama",
  "Fantasy", "Mystery",
] as const;

export const ALL_TAGS = [...MOOD_TAGS, ...GENRE_TAGS];

// Maps each GENRE_TAG to its TMDB movie-genre name for SQL-level candidate
// filtering. null = no TMDB genre equivalent; those dealbreakers are enforced
// by the matching prompt only, never by SQL.
export const GENRE_TAG_TO_TMDB: Record<(typeof GENRE_TAGS)[number], string | null> = {
  Horror: "Horror",
  Musical: "Music",
  Romance: "Romance",
  "Sci-Fi": "Science Fiction",
  Animation: "Animation",
  Documentary: "Documentary",
  Western: "Western",
  War: "War",
  "True Crime": null,
  Superhero: null,
  Action: "Action",
  Drama: "Drama",
  Fantasy: "Fantasy",
  Mystery: "Mystery",
};
