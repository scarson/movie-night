import { useState } from "react";

// ── Movie Dataset (~100 films) ──────────────────────────────────────────
const MOVIES = [
  "The Grand Budapest Hotel","Inception","Parasite","The Princess Bride","Interstellar",
  "Knives Out","Everything Everywhere All at Once","The Shawshank Redemption","Spirited Away",
  "Mad Max: Fury Road","La La Land","The Dark Knight","Dune: Part Two","Past Lives",
  "Oppenheimer","Barbie","The Lord of the Rings: The Fellowship of the Ring","Pulp Fiction",
  "Forrest Gump","The Matrix","Fight Club","Goodfellas","The Silence of the Lambs",
  "Schindler's List","Saving Private Ryan","Gladiator","The Departed","No Country for Old Men",
  "There Will Be Blood","Whiplash","Get Out","Moonlight","The Social Network",
  "Arrival","Blade Runner 2049","Her","Ex Machina","Eternal Sunshine of the Spotless Mind",
  "Lost in Translation","Amélie","The Truman Show","Good Will Hunting","A Beautiful Mind",
  "The Prestige","Memento","Shutter Island","Gone Girl","Zodiac",
  "Prisoners","Nightcrawler","Sicario","Wind River","Hell or High Water",
  "Jojo Rabbit","Hunt for the Wilderpeople","About Time",
  "The Secret Life of Walter Mitty","Chef","Julie & Julia","Ratatouille","WALL-E","Up",
  "Inside Out","Coco","Soul","Toy Story","Finding Nemo","Monsters, Inc.",
  "The Iron Giant","My Neighbor Totoro","Princess Mononoke","Howl's Moving Castle",
  "When Harry Met Sally","Sleepless in Seattle","Notting Hill","Pride and Prejudice",
  "10 Things I Hate About You","Crazy Rich Asians","The Notebook","Before Sunrise",
  "Call Me by Your Name","Portrait of a Lady on Fire","Moonrise Kingdom",
  "The Royal Tenenbaums","Fantastic Mr. Fox","Isle of Dogs",
  "Django Unchained","Kill Bill: Volume 1","John Wick","Baby Driver","Top Gun: Maverick",
  "Mission: Impossible – Fallout","The Bourne Identity","Heat",
  "Alien","The Thing","A Quiet Place","Midsommar","Hereditary","The Witch",
  "Pan's Labyrinth","The Shape of Water",
  "Bohemian Rhapsody","Walk the Line","Amadeus","The Pianist",
  "12 Angry Men","To Kill a Mockingbird","Rear Window","Vertigo","Psycho",
];

// Unified taste tags — used for both "I want" (vibes) and "I don't want" (dealbreakers)
const MOOD_TAGS = ["Cozy","Thrilling","Cerebral","Feel-Good","Dark","Funny","Romantic","Mind-Bending","Adventurous","Emotional","Suspenseful","Lighthearted","Heavy","Slow-Burn","Intense","Quirky"];
const GENRE_TAGS = ["Horror","Musical","Romance","Sci-Fi","Animation","Documentary","Western","War","True Crime","Superhero","Action","Drama","Fantasy","Mystery"];
const ALL_TAGS = [...MOOD_TAGS, ...GENRE_TAGS];
const LOADING_PHASES = [
  "Reading taste profiles...",
  "Mapping preference overlap...",
  "Identifying tension points...",
  "Scoring candidate movies...",
  "Generating recommendations...",
];

// ── Subcomponents (defined outside main to avoid remount) ───────────────

function Chip({ label, selected, color = "indigo", onClick }) {
  const styles = {
    indigo: selected ? { background: "#4f46e5", color: "#fff", border: "2px solid #4f46e5" }
      : { background: "#eef2ff", color: "#4338ca", border: "2px solid #c7d2fe" },
    rose: selected ? { background: "#e11d48", color: "#fff", border: "2px solid #e11d48" }
      : { background: "#fff1f2", color: "#be123c", border: "2px solid #fecdd3" },
    amber: selected ? { background: "#d97706", color: "#fff", border: "2px solid #d97706" }
      : { background: "#fffbeb", color: "#b45309", border: "2px solid #fde68a" },
    emerald: selected ? { background: "#059669", color: "#fff", border: "2px solid #059669" }
      : { background: "#ecfdf5", color: "#047857", border: "2px solid #a7f3d0" },
  };
  return (
    <span onClick={onClick} style={{
      ...styles[color], padding: "6px 14px", borderRadius: "999px", fontSize: "13px",
      fontWeight: selected ? "600" : "400", display: "inline-block", cursor: "pointer",
      transition: "all 0.15s ease",
    }}>{label}</span>
  );
}

function SectionLabel({ icon, label, sublabel }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 16px", marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "16px", fontWeight: "700", color: "#1e293b" }}>
        <span style={{ fontSize: "20px" }}>{icon}</span> {label}
      </div>
      {sublabel && <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px", marginLeft: "30px", lineHeight: "1.4" }}>{sublabel}</div>}
    </div>
  );
}

function MovieSearch({ selected, setSelected, color, quickPicks = [] }) {
  const [search, setSearch] = useState("");
  const filtered = MOVIES.filter(m =>
    m.toLowerCase().includes(search.toLowerCase()) && !selected.includes(m)
  ).slice(0, 8);

  const unselectedQuickPicks = quickPicks.filter(m => !selected.includes(m));

  return (
    <div>
      {/* Quick pick bubbles */}
      {(unselectedQuickPicks.length > 0 || selected.length > 0) && (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {selected.map(m => (
              <Chip key={m} label={`${m} ✕`} selected={true} color={color}
                onClick={() => setSelected(prev => prev.filter(x => x !== m))} />
            ))}
            {unselectedQuickPicks.map(m => (
              <Chip key={m} label={m} selected={false} color={color}
                onClick={() => setSelected(prev => [...prev, m])} />
            ))}
          </div>
        </div>
      )}
      {/* Search input */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search to add more..."
        style={{
          width: "100%", padding: "8px 14px", fontSize: "16px",
          border: "2px solid #e2e8f0", borderRadius: "10px",
          background: "#fff", color: "#1e293b", outline: "none",
          boxSizing: "border-box", marginBottom: "8px",
        }}
      />
      {search && filtered.length > 0 && (
        <div style={{
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px",
          marginBottom: "10px", maxHeight: "160px", overflowY: "auto",
        }}>
          {filtered.map(m => (
            <div key={m} onClick={() => { setSelected(prev => [...prev, m]); setSearch(""); }}
              style={{ padding: "10px 14px", fontSize: "14px", color: "#374151", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoughDayToggle({ partnerName, roughDay, setRoughDay }) {
  return (
    <button onClick={() => setRoughDay(!roughDay)}
      style={{
        width: "100%", padding: "16px 20px", borderRadius: "12px",
        background: roughDay ? "#fef3c7" : "#f8fafc",
        border: roughDay ? "2px solid #f59e0b" : "2px solid #e2e8f0",
        cursor: "pointer", textAlign: "left",
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "22px", flexShrink: 0 }}>{roughDay ? "💛" : "🤍"}</span>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "700", color: roughDay ? "#92400e" : "#374151" }}>
              {partnerName} had a rough day
            </div>
            <div style={{ fontSize: "12px", color: roughDay ? "#b45309" : "#94a3b8", marginTop: "2px", lineHeight: "1.4" }}>
              Prioritize their preferences over mine tonight — I want them to enjoy this
            </div>
          </div>
        </div>
        <div style={{
          width: "44px", minWidth: "44px", height: "24px", borderRadius: "12px",
          background: roughDay ? "#f59e0b" : "#cbd5e1", position: "relative", flexShrink: 0,
        }}>
          <div style={{
            width: "20px", height: "20px", borderRadius: "50%", background: "#fff",
            position: "absolute", top: "2px", left: roughDay ? "22px" : "2px",
            transition: "left 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          }} />
        </div>
      </div>
    </button>
  );
}

function CustomTagInput({ tags, setTags, color, placeholder }) {
  const [input, setInput] = useState("");
  const presets = [...MOOD_TAGS, ...GENRE_TAGS];
  const customTags = tags.filter(t => !presets.includes(t));

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
      setInput("");
    }
  };

  return (
    <div style={{ marginTop: "10px" }}>
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          placeholder={placeholder}
          style={{
            flex: 1, padding: "8px 14px", fontSize: "16px",
            border: "2px solid #e2e8f0", borderRadius: "10px",
            background: "#fff", color: "#1e293b", outline: "none",
            boxSizing: "border-box",
          }}
        />
        <button onClick={addTag}
          style={{
            padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: "600",
            background: input.trim() ? "#4f46e5" : "#e2e8f0",
            color: input.trim() ? "#fff" : "#94a3b8",
            border: "none", cursor: input.trim() ? "pointer" : "default",
            flexShrink: 0,
          }}>Add</button>
      </div>
      {customTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
          {customTags.map(t => (
            <Chip key={t} label={`${t} ✕`} selected={true} color={color}
              onClick={() => setTags(prev => prev.filter(x => x !== t))} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileScreen({ name, setName, comfort, setComfort, watchlist, setWatchlist,
  vibes, setVibes, dealbreakers, setDealbreakers, personLabel, partnerName,
  roughDay, setRoughDay, toggle, comfortQuickPicks, watchlistQuickPicks }) {
  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px 0", fontFamily: "Georgia, serif" }}>
          {name}'s Taste Profile
        </h2>
        <p style={{ fontSize: "14px", color: "#64748b", margin: 0, lineHeight: "1.5" }}>
          Tell us what you love, what you're curious about, and what's off the table.
        </p>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label style={{ fontSize: "14px", fontWeight: "600", color: "#374151", display: "block", marginBottom: "6px" }}>Your Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name"
          style={{ width: "100%", padding: "10px 14px", fontSize: "16px", border: "2px solid #e2e8f0", borderRadius: "10px", background: "#fff", color: "#1e293b", outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ marginTop: "20px" }}>
        <SectionLabel icon="🛋️" label="Comfort Movies" sublabel="Tap to select, or search to add more" />
        <MovieSearch selected={comfort} setSelected={setComfort} color="indigo" quickPicks={comfortQuickPicks} />
      </div>

      <div style={{ marginTop: "24px" }}>
        <SectionLabel icon="👀" label="Watchlist" sublabel="Movies you haven't seen yet but want to" />
        <MovieSearch selected={watchlist} setSelected={setWatchlist} color="emerald" quickPicks={watchlistQuickPicks} />
      </div>

      <div style={{ marginTop: "24px" }}>
        <SectionLabel icon="✨" label="I Want" sublabel="Moods, tones, and genres you're into — pick from presets or add your own" />
        <div style={{ marginBottom: "8px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Moods & Tones</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {MOOD_TAGS.map(v => <Chip key={v} label={v} selected={vibes.includes(v)} color="amber" onClick={() => toggle(vibes, setVibes, v)} />)}
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Genres</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {GENRE_TAGS.map(v => <Chip key={v} label={v} selected={vibes.includes(v)} color="amber" onClick={() => toggle(vibes, setVibes, v)} />)}
          </div>
        </div>
        <CustomTagInput tags={vibes} setTags={setVibes} color="amber" placeholder='Add your own, e.g. "90s nostalgia"' />
      </div>

      <div style={{ marginTop: "24px" }}>
        <SectionLabel icon="🚫" label="Dealbreakers" sublabel="Anything you absolutely don't want — pick from presets or add your own" />
        <div style={{ marginBottom: "8px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Moods & Tones</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {MOOD_TAGS.map(g => <Chip key={g} label={g} selected={dealbreakers.includes(g)} color="rose" onClick={() => toggle(dealbreakers, setDealbreakers, g)} />)}
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Genres</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {GENRE_TAGS.map(g => <Chip key={g} label={g} selected={dealbreakers.includes(g)} color="rose" onClick={() => toggle(dealbreakers, setDealbreakers, g)} />)}
          </div>
        </div>
        <CustomTagInput tags={dealbreakers} setTags={setDealbreakers} color="rose" placeholder='Add your own, e.g. "animal death"' />
      </div>

      <div style={{ marginTop: "24px" }}>
        <RoughDayToggle partnerName={partnerName} roughDay={roughDay} setRoughDay={setRoughDay} />
      </div>
    </div>
  );
}

function MoodScreen({ moodVibes, setMoodVibes, moodText, setMoodText,
  personAName, personBName, comfortA, watchlistA, vibesA, comfortB, watchlistB, vibesB,
  roughDayA, roughDayB, toggle, discoverNew, setDiscoverNew }) {
  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px 0", fontFamily: "Georgia, serif" }}>
          What are we feeling tonight?
        </h2>
        <p style={{ fontSize: "14px", color: "#64748b", margin: 0, lineHeight: "1.5" }}>
          Pick the vibe for this session — this tilts the recommendations toward what you're in the mood for right now.
        </p>
      </div>

      <div style={{ marginTop: "20px" }}>
        <SectionLabel icon="🌙" label="Tonight's Vibe" sublabel="Select one or more moods or genres for tonight" />
        <div style={{ marginBottom: "8px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Moods & Tones</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {MOOD_TAGS.map(v => <Chip key={v} label={v} selected={moodVibes.includes(v)} color="amber" onClick={() => toggle(moodVibes, setMoodVibes, v)} />)}
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Genres</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {GENRE_TAGS.map(v => <Chip key={v} label={v} selected={moodVibes.includes(v)} color="amber" onClick={() => toggle(moodVibes, setMoodVibes, v)} />)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "24px" }}>
        <button onClick={() => setDiscoverNew(!discoverNew)}
          style={{
            width: "100%", padding: "16px 20px", borderRadius: "12px",
            background: discoverNew ? "#ecfdf5" : "#f8fafc",
            border: discoverNew ? "2px solid #059669" : "2px solid #e2e8f0",
            cursor: "pointer", textAlign: "left",
          }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: "22px", flexShrink: 0 }}>{discoverNew ? "🔭" : "🔍"}</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: discoverNew ? "#065f46" : "#374151" }}>
                  Show us something new
                </div>
                <div style={{ fontSize: "12px", color: discoverNew ? "#047857" : "#94a3b8", marginTop: "2px", lineHeight: "1.4" }}>
                  Skip movies we already know we like — prioritize discovery over comfort
                </div>
              </div>
            </div>
            <div style={{
              width: "44px", minWidth: "44px", height: "24px", borderRadius: "12px",
              background: discoverNew ? "#059669" : "#cbd5e1", position: "relative", flexShrink: 0,
            }}>
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%", background: "#fff",
                position: "absolute", top: "2px", left: discoverNew ? "22px" : "2px",
                transition: "left 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }} />
            </div>
          </div>
        </button>
      </div>

      <div style={{ marginTop: "24px" }}>
        <SectionLabel icon="💬" label="Anything else?" sublabel="Optional — describe the mood in your own words" />
        <textarea value={moodText} onChange={e => setMoodText(e.target.value)}
          placeholder="e.g. Long week, want something light..."
          style={{
            width: "100%", padding: "10px 14px", fontSize: "16px", lineHeight: "1.5",
            border: "2px solid #e2e8f0", borderRadius: "10px",
            background: "#fff", color: "#1e293b", outline: "none", resize: "none",
            height: "70px", boxSizing: "border-box",
          }} />
      </div>

      <div style={{ marginTop: "28px", padding: "16px", borderRadius: "12px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "700", marginBottom: "12px" }}>
          Profile Summary
        </div>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <div style={{ minWidth: "120px" }}>
            <div style={{ fontSize: "14px", color: "#1e293b", fontWeight: "600" }}>{personAName}</div>
            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{vibesA.join(", ") || "No vibes"}</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>{comfortA.length} comfort · {watchlistA.length} watchlist</div>
            {roughDayA && <div style={{ fontSize: "11px", color: "#b45309", marginTop: "4px", fontWeight: "600" }}>💛 Prioritizing {personBName}</div>}
          </div>
          <div style={{ width: "1px", background: "#e2e8f0" }} />
          <div style={{ minWidth: "120px" }}>
            <div style={{ fontSize: "14px", color: "#1e293b", fontWeight: "600" }}>{personBName}</div>
            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{vibesB.join(", ") || "No vibes"}</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>{comfortB.length} comfort · {watchlistB.length} watchlist</div>
            {roughDayB && <div style={{ fontSize: "11px", color: "#b45309", marginTop: "4px", fontWeight: "600" }}>💛 Prioritizing {personAName}</div>}
          </div>
          <div style={{ width: "1px", background: "#e2e8f0" }} />
          <div style={{ minWidth: "100px" }}>
            <div style={{ fontSize: "14px", color: "#1e293b", fontWeight: "600" }}>Tonight</div>
            <div style={{ fontSize: "12px", color: "#b45309", marginTop: "4px" }}>{moodVibes.join(", ") || "No mood set"}</div>
            {moodText && <div style={{ fontSize: "12px", color: "#94a3b8" }}>"{moodText}"</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingView({ personAName, personBName, loadingPhase }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ marginBottom: "32px" }}>
        <div style={{
          width: "80px", height: "80px", margin: "0 auto 24px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #eef2ff 0%, #faf5ff 50%, #fff1f2 100%)",
          border: "3px solid #ddd6fe",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "36px",
          animation: "pulse 2s ease-in-out infinite",
        }}>🎬</div>
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: 0.85; } }`}</style>
        <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", margin: "0 0 8px 0", fontFamily: "Georgia, serif" }}>
          Finding your match...
        </h2>
        <p style={{ fontSize: "14px", color: "#64748b", margin: 0 }}>
          Analyzing {personAName} and {personBName}'s profiles
        </p>
      </div>
      <div style={{ maxWidth: "320px", margin: "0 auto" }}>
        {LOADING_PHASES.map((phase, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "10px 0", opacity: i <= loadingPhase ? 1 : 0.25,
            transition: "opacity 0.5s ease",
          }}>
            <div style={{
              width: "24px", height: "24px", borderRadius: "50%",
              background: i < loadingPhase ? "#059669" : i === loadingPhase ? "#4f46e5" : "#e2e8f0",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", color: "#fff", fontWeight: "800",
              transition: "background 0.3s ease",
            }}>{i < loadingPhase ? "✓" : i === loadingPhase ? "..." : ""}</div>
            <span style={{
              fontSize: "13px", fontWeight: i === loadingPhase ? "600" : "400",
              color: i <= loadingPhase ? "#1e293b" : "#94a3b8", textAlign: "left",
            }}>{phase}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasteMap({ aiResults, personAName, personBName, roughDayA, roughDayB }) {
  if (!aiResults?.tasteMap) return null;
  const { personA: pA, personB: pB, overlap } = aiResults.tasteMap;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", padding: "18px", borderRadius: "14px", background: "#eef2ff", border: "1px solid #c7d2fe" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#4338ca", marginBottom: "10px" }}>{personAName}'s Taste</div>
          <div style={{ fontSize: "13px", color: "#475569", lineHeight: "1.6" }}>{pA.summary}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" }}>
            {(pA.primaryVibes || []).map(t => (
              <span key={t} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "999px", background: "#c7d2fe", color: "#3730a3", fontWeight: "600" }}>{t}</span>
            ))}
            {(pA.genreAffinities || []).map(t => (
              <span key={t} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "999px", background: "#ddd6fe", color: "#5b21b6", fontWeight: "600" }}>{t}</span>
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 280px", padding: "18px", borderRadius: "14px", background: "#fff1f2", border: "1px solid #fecdd3" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#be123c", marginBottom: "10px" }}>{personBName}'s Taste</div>
          <div style={{ fontSize: "13px", color: "#475569", lineHeight: "1.6" }}>{pB.summary}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" }}>
            {(pB.primaryVibes || []).map(t => (
              <span key={t} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "999px", background: "#fecdd3", color: "#9f1239", fontWeight: "600" }}>{t}</span>
            ))}
            {(pB.genreAffinities || []).map(t => (
              <span key={t} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "999px", background: "#fda4af", color: "#881337", fontWeight: "600" }}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{
        padding: "18px", borderRadius: "14px",
        background: "linear-gradient(135deg, #eef2ff 0%, #faf5ff 50%, #fff1f2 100%)",
        border: "1px solid #ddd6fe",
      }}>
        <div style={{ fontSize: "15px", fontWeight: "700", color: "#7c3aed", marginBottom: "10px" }}>🎯 The Overlap Zone</div>
        <div style={{ fontSize: "13px", color: "#475569", lineHeight: "1.6" }}>{overlap.summary}</div>
        {overlap.sharedVibes?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" }}>
            {overlap.sharedVibes.map(v => (
              <span key={v} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "999px", background: "#ddd6fe", color: "#5b21b6", fontWeight: "600" }}>✦ {v}</span>
            ))}
          </div>
        )}
        {overlap.tensionPoints?.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            {overlap.tensionPoints.map((tp, i) => (
              <div key={i} style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                <strong style={{ color: "#b45309" }}>Tension:</strong> {tp}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "14px", borderRadius: "10px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#4f46e5" }} />
            <span style={{ fontSize: "11px", color: "#64748b" }}>{personAName}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#e11d48" }} />
            <span style={{ fontSize: "11px", color: "#64748b" }}>{personBName}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#7c3aed" }} />
            <span style={{ fontSize: "11px", color: "#64748b" }}>Overlap</span>
          </div>
          {(roughDayA || roughDayB) && (
            <span style={{ fontSize: "11px", color: "#b45309", fontWeight: "600", marginLeft: "auto" }}>
              💛 {roughDayA && !roughDayB ? `weighted toward ${personBName}` : !roughDayA && roughDayB ? `weighted toward ${personAName}` : "mutual care — equal weight"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RankedList({ aiResults, recRatings, setRecRatings }) {
  if (!aiResults?.recommendations) return null;

  const getStatus = (title) => recRatings[title] || "neutral";
  const setStatus = (title, status) => {
    setRecRatings(prev => {
      const next = { ...prev };
      if (next[title] === status) { delete next[title]; return next; }
      next[title] = status;
      return next;
    });
  };

  const IconBtn = ({ active, activeColor, activeBg, icon, onClick, label }) => (
    <button onClick={onClick} title={label}
      style={{
        width: "36px", height: "36px", borderRadius: "50%", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px",
        background: active ? activeBg : "#f1f5f9",
        transition: "all 0.15s ease",
      }}>{icon}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "2px", lineHeight: "1.4" }}>
        Rate recommendations to refine your next round — keep the ones you like, remove the ones you don't.
      </div>
      {aiResults.recommendations.map((r, i) => {
        const status = getStatus(r.title);
        const isKept = status === "kept";
        const isRemoved = status === "removed";
        return (
          <div key={i} style={{
            padding: "16px", borderRadius: "12px",
            background: isKept ? "#ecfdf5" : isRemoved ? "#fafafa" : "#fff",
            border: isKept ? "2px solid #a7f3d0" : isRemoved ? "2px solid #e5e5e5" : "1px solid #e2e8f0",
            opacity: isRemoved ? 0.5 : 1,
            transition: "all 0.2s ease",
          }}>
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: "28px", fontWeight: "900", fontFamily: "Georgia, serif", minWidth: "30px",
                  color: isKept ? "#a7f3d0" : isRemoved ? "#e5e5e5" : "#e2e8f0",
                }}>
                  {i + 1}
                </span>
                <span style={{
                  fontSize: "14px", fontWeight: "700",
                  color: isRemoved ? "#94a3b8" : "#0f172a",
                  textDecoration: isRemoved ? "line-through" : "none",
                }}>{r.title}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <IconBtn
                  active={isKept} icon="♥" label="Keep this recommendation"
                  activeBg="#dcfce7" activeColor="#059669"
                  onClick={() => setStatus(r.title, "kept")}
                />
                <IconBtn
                  active={isRemoved} icon="✕" label="Remove this recommendation"
                  activeBg="#fee2e2" activeColor="#dc2626"
                  onClick={() => setStatus(r.title, "removed")}
                />
                <div style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  background: r.matchScore >= 90 ? "#ecfdf5" : r.matchScore >= 80 ? "#eff6ff" : "#f8fafc",
                  padding: "4px 12px", borderRadius: "999px",
                }}>
                  <span style={{ fontSize: "13px", fontWeight: "800", color: r.matchScore >= 90 ? "#059669" : r.matchScore >= 80 ? "#2563eb" : "#64748b" }}>
                    {r.matchScore}
                  </span>
                  <span style={{ fontSize: "10px", color: r.matchScore >= 90 ? "#059669" : r.matchScore >= 80 ? "#2563eb" : "#64748b" }}>match</span>
                </div>
              </div>
            </div>
            {!isRemoved && (
              <p style={{ fontSize: "13px", color: "#64748b", marginTop: "8px", marginLeft: "42px", lineHeight: "1.5" }}>
                {r.explanation}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConversationalView({ aiResults }) {
  if (!aiResults?.conversational) return null;
  const paragraphs = aiResults.conversational.split("\n").filter(p => p.trim());
  return (
    <div style={{ padding: "20px", borderRadius: "12px", background: "#fff", border: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <div style={{
          width: "36px", height: "36px", borderRadius: "50%",
          background: "linear-gradient(135deg, #f59e0b, #ea580c)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px",
        }}>🎬</div>
        <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>Movie Matchmaker</div>
      </div>
      <div style={{ fontSize: "14px", color: "#475569", lineHeight: "1.7" }}>
        {paragraphs.map((p, i) => (
          <p key={i} style={{ margin: i < paragraphs.length - 1 ? "0 0 12px 0" : 0 }}
            dangerouslySetInnerHTML={{
              __html: p.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0f172a">$1</strong>')
            }} />
        ))}
      </div>
    </div>
  );
}

function ProgressBar({ screens, screen, setScreen }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "28px", flexWrap: "wrap" }}>
      {screens.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => { if (i < screen) setScreen(i); }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "6px 14px", borderRadius: "999px", fontSize: "12px", fontWeight: "600",
              background: i === screen ? "#eef2ff" : i < screen ? "#ecfdf5" : "#f8fafc",
              color: i === screen ? "#4338ca" : i < screen ? "#047857" : "#94a3b8",
              border: i === screen ? "1px solid #c7d2fe" : i < screen ? "1px solid #a7f3d0" : "1px solid #e2e8f0",
              cursor: i < screen ? "pointer" : "default",
            }}>
            <span style={{
              width: "22px", height: "22px", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", fontWeight: "800",
              background: i < screen ? "#059669" : i === screen ? "#4f46e5" : "#e2e8f0",
              color: i <= screen ? "#fff" : "#94a3b8",
            }}>{i < screen ? "✓" : i + 1}</span>
            {s}
          </button>
          {i < screens.length - 1 && <div style={{ width: "20px", height: "2px", background: i < screen ? "#a7f3d0" : "#e2e8f0" }} />}
        </div>
      ))}
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────

// Quick-pick bubbles shown on each profile (popular/recognizable films)
const COMFORT_PICKS_A = [
  "The Grand Budapest Hotel","Inception","Spirited Away","The Shawshank Redemption",
  "The Princess Bride","Forrest Gump","Amélie","The Dark Knight","Pulp Fiction",
  "Good Will Hunting","WALL-E","The Prestige",
];
const WATCHLIST_PICKS_A = [
  "Dune: Part Two","Past Lives","Everything Everywhere All at Once","Oppenheimer",
  "Barbie","Top Gun: Maverick","The Departed","Moonlight",
];
const COMFORT_PICKS_B = [
  "The Princess Bride","Knives Out","La La Land","Pride and Prejudice",
  "When Harry Met Sally","Crazy Rich Asians","Notting Hill","About Time",
  "Coco","Finding Nemo","Ratatouille","Moonrise Kingdom",
];
const WATCHLIST_PICKS_B = [
  "Oppenheimer","Barbie","Past Lives","Everything Everywhere All at Once",
  "Portrait of a Lady on Fire","Soul","Jojo Rabbit","A Quiet Place",
];

export default function MovieMatchApp() {
  const [screen, setScreen] = useState(0);
  const [personAName, setPersonAName] = useState("Bob");
  const [personBName, setPersonBName] = useState("Alice");
  const [comfortA, setComfortA] = useState(["The Grand Budapest Hotel", "Inception", "Spirited Away"]);
  const [watchlistA, setWatchlistA] = useState(["Dune: Part Two", "Past Lives"]);
  const [vibesA, setVibesA] = useState(["Cerebral", "Thrilling"]);
  const [dealbreakersA, setDealbreakersA] = useState(["Horror"]);
  const [comfortB, setComfortB] = useState(["The Princess Bride", "Knives Out", "La La Land"]);
  const [watchlistB, setWatchlistB] = useState(["Oppenheimer", "Barbie"]);
  const [vibesB, setVibesB] = useState(["Cozy", "Funny", "Romantic"]);
  const [dealbreakersB, setDealbreakersB] = useState(["War", "Documentary"]);
  const [roughDayA, setRoughDayA] = useState(false);
  const [roughDayB, setRoughDayB] = useState(false);
  const [moodVibes, setMoodVibes] = useState([]);
  const [moodText, setMoodText] = useState("");
  const [discoverNew, setDiscoverNew] = useState(false);
  const [resultsTab, setResultsTab] = useState("map");
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [aiResults, setAiResults] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [pastTitles, setPastTitles] = useState([]);
  const [recRatings, setRecRatings] = useState({});

  const screens = [personAName, personBName, "Mood", "Results"];

  const toggle = (arr, setArr, item) => {
    setArr(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
  };

  const runMatching = async (steeringFeedback = "") => {
    setLoading(true);
    setError(null);
    setLoadingPhase(0);

    const phaseInterval = setInterval(() => {
      setLoadingPhase(p => p < LOADING_PHASES.length - 1 ? p + 1 : p);
    }, 2200);

    const weightNote = roughDayA && !roughDayB
      ? `${personAName} has indicated ${personBName} had a rough day. Weight ${personBName}'s preferences more heavily (roughly 65/35 split in their favor).`
      : !roughDayA && roughDayB
      ? `${personBName} has indicated ${personAName} had a rough day. Weight ${personAName}'s preferences more heavily (roughly 65/35 split in their favor).`
      : roughDayA && roughDayB
      ? `Both people indicated their partner had a rough day — treat preferences equally.`
      : `No preference weighting — treat both profiles equally.`;

    const discoveryNote = discoverNew
      ? `DISCOVERY MODE: The couple wants to find something new. Do NOT recommend any movie that appears in either person's comfort movies or watchlist. Use those lists only to understand their taste, then recommend movies they likely haven't seen.`
      : `You may recommend movies from their comfort or watchlist if they're a great match, but also include discoveries they may not have considered.`;

    const keptTitles = Object.entries(recRatings).filter(([_, v]) => v === "kept").map(([k]) => k);
    const removedTitles = [...pastTitles, ...Object.entries(recRatings).filter(([_, v]) => v === "removed").map(([k]) => k)];

    const ratingsNote = keptTitles.length > 0 || removedTitles.length > 0
      ? `\nREFINEMENT ROUND:${keptTitles.length > 0 ? `\n- KEEP these movies in your recommendations (the couple liked them): ${keptTitles.join(", ")}` : ""}${removedTitles.length > 0 ? `\n- Do NOT recommend any of these movies (already rejected): ${[...new Set(removedTitles)].join(", ")}` : ""}\n- Fill remaining slots with fresh suggestions that weren't in the previous round.`
      : "";

    const steeringNote = steeringFeedback
      ? `\nThe couple provided this feedback on the previous recommendations: "${steeringFeedback}". Adjust your new recommendations accordingly.`
      : "";

    const systemPrompt = `You are a movie recommendation engine for couples. You will be given two taste profiles and a session mood. Your job is to analyze both profiles, find the overlap, and recommend movies.

CRITICAL RULES:
- You may ONLY recommend movies from this list: ${JSON.stringify(MOVIES)}
- NEVER invent or hallucinate movie titles
- Return ONLY valid JSON with no markdown, no backticks, no preamble
- ${discoveryNote}${ratingsNote}${steeringNote}

Return this exact JSON structure:
{
  "tasteMap": {
    "personA": { "summary": "2-3 sentence taste analysis", "primaryVibes": ["vibe1","vibe2","vibe3"], "genreAffinities": ["genre1","genre2"] },
    "personB": { "summary": "2-3 sentence taste analysis", "primaryVibes": ["vibe1","vibe2","vibe3"], "genreAffinities": ["genre1","genre2"] },
    "overlap": { "summary": "2-3 sentences about where tastes converge", "sharedVibes": ["vibe1","vibe2"], "tensionPoints": ["1 sentence about key taste conflict"] }
  },
  "recommendations": [
    { "title": "Movie Title", "matchScore": 92, "explanation": "2-3 sentences explaining why this works for both people, referencing their specific preferences and tonight's mood." }
  ],
  "conversational": "A 3-4 paragraph narrative recommendation. Be warm and clear but not performatively familiar. Explain reasoning like a thoughtful reviewer, not a friend. Reference both people by name. Bold movie titles with **Title**."
}

Recommend 5-7 movies, sorted by matchScore descending.`;

    const userMessage = `Person A: ${personAName}
- Comfort movies: ${comfortA.length ? comfortA.join(", ") : "None selected"}
- Watchlist: ${watchlistA.length ? watchlistA.join(", ") : "None selected"}
- Vibes: ${vibesA.length ? vibesA.join(", ") : "None selected"}
- Dealbreakers: ${dealbreakersA.length ? dealbreakersA.join(", ") : "None"}

Person B: ${personBName}
- Comfort movies: ${comfortB.length ? comfortB.join(", ") : "None selected"}
- Watchlist: ${watchlistB.length ? watchlistB.join(", ") : "None selected"}
- Vibes: ${vibesB.length ? vibesB.join(", ") : "None selected"}
- Dealbreakers: ${dealbreakersB.length ? dealbreakersB.join(", ") : "None"}

Tonight's mood: ${moodVibes.length ? moodVibes.join(", ") : "No specific mood"}
${moodText ? `Additional context: "${moodText}"` : ""}

${weightNote}

Analyze both profiles and recommend movies.`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      // Track removed titles so they stay excluded in future rounds
      const newRemoved = Object.entries(recRatings).filter(([_, v]) => v === "removed").map(([k]) => k);
      if (newRemoved.length > 0) {
        setPastTitles(prev => [...new Set([...prev, ...newRemoved])]);
      }
      setAiResults(parsed);
      setFeedback("");
      setRecRatings({});
    } catch (err) {
      console.error("AI matching error:", err);
      setError("Something went wrong with the matching. Try again?");
    } finally {
      clearInterval(phaseInterval);
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (screen === 2) {
      setScreen(3);
      runMatching();
    } else {
      setScreen(s => s + 1);
    }
  };

  // ── Results Screen ────────────────────────────────────────────────────
  const renderResults = () => {
    if (loading) return <LoadingView personAName={personAName} personBName={personBName} loadingPhase={loadingPhase} />;
    if (error) return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>😕</div>
        <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px 0" }}>{error}</h2>
        <button onClick={runMatching} style={{
          marginTop: "16px", padding: "10px 24px", borderRadius: "10px", fontSize: "14px",
          fontWeight: "600", background: "#4f46e5", color: "#fff", border: "none", cursor: "pointer",
        }}>Try Again</button>
      </div>
    );
    if (!aiResults) return <LoadingView personAName={personAName} personBName={personBName} loadingPhase={loadingPhase} />;

    return (
      <div>
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px 0", fontFamily: "Georgia, serif" }}>
            Your Movie Match
          </h2>
          <p style={{ fontSize: "14px", color: "#64748b", margin: 0 }}>
            We analyzed both profiles{moodVibes.length ? ` against tonight's ${moodVibes.join(" & ").toLowerCase()} mood` : ""}. Toggle between views below.
          </p>
        </div>

        <div style={{ display: "flex", gap: "4px", padding: "4px", background: "#f1f5f9", borderRadius: "10px", marginBottom: "20px" }}>
          {[
            { key: "map", label: "🗺️ Taste Map" },
            { key: "ranked", label: "📊 Ranked List" },
            { key: "chat", label: "💬 Conversational" },
          ].map(tab => (
            <button key={tab.key} onClick={() => setResultsTab(tab.key)}
              style={{
                flex: 1, padding: "10px", borderRadius: "8px", fontSize: "13px",
                fontWeight: "600", cursor: "pointer",
                background: resultsTab === tab.key ? "#fff" : "transparent",
                color: resultsTab === tab.key ? "#0f172a" : "#94a3b8",
                border: resultsTab === tab.key ? "1px solid #e2e8f0" : "1px solid transparent",
                boxShadow: resultsTab === tab.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>{tab.label}</button>
          ))}
        </div>

        {resultsTab === "map" && <TasteMap aiResults={aiResults} personAName={personAName} personBName={personBName} roughDayA={roughDayA} roughDayB={roughDayB} />}
        {resultsTab === "ranked" && <RankedList aiResults={aiResults} recRatings={recRatings} setRecRatings={setRecRatings} />}
        {resultsTab === "chat" && <ConversationalView aiResults={aiResults} />}

        {/* Regenerate section */}
        {(() => {
          const keptCount = Object.values(recRatings).filter(v => v === "kept").length;
          const removedCount = Object.values(recRatings).filter(v => v === "removed").length;
          const hasRatings = keptCount > 0 || removedCount > 0;
          return (
            <div style={{
              marginTop: "28px", padding: "20px", borderRadius: "14px",
              background: "#f8fafc", border: "1px solid #e2e8f0",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "20px" }}>🔄</span>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#1e293b" }}>Refine your picks</div>
              </div>
              <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "12px", lineHeight: "1.4" }}>
                {hasRatings
                  ? "Use the ♥ and ✕ buttons on the Ranked List tab to keep or remove individual picks, then regenerate to fill in the gaps."
                  : "Rate individual movies on the Ranked List tab, or just add a note below and regenerate."}
              </div>
              {hasRatings && (
                <div style={{ display: "flex", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                  {keptCount > 0 && (
                    <div style={{ fontSize: "12px", color: "#059669", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span>♥</span> {keptCount} kept
                    </div>
                  )}
                  {removedCount > 0 && (
                    <div style={{ fontSize: "12px", color: "#dc2626", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span>✕</span> {removedCount} removed
                    </div>
                  )}
                  {pastTitles.length > 0 && (
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      + {pastTitles.length} from previous rounds
                    </div>
                  )}
                </div>
              )}
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder='Optional: "Something more lighthearted" or "More animated films" or "We want a longer movie"'
                style={{
                  width: "100%", padding: "10px 14px", fontSize: "16px", lineHeight: "1.5",
                  border: "2px solid #e2e8f0", borderRadius: "10px",
                  background: "#fff", color: "#1e293b", outline: "none", resize: "none",
                  height: "60px", boxSizing: "border-box", marginBottom: "12px",
                }}
              />
              <button
                onClick={() => runMatching(feedback)}
                style={{
                  padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600",
                  background: "#4f46e5", color: "#fff", border: "none", cursor: "pointer",
                  width: "100%",
                }}
              >
                {hasRatings && feedback ? "Regenerate with ratings + feedback →"
                  : hasRatings ? "Regenerate with ratings →"
                  : feedback ? "Regenerate with feedback →"
                  : "Show me different options →"}
              </button>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#ffffff", color: "#0f172a",
      padding: "24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ maxWidth: "680px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
          <div style={{ fontSize: "32px" }}>🎬</div>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: "800", margin: 0, fontFamily: "Georgia, serif", color: "#0f172a" }}>Movie Match</h1>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0 0", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: "600" }}>
              Find your couple's perfect movie
            </p>
          </div>
        </div>

        <ProgressBar screens={screens} screen={screen} setScreen={setScreen} />

        {screen === 0 && (
          <ProfileScreen
            name={personAName} setName={setPersonAName}
            comfort={comfortA} setComfort={setComfortA}
            watchlist={watchlistA} setWatchlist={setWatchlistA}
            vibes={vibesA} setVibes={setVibesA}
            dealbreakers={dealbreakersA} setDealbreakers={setDealbreakersA}
            personLabel="Person A" partnerName={personBName}
            roughDay={roughDayA} setRoughDay={setRoughDayA}
            toggle={toggle}
            comfortQuickPicks={COMFORT_PICKS_A}
            watchlistQuickPicks={WATCHLIST_PICKS_A}
          />
        )}
        {screen === 1 && (
          <ProfileScreen
            name={personBName} setName={setPersonBName}
            comfort={comfortB} setComfort={setComfortB}
            watchlist={watchlistB} setWatchlist={setWatchlistB}
            vibes={vibesB} setVibes={setVibesB}
            dealbreakers={dealbreakersB} setDealbreakers={setDealbreakersB}
            personLabel="Person B" partnerName={personAName}
            roughDay={roughDayB} setRoughDay={setRoughDayB}
            toggle={toggle}
            comfortQuickPicks={COMFORT_PICKS_B}
            watchlistQuickPicks={WATCHLIST_PICKS_B}
          />
        )}
        {screen === 2 && (
          <MoodScreen
            moodVibes={moodVibes} setMoodVibes={setMoodVibes}
            moodText={moodText} setMoodText={setMoodText}
            personAName={personAName} personBName={personBName}
            comfortA={comfortA} watchlistA={watchlistA} vibesA={vibesA}
            comfortB={comfortB} watchlistB={watchlistB} vibesB={vibesB}
            roughDayA={roughDayA} roughDayB={roughDayB}
            toggle={toggle}
            discoverNew={discoverNew} setDiscoverNew={setDiscoverNew}
          />
        )}
        {screen === 3 && renderResults()}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "32px" }}>
          {screen > 0 && !loading ? (
            <button onClick={() => setScreen(s => s - 1)}
              style={{
                padding: "10px 20px", borderRadius: "10px", fontSize: "14px",
                background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", cursor: "pointer", fontWeight: "500",
              }}>← Back</button>
          ) : <div />}
          {screen < 3 ? (
            <button onClick={handleContinue}
              style={{
                padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600",
                background: "#4f46e5", color: "#fff", border: "none", cursor: "pointer",
              }}>{screen === 2 ? "Find Our Match →" : "Continue →"}</button>
          ) : !loading && aiResults ? (
            <button onClick={() => { setScreen(0); setAiResults(null); setPastTitles([]); setFeedback(""); setRecRatings({}); }}
              style={{
                padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600",
                background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", cursor: "pointer",
              }}>Start Over</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
