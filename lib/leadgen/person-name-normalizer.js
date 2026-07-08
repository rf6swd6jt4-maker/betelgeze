const COMMON_GIVEN_NAMES = new Set([
    "aaron", "adam", "adrian", "alan", "albert", "alex", "alexander", "alfredo", "alice", "alicia", "allen", "alyssa", "amanda",
    "amy", "ana", "andrea", "andrew", "angel", "angela", "anthony", "antonio", "april", "arthur", "ashley", "barbara", "ben",
    "benjamin", "beth", "billy", "bob", "brad", "bradley", "brandon", "brenda", "brian", "bruce", "bryan", "carlos", "carol",
    "carolina", "carrie", "catherine", "charles", "chris", "christian", "christina", "christopher", "cindy", "clarence", "cody",
    "corey", "craig", "crystal", "dan", "daniel", "danielle", "danny", "david", "deborah", "denise", "dennis", "derek", "diana",
    "diane", "diego", "donald", "donna", "douglas", "ed", "eddie", "edgar", "eduardo", "edward", "elizabeth", "emily", "eric",
    "erica", "ernest", "fernando", "frank", "gabriel", "gary", "george", "gina", "gino", "glenn", "greg", "gregory", "heather",
    "hector", "henry", "isaac", "ivan", "jack", "jacob", "jaime", "james", "jason", "jeff", "jeffrey", "jennifer", "jeremy",
    "jesse", "jessica", "jim", "jimmy", "jo", "joe", "joel", "john", "johnny", "jon", "jonathan", "jose", "joseph", "josh",
    "joshua", "juan", "judy", "julie", "justin", "karen", "katherine", "kathy", "keith", "kelly", "kenneth", "kevin", "kim",
    "kimberly", "kristen", "kyle", "larry", "laura", "lauren", "lee", "linda", "lisa", "luis", "manuel", "marc", "marco",
    "marcus", "maria", "marie", "mario", "mark", "martha", "martin", "mary", "matt", "matthew", "melissa", "michael",
    "michelle", "miguel", "mike", "miriam", "nathan", "nora", "oscar", "patricia", "patti",
    "paul", "pedro", "peter", "philip", "priya", "rachel", "rafael", "ramon", "raul", "ray", "raymond", "rebecca", "ricardo",
    "richard", "rick", "robert", "roberto", "ron", "ronald", "rosa", "ruben", "russell", "ryan", "sam", "samantha", "sandra",
    "sarah", "scott", "sean", "sergio", "shawn", "sofia", "stephen", "steve", "steven", "susan", "taylor", "terry", "theresa",
    "thomas", "tim", "timothy", "todd", "tom", "tommy", "tony", "travis", "victor", "vincent", "walter", "wayne", "william",
    "zachary",
])

const ROLE_WORDS = new Set([
    "agent", "applicant", "ceo", "chief", "co-founder", "contact", "founder", "holder", "individual", "license", "manager",
    "member", "official", "operator", "owner", "partner", "president", "principal", "qualifier", "qualifying", "registered",
    "responsible", "secretary", "statutory", "treasurer", "vice",
])

const HEADING_WORDS = new Set([
    "about", "account", "accounts", "asked", "blog", "careers", "client", "contact", "copyright", "customer", "customers",
    "dashboard", "faq", "faqs", "featured", "financing", "frequently", "gallery", "help", "home", "latest", "learn",
    "log", "login", "locations", "news", "portal", "portfolio", "privacy", "project", "projects", "questions", "quote",
    "reviews", "schedule", "signin", "signup", "support", "services", "testimonials", "terms",
])

const BUSINESS_WORDS = new Set([
    "air", "alpha", "auto", "automotive", "builders", "building", "build", "co", "coatings", "company", "concrete", "construction",
    "contracting", "contractor", "contractors", "corp", "corporation", "deck", "decks", "design", "disposal", "door", "doors",
    "drywall", "electric", "electrical", "enterprises", "excavating", "fencing", "flooring", "garage", "garages", "group",
    "gutters", "handyman", "heating", "holdings", "homes", "hvac", "improvement", "improvements", "inc", "incorporated",
    "installation", "installations", "landscaping", "llc", "ltd", "modular", "outdoor", "painting", "patio", "pest",
    "plumbing", "remodeling", "remodelling", "renovation", "renovations", "repair", "restoration", "roofing", "service",
    "services", "siding", "solution", "solutions", "systems", "waste", "window", "windows",
])

const LOWERCASE_NAME_PARTICLES = new Set(["da", "de", "del", "der", "di", "du", "la", "le", "van", "von"])
const SUFFIX_WORDS = new Set(["jr", "sr", "ii", "iii", "iv", "v"])
const HONORIFIC_WORDS = new Set(["dr", "mr", "mrs", "ms", "miss", "prof", "sir"])
const BUSINESS_ENTITY_SUFFIXES = new Set(["co", "corp", "corporation", "company", "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "pc", "pllc"])

function cleanText(value) {
    return (value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim()
}

function titleCaseAllCaps(value) {
    if (!/^[A-Z .'-]+$/.test(value) || /[a-z]/.test(value)) return value
    return value.toLowerCase().replace(/\b([a-z])([a-z.'-]*)/g, (_match, first, rest) => `${first.toUpperCase()}${rest}`)
}

function stripRoleAndNoise(value) {
    let clean = cleanText(value)
    clean = clean
        .replace(/^c\/o\s+/i, "")
        .replace(/^attn\.?\s+/i, "")
        .replace(/\b(?:meet|about)\s+(?:the\s+)?(?:owner|founder|team|staff|crew|people)?\s*:?\s*/gi, "")
        .replace(/\b(?:owner|founder|co-founder|principal|president|ceo|manager|member|operator|license holder|qualifier|qualifying individual|registered agent|agent)\s*[:|-]\s*/gi, "")
        .replace(/\s*[,;:/|–-]\s*(?:owner|founder|co-founder|principal|president|ceo|manager|member|operator|license holder|qualifier|qualifying individual|registered agent|agent)\.?$/i, "")
        .replace(/\s*\((?:owner|founder|co-founder|principal|president|ceo|manager|member|operator|license holder|qualifier|qualifying individual|registered agent|agent)\)\s*$/i, "")
    const comma = clean.match(/^([A-Za-z][A-Za-z.' -]{1,45}),\s*([A-Za-z][A-Za-z.' -]{1,45})$/)
    if (comma) clean = `${comma[2]} ${comma[1]}`
    return titleCaseAllCaps(clean.replace(/\s+/g, " ").trim())
}

function wordKey(value) {
    return value.toLowerCase().replace(/[^a-z]/g, "")
}

function nameTokens(value) {
    return [...value.matchAll(/[A-Za-z][A-Za-z.'-]*/g)].map((match) => match[0])
}

function contextNameKeys(value) {
    return nameTokens(value)
        .map(wordKey)
        .filter((key) => key && !BUSINESS_ENTITY_SUFFIXES.has(key))
}

function tokenLooksNameish(token, options) {
    const key = wordKey(token)
    if (!key) return false
    if (HONORIFIC_WORDS.has(key)) return false
    if (SUFFIX_WORDS.has(key)) return true
    if (LOWERCASE_NAME_PARTICLES.has(key)) return true
    if (ROLE_WORDS.has(key) || HEADING_WORDS.has(key) || BUSINESS_WORDS.has(key)) return false
    if (/^[A-Z]\.?$/.test(token)) return true
    if (/^[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)*$/.test(token)) return true
    if (options.allowAllCaps && /^[A-Z]{2,}$/.test(token)) return true
    return false
}

function hasBadWords(tokens) {
    return tokens.some((token) => {
        const key = wordKey(token)
        return ROLE_WORDS.has(key) || HEADING_WORDS.has(key) || BUSINESS_WORDS.has(key)
    })
}

function hasDuplicateAdjacent(tokens) {
    return tokens.some((token, index) => index > 0 && wordKey(token) === wordKey(tokens[index - 1]))
}

function matchesBusinessContext(tokens, options) {
    const candidateKeys = tokens
        .map(wordKey)
        .filter((key) => key && !SUFFIX_WORDS.has(key))
    if (candidateKeys.length < 2) return false
    const contextNames = Array.isArray(options.contextNames) ? options.contextNames : []
    for (const contextName of contextNames) {
        if (typeof contextName !== "string" || !contextName.trim()) continue
        const contextKeys = contextNameKeys(contextName)
        if (contextKeys.length < 2) continue
        const contextSet = new Set(contextKeys)
        if (candidateKeys.every((key) => contextSet.has(key))) return true
    }
    return false
}

function candidateScore(tokens, sourceText, options) {
    if (tokens.length < 2 || tokens.length > 4) return -100
    if (hasDuplicateAdjacent(tokens)) return -100
    if (!tokens.every((token) => tokenLooksNameish(token, options))) return -100
    if (hasBadWords(tokens)) return -100
    if (matchesBusinessContext(tokens, options)) return -100
    const keys = tokens.map(wordKey).filter(Boolean)
    const first = keys[0]
    const substantiveKeys = keys.filter((key) => !SUFFIX_WORDS.has(key) && !LOWERCASE_NAME_PARTICLES.has(key))
    const nonSuffixCount = keys.filter((key) => !SUFFIX_WORDS.has(key)).length
    if (nonSuffixCount < 2) return -100
    if (substantiveKeys.length < 2) return -100
    let score = 42
    if (first && COMMON_GIVEN_NAMES.has(first)) score += 26
    else score -= options.ownerContext ? 4 : 18
    if (tokens.length === 2) score += 12
    if (tokens.length === 3) score += 7
    if (tokens.some((token) => /^[A-Z]\.?$/.test(token))) score += 3
    if (options.ownerContext) score += 8
    if (/\b(owner|founder|principal|president|ceo|managed by|owned by|founded by|led by|operator)\b/i.test(sourceText)) score += 8
    if (tokens.every((token) => /^[A-Z]{2,}$/.test(token))) score -= 22
    if (keys.every((key) => HEADING_WORDS.has(key) || BUSINESS_WORDS.has(key))) return -100
    return score
}

function displayName(tokens) {
    return tokens
        .filter((token) => !SUFFIX_WORDS.has(wordKey(token)))
        .map((token) => LOWERCASE_NAME_PARTICLES.has(wordKey(token)) ? wordKey(token) : titleCaseAllCaps(token.replace(/\.$/, "")))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
}

function exactCandidate(value, options) {
    const stripped = stripRoleAndNoise(value)
        .replace(/[^A-Za-z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    const tokens = nameTokens(stripped)
    const score = candidateScore(tokens, value, options)
    if (score < (options.minConfidence ?? 62)) return null
    return { name: displayName(tokens), confidence: Math.min(100, score), sourceText: value, reason: "exact_person_name" }
}

export function extractPersonNameCandidate(value, options = {}) {
    const raw = cleanText(value)
    if (!raw || /\d|@|www\.|https?:/i.test(raw)) return null
    const exact = exactCandidate(raw, options)
    if (exact) return exact
    if (options.allowExtraction === false) return null
    const tokens = nameTokens(stripRoleAndNoise(raw))
    const candidates = []
    for (let start = 0; start < tokens.length; start += 1) {
        for (let length = 2; length <= 4; length += 1) {
            const slice = tokens.slice(start, start + length)
            if (slice.length !== length) continue
            const score = candidateScore(slice, raw, options)
            if (score < (options.minConfidence ?? 62)) continue
            candidates.push({
                name: displayName(slice),
                confidence: Math.min(100, score - (start > 0 ? 2 : 0)),
                sourceText: raw,
                reason: "extracted_person_span",
            })
        }
    }
    return candidates.sort((left, right) => right.confidence - left.confidence || left.name.length - right.name.length)[0] ?? null
}

export function normalisePersonName(value, options = {}) {
    return extractPersonNameCandidate(value, options)?.name ?? null
}

export function isLikelyPersonName(value, options = {}) {
    return Boolean(extractPersonNameCandidate(value, { ...options, allowExtraction: false }))
}

export function maybeNormaliseLastNameFirstPersonName(value, options = {}) {
    const clean = cleanText(value)
    if (!clean) return null
    const stripped = clean
        .replace(/[^A-Za-z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    if (!stripped || !/^[A-Z .'-]+$/.test(stripped) || /[a-z]/.test(stripped)) return normalisePersonName(clean, options)
    const tokens = nameTokens(stripped)
    if (tokens.length < 2 || tokens.length > 4) return normalisePersonName(clean, options)
    const keys = tokens.map(wordKey)
    if (keys[0] && COMMON_GIVEN_NAMES.has(keys[0])) return normalisePersonName(clean, options)
    const firstNameIndex = keys.findIndex((key, index) => index > 0 && COMMON_GIVEN_NAMES.has(key))
    if (firstNameIndex < 1) return normalisePersonName(clean, options)
    const reordered = [...tokens.slice(firstNameIndex), ...tokens.slice(0, firstNameIndex)].join(" ")
    return normalisePersonName(reordered, options)
}
