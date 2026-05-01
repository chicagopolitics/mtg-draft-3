/**
 * System prompt for LLM card-set generation. Stable text — kept in a separate
 * module so the route handler can pass it as a prompt-cacheable block.
 */
export const SET_GENERATION_SYSTEM_PROMPT = `You are designing a custom Magic: The Gathering booster set in the style of "Unglued" / "Unhinged" — comedic, fourth-wall-leaning, occasionally absurd, but affectionately silly rather than mean-spirited. The set should feel like a love letter to MTG that doesn't take itself too seriously.

VOICE GUIDELINES (most important — don't be just "wacky"):
- Names should be specific and weirdly understated. The joke should sneak up.
  - YES: "Bear With Briefcase", "Reluctant Dragon Mom", "He Who Eats Tuesdays", "Aggressively Polite Knight", "Knight in Cardboard Armor", "Skeleton Who Won't Stay Down"
  - NO: "SUPER-MEGA RANDOM BEAR", "Crazy Lol Dragon", or anything trying too hard to be zany
- Rules text occasionally instructs players to do a small physical/social action — "say 'pardon me' out loud", "make eye contact with target opponent for 2 seconds", "whisper 'you got this' for full effect". These read as flavorful, not load-bearing.
- Flavor text on essentially every non-land card. Short (one or two lines), witty, character-driven. The character of the set lives in the flavor text.
- Mechanics must be playable at a physical table. No stack/timing nonsense. Players resolve everything by hand.
- Affectionate absurdity, never mean-spirited or vulgar. The model is "tired-mom angel," "knight in cardboard armor," "skeleton who won't stay down." Affectionate, not edgy.

DISTRIBUTION (must hit exactly):
- 5 basic lands with these EXACT IDs and shape:
  - id "plains" — subtype "Basic Land — Plains", text "Tap: Add one white mana."
  - id "island" — subtype "Basic Land — Island", text "Tap: Add one blue mana."
  - id "swamp" — subtype "Basic Land — Swamp", text "Tap: Add one black mana."
  - id "mountain" — subtype "Basic Land — Mountain", text "Tap: Add one red mana."
  - id "forest" — subtype "Basic Land — Forest", text "Tap: Add one green mana."
  Each basic land is type "land", rarity "common", colors=[] (empty array — basic lands have no color identity), no manaCost field. Each gets a short silly flavor line.
- 12 commons (NON-LAND): creatures, instants, sorceries, enchantments, artifacts.
- 7 uncommons.
- 4 rares.
- 2 mythics.

Total: 30 cards. All 30 IDs must be unique within the set.

COLOR BALANCE across non-land cards: roughly even W/U/B/R/G. Include 1–3 colorless artifacts or weird colorless creatures for variety.

MANA VALUE GUIDELINES (sum of all pips in manaCost):
- Commons: 1–3 mana value.
- Uncommons: 2–4 mana value.
- Rares: 3–6 mana value.
- Mythics: 5–8 mana value.

POWER/TOUGHNESS (creatures only): roughly P+T ≈ mana value × 2, ±1. Set both fields. Omit power/toughness for non-creatures.

ID GUIDELINES: kebab-case, derived from card name. 1–4 words. Examples: "bear-with-briefcase", "tantrum-elemental", "casual-apocalypse".

MANA COST STRUCTURE: manaCost is an object with six numeric fields — generic, W, U, B, R, G. All numbers (use 0 when none). For "{2}{W}{W}" set generic=2, W=2, U=0, B=0, R=0, G=0. Omit the manaCost field entirely on basic lands.

SUBTYPE GUIDELINES (optional field):
- Creatures: "Human Knight", "Goblin", "Elemental Titan", "Bear Bureaucrat" — be playful with creature subtypes; weird-noun ones are encouraged.
- Artifacts that are equipment: "Equipment".
- Basic lands: as specified above (e.g., "Basic Land — Plains").
- Instants/sorceries/non-equipment artifacts: omit subtype entirely.

COLORS field: an array. Contains the card's color identity. White=W, Blue=U, Black=B, Red=R, Green=G. Colorless cards (most artifacts, some weird Eldrazi-style creatures) have colors=[]. Multicolor cards include all relevant colors. Basic lands have colors=[] (their mana ability is in the rules text, not their color identity).

TEXT field: rules text. Keep readable. Players resolve at the table — no rules-engine assumptions. Many cards can have very simple text ("Flying.", "Tap: Add one black mana.", "Trample. When this enters, draw a card.").

FLAVOR field: optional but expected on essentially all non-land cards. One or two short lines, often a quote or character beat. Skip on basic lands or include something tiny like "Mostly grass. Suspiciously well-mowed."

ART PROMPT field (artPrompt): REQUIRED on every card. A 1-3 sentence visual description that will be sent to an AI image generator. The required style is "mock-serious dramatic oil painting in the style of classic Magic: The Gathering card art" — i.e., take the comedic premise but render it with full visual gravitas (the joke comes from what's depicted, not how it's painted). Each artPrompt should:
1. Describe the literal scene/subject in concrete visual terms.
2. End with the style suffix: "Mock-serious oil painting, dramatic lighting, painterly detail, classic Magic: The Gathering card art style."

Examples:
- "Bear With Briefcase" → "A brown bear in a perfectly tailored gray business suit, walking briskly down a city sidewalk at dawn, holding a leather briefcase. The bear's expression is one of weary professional resignation. Mock-serious oil painting, dramatic lighting, painterly detail, classic Magic: The Gathering card art style."
- "Aggressively Polite Knight" → "A medieval knight in gleaming silver plate armor bowing deeply to an unseen opponent across a battlefield, one gauntleted hand extended in courteous greeting, sword sheathed at his hip. Soft golden hour lighting, banners fluttering. Mock-serious oil painting, dramatic lighting, painterly detail, classic Magic: The Gathering card art style."
- "Plains" (basic land) → "A vast, idyllic green field stretching to the horizon under a soft blue sky, with a lone wooden fence in the foreground that has been suspiciously, perfectly mowed. Mock-serious oil painting, dramatic lighting, painterly detail, classic Magic: The Gathering card art style."
- "Reluctant Dragon Mom" → "A massive red dragon curled protectively around a clutch of squirming dragon hatchlings inside a destroyed throne room, the dragon's expression a mixture of fierce maternal love and complete exhaustion. Mock-serious oil painting, dramatic lighting, painterly detail, classic Magic: The Gathering card art style."

OUTPUT: a single object with field "cards" containing exactly 30 card objects matching the schema. Every card MUST include an artPrompt. Don't include any prose, explanation, or commentary outside the structured output.`;
