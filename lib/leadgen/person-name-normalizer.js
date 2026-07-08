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

for (const name of ["atticus", "marissa", "tobias"]) COMMON_GIVEN_NAMES.add(name)

const GIVEN_NAME_PRIORS = new Map([
    ["james", 99], ["john", 99], ["robert", 99], ["michael", 99], ["william", 98], ["david", 98], ["richard", 97],
    ["joseph", 97], ["thomas", 96], ["christopher", 96], ["charles", 95], ["daniel", 95], ["matthew", 95],
    ["anthony", 94], ["mark", 94], ["donald", 94], ["steven", 93], ["paul", 93], ["andrew", 93], ["joshua", 93],
    ["kenneth", 92], ["kevin", 92], ["brian", 92], ["george", 91], ["edward", 91], ["ronald", 90], ["timothy", 90],
    ["jason", 90], ["jeffrey", 89], ["ryan", 89], ["jacob", 88], ["gary", 88], ["eric", 88], ["jonathan", 87],
    ["stephen", 87], ["larry", 87], ["justin", 86], ["scott", 84], ["brandon", 84], ["frank", 84],
    ["benjamin", 84], ["gregory", 83], ["raymond", 83], ["jack", 81], ["dennis", 81], ["jose", 96],
    ["juan", 95], ["carlos", 92], ["luis", 91], ["miguel", 90], ["antonio", 90], ["manuel", 89], ["pedro", 88],
    ["ramon", 86], ["rafael", 86], ["sergio", 84], ["fernando", 84], ["eduardo", 83], ["roberto", 83],
    ["hector", 82], ["maria", 99], ["mary", 98], ["patricia", 97], ["jennifer", 97], ["linda", 96],
    ["elizabeth", 96], ["barbara", 95], ["susan", 95], ["jessica", 94], ["sarah", 94], ["karen", 93],
    ["lisa", 93], ["sandra", 92], ["ashley", 91], ["kimberly", 91], ["emily", 91], ["donna", 90],
    ["michelle", 90], ["carol", 89], ["amanda", 89], ["melissa", 89], ["deborah", 88], ["rebecca", 87],
    ["laura", 87], ["amy", 86], ["angela", 85], ["brenda", 85], ["katherine", 84], ["samantha", 83],
    ["catherine", 83], ["rachel", 82], ["miriam", 80], ["ana", 88], ["rosa", 87], ["sofia", 84],
    ["priya", 78], ["marissa", 76], ["tobias", 74], ["atticus", 42],
])

const SURNAME_PRIORS = new Map([
    ["smith", 99], ["johnson", 99], ["williams", 99], ["brown", 98], ["jones", 98], ["garcia", 98], ["miller", 97],
    ["davis", 97], ["rodriguez", 97], ["martinez", 97], ["hernandez", 96], ["lopez", 96], ["gonzalez", 96],
    ["wilson", 95], ["anderson", 95], ["thomas", 95], ["taylor", 94], ["moore", 94], ["jackson", 94],
    ["martin", 94], ["lee", 93], ["perez", 93], ["thompson", 93], ["white", 92], ["harris", 92],
    ["sanchez", 92], ["clark", 91], ["ramirez", 91], ["lewis", 91], ["robinson", 90], ["walker", 90],
    ["young", 90], ["allen", 89], ["king", 89], ["wright", 89], ["scott", 88], ["torres", 88], ["nguyen", 88],
    ["hill", 87], ["flores", 87], ["green", 87], ["adams", 86], ["nelson", 86], ["baker", 86], ["hall", 86],
    ["rivera", 86], ["campbell", 85], ["mitchell", 85], ["carter", 85], ["roberts", 85], ["gomez", 85],
    ["phillips", 84], ["evans", 84], ["turner", 84], ["diaz", 84], ["parker", 83], ["cruz", 83],
    ["edwards", 83], ["collins", 82], ["reyes", 82], ["stewart", 82], ["morris", 81], ["morales", 81],
    ["murphy", 81], ["cook", 80], ["rogers", 80], ["gutierrez", 80], ["ortiz", 80], ["morgan", 79],
    ["cooper", 79], ["peterson", 79], ["bailey", 78], ["reed", 78], ["kelly", 78], ["howard", 78],
    ["ramos", 78], ["kim", 77], ["cox", 77], ["ward", 77], ["richardson", 76], ["watson", 76],
    ["brooks", 76], ["chavez", 76], ["wood", 75], ["james", 75], ["bennett", 75], ["gray", 75],
    ["mendoza", 75], ["ruiz", 74], ["hughes", 74], ["price", 73], ["alvarez", 73], ["castillo", 73],
    ["sanders", 72], ["patel", 72], ["myers", 72], ["long", 72], ["ross", 71], ["foster", 71],
    ["jimenez", 71], ["powell", 70], ["jenkins", 70], ["perry", 70], ["russell", 70], ["sullivan", 70],
    ["bell", 69], ["coleman", 69], ["butler", 69], ["henderson", 68], ["barnes", 68], ["gonzales", 68],
    ["fisher", 68], ["vasquez", 67], ["simmons", 67], ["romero", 67], ["jordan", 67], ["patterson", 66],
    ["alexander", 66], ["hamilton", 66], ["graham", 66], ["reynolds", 65], ["griffin", 65], ["wallace", 65],
    ["moreno", 65], ["west", 64], ["cole", 64], ["hayes", 64], ["bryant", 63], ["herrera", 63],
    ["gibson", 63], ["ellis", 62], ["tran", 62], ["medina", 62], ["aguilar", 62], ["stevens", 61],
    ["murray", 61], ["ford", 61], ["castro", 61], ["marshall", 60], ["owens", 60], ["harrison", 60],
    ["fernandez", 60], ["kennedy", 58], ["wells", 58], ["vargas", 58], ["henry", 58], ["chen", 58],
    ["silva", 55], ["delgado", 39], ["santos", 44], ["salas", 62], ["senor", 55],
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

function isSubstantiveNameKey(key) {
    return Boolean(key) && !SUFFIX_WORDS.has(key) && !LOWERCASE_NAME_PARTICLES.has(key) && !HONORIFIC_WORDS.has(key)
}

function givenNameWeight(key) {
    if (!key || HONORIFIC_WORDS.has(key) || SUFFIX_WORDS.has(key) || LOWERCASE_NAME_PARTICLES.has(key)) return -36
    const prior = GIVEN_NAME_PRIORS.get(key)
    if (prior !== undefined) return prior
    if (COMMON_GIVEN_NAMES.has(key)) return 68
    if (SURNAME_PRIORS.has(key)) return 4
    return 18
}

function surnameWeight(key) {
    if (!key || HONORIFIC_WORDS.has(key) || SUFFIX_WORDS.has(key)) return -36
    if (LOWERCASE_NAME_PARTICLES.has(key)) return 18
    const prior = SURNAME_PRIORS.get(key)
    if (prior !== undefined) return prior
    if (GIVEN_NAME_PRIORS.has(key) || COMMON_GIVEN_NAMES.has(key)) return 7
    return 24
}

function givenSequenceLikelihood(keys) {
    if (keys.length < 1 || keys.length > 2) return null
    if (keys.some((key) => !isSubstantiveNameKey(key))) return null
    const score = keys.reduce((total, key) => total + givenNameWeight(key), 0) + (keys.length === 2 ? 8 : 0)
    const evidence = keys.reduce((total, key) => total + givenNameWeight(key) - surnameWeight(key), 0)
    return { score, evidence }
}

function surnameSequenceLikelihood(keys) {
    if (keys.length < 1 || keys.length > 3) return null
    if (keys.some((key) => HONORIFIC_WORDS.has(key) || SUFFIX_WORDS.has(key))) return null
    const substantiveKeys = keys.filter(isSubstantiveNameKey)
    if (substantiveKeys.length < 1) return null
    const score = keys.reduce((total, key) => total + surnameWeight(key), 0)
        + (substantiveKeys.length >= 2 ? 6 : 0)
        + (keys.some((key) => LOWERCASE_NAME_PARTICLES.has(key)) ? 8 : 0)
    const evidence = substantiveKeys.reduce((total, key) => total + surnameWeight(key) - givenNameWeight(key), 0)
    return { score, evidence }
}

function scoreNameOrder(keys, splitIndex, order) {
    const surnameKeys = order === "last_first" ? keys.slice(0, splitIndex) : keys.slice(splitIndex)
    const givenKeys = order === "last_first" ? keys.slice(splitIndex) : keys.slice(0, splitIndex)
    const given = givenSequenceLikelihood(givenKeys)
    const surname = surnameSequenceLikelihood(surnameKeys)
    if (!given || !surname) return null
    return {
        score: given.score + surname.score,
        evidence: given.evidence + surname.evidence,
        givenKeys,
        surnameKeys,
    }
}

function bestNameOrder(tokens, order, options) {
    const coreTokens = tokens.filter((token) => {
        const key = wordKey(token)
        return key && !HONORIFIC_WORDS.has(key) && !SUFFIX_WORDS.has(key)
    })
    if (coreTokens.length < 2 || coreTokens.length > 4) return null
    if (!coreTokens.every((token) => tokenLooksNameish(token, options))) return null
    if (hasBadWords(coreTokens)) return null
    const keys = coreTokens.map(wordKey)
    let best = null
    for (let splitIndex = 1; splitIndex < keys.length; splitIndex += 1) {
        const result = scoreNameOrder(keys, splitIndex, order)
        if (!result) continue
        if (!best || result.score > best.score) {
            best = { ...result, splitIndex, tokens: coreTokens }
        }
    }
    return best
}

function normaliseExactName(value, options) {
    return normalisePersonName(value, { ...options, allowExtraction: false })
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
    const comma = clean.match(/^([A-Za-z][A-Za-z.' -]{1,45}),\s*([A-Za-z][A-Za-z.' -]{1,45})$/)
    if (comma) {
        const reordered = `${comma[2]} ${comma[1]}`
        return normaliseExactName(reordered, options) ?? normalisePersonName(reordered, options)
    }
    const stripped = clean
        .replace(/[^A-Za-z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    const tokens = nameTokens(stripped)
    const exactOriginal = stripped ? normaliseExactName(stripped, options) : null
    const fallback = exactOriginal ?? normalisePersonName(clean, options)
    if (!stripped || tokens.length < 2 || tokens.length > 4 || options.nameOrder === "first_last") return fallback
    const firstLast = bestNameOrder(tokens, "first_last", options)
    const lastFirst = bestNameOrder(tokens, "last_first", options)
    if (!lastFirst) return fallback
    const sourceHintsLastFirst = options.nameOrder === "last_first"
    const margin = lastFirst.score - (firstLast?.score ?? 0)
    const requiredMargin = sourceHintsLastFirst ? 8 : 30
    const requiredEvidence = sourceHintsLastFirst ? 18 : 55
    if (lastFirst.score < 130 || margin < requiredMargin || lastFirst.evidence < requiredEvidence) return fallback
    const reordered = [
        ...lastFirst.tokens.slice(lastFirst.splitIndex),
        ...lastFirst.tokens.slice(0, lastFirst.splitIndex),
    ].join(" ")
    return normaliseExactName(reordered, options) ?? normalisePersonName(reordered, options) ?? fallback
}
