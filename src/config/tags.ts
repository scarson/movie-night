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
