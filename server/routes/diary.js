const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { updateStaffStreak } = require('../utils/streak');
const { broadcast } = require('../utils/sse');

// Anthropic is optional — only used if API key + credits are present
let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

const router = express.Router();
router.use(authMiddleware);

const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

function getClient() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Fuzzy name matching ────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array(n + 1).fill(0).map((_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function normalizeName(name) {
  return name.toLowerCase().trim()
    .replace(/ph/g, 'f').replace(/bh/g, 'b').replace(/kh/g, 'k')
    .replace(/gh/g, 'g').replace(/sh/g, 's').replace(/th/g, 't').replace(/dh/g, 'd')
    .replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u')
    .replace(/ou/g, 'u').replace(/ei/g, 'i').replace(/v/g, 'w')
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  if (ta.some(t => tb.some(t2 => t === t2 && t.length > 2))) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function fuzzyMatchCustomer(spokenName, customers, threshold = 0.72) {
  if (!spokenName || !spokenName.trim()) return null;
  let best = null, bestScore = 0;
  for (const c of customers) {
    const score = nameSimilarity(spokenName, c.name);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return bestScore >= threshold ? best : null;
}

function titleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

// ── Stop words — words that look like names but aren't ────────────────────────
const STOP_WORDS = new Set([
  // English common words
  'general','client','customer','sir','madam','the','and','but','for','with','this',
  'that','from','have','they','their','back','regarding','about','because','after',
  'before','through','during','also','just','even','when','then','than','only',
  'been','will','would','could','should','shall','some','both','each','into',
  'over','here','there','what','which','where','while','said','says','told',
  // Pronouns and auxiliaries (prevent "Sunita She", "He Was" etc.)
  'she','he','his','her','its','was','are','were','has','had','did','not',
  'him','who','all','one','two','three','four','five','six','seven','eight',
  'nine','ten','new','old','big','small','first','last','next','same','like',
  // Days / months
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
  // Common English words that pass capital/length tests
  'today','tomorrow','morning','evening','office','meeting','call','done',
  'okay','yes','no','okay','ok','time','date','number','phone','mobile',
  'email','address','price','rate','amount','product','service',
  'order','delivery','payment','advance','balance','interested',
  'confirmed','cancelled','pending','complete','regarding',
  // Hindi/Hinglish common words
  'bhai','ji','unka','unhe','wo','woh','aaj','kal','subah','shaam',
  'main','mera','meri','mere','hum','hamara','hamari','aap','apna','apni',
  'woh','yeh','koi','kuch','sab','log','din','raat',
  'aur','lekin','phir','toh','bhi','par','per','hai','tha','thi',
  'the','nahi','nahin','haan','kya','kaise','kyun','kab',
  'yahan','wahan','kal','aaj','abhi','pehle','baad',
  'whatsapp','mobile','number','rupees','lakh','crore',
  // Hindi verb/adjective forms (prevent "milega deepak", "bolega sharma" etc.)
  'milega','milegi','milenge','bolta','bolega','bolegi','bolenge','bola','boli',
  'karega','karegi','karenge','karna','karta','karti','karte','kiya','kiye',
  'aayega','aayegi','aayenge','aaya','aayi','gaya','gayi','gaye',
  'dega','degi','denge','lega','legi','lenge','hua','hui','hue',
  'lagta','lagti','lagte','rehta','rehti','rehte','sakta','sakti','sakte',
  'chahiye','chahta','chahti','chahte','batao','bataya','batai','dekho','dekha',
]);

// ── Common Indian names dictionary ─────────────────────────────────────────────
// Voice transcriptions are ALL LOWERCASE — this dictionary lets us detect names
// that the capitalization-based regex cannot find.
const INDIAN_NAMES = new Set([
  // ── Male first names ──
  'aarav','aarush','aayush','abhijit','abhijeet','abhimanyu','abhishek',
  'adarsh','aditya','ajay','ajit','akash','akhil','alok','amit','amitabh',
  'amol','amrit','anand','aniket','anil','animesh','anish','ankit','ankur',
  'anshul','anuj','anup','anurag','arjun','arnav','arun','arvind','asif',
  'atul','ayush','azhar',
  'bablu','babu','badal','balram','bharat','bhaskar','bhavesh','bhupesh',
  'chandan','chandrakant','chinmay','chirag',
  'danish','darshan','deepak','devendra','devesh','dheeraj','dhruv','dilip',
  'dinesh','dipak','durgesh',
  'farhan','farooq',
  'ganesh','gaurav','girish','gopal','govind','gulshan',
  'hardik','haresh','hari','harish','harshit','hemant','himanshu','hitesh',
  'imran',
  'jagdish','jagmohan','jai','jatin','jayesh','jignesh',
  'kailash','kamal','karan','kartik','kapil','krishna','kuldeep','kunal',
  'lalit','lokesh','lucky',
  'mahendra','mahesh','manish','manoj','mayank','mihir','mitesh','mohit',
  'mohan','mukesh','munna','murali',
  'naresh','naveen','neeraj','nikhil','nilesh','niraj','nitin','nitesh',
  'om','omkar',
  'pankaj','paresh','parth','pavan','pawan','pintu','pradeep','pranav',
  'prakash','prasad','pratik','prateek','praveen','puneet',
  'rahul','raj','rajan','rajesh','rajiv','raju','rakesh','ram','ramesh',
  'ravi','ritesh','rohit','rohan','roop','rupesh',
  'sachin','sagar','sahil','salman','samir','sanjay','sanjeev','santosh',
  'satish','saurabh','shailesh','shiv','shivam','shyam','siddharth','soham',
  'sonu','subhash','sudhir','sumit','sunil','suresh','surjit',
  'tanmay','tarun','tushar','tej',
  'uday','umesh','upen','utpal',
  'varun','vikas','vikram','vinay','vinod','vishal','vivek','vicky',
  'yash','yogesh','yunus','yusuf',
  'zaheer','zubair',
  // ── Female first names ──
  'aarti','aditi','akansha','akanksha','alka','amrita','ananya','anita',
  'anjali','ankita','anushka','aparna','archana','arpita','asha','ashwini',
  'babita','bharati','bindiya','bindu',
  'chanda','chitra','champa','chanchal',
  'deepa','deepika','disha','divya','dolly','durga',
  'ekta',
  'farida','fatima',
  'gauri','gayatri','geeta','gita','gulnaar',
  'hema','heena','hina',
  'indira','isha','ishita',
  'jaya','jyoti',
  'kajal','kavita','kiran','komal','koshika','krishna','kumari','khushi',
  'lakshmi','lata','leela','lekha','lucky',
  'madhuri','mamta','manisha','manju','mansi','maya','meena','meera',
  'minal','monika','muskan',
  'namita','nancy','neelam','neetu','neha','nidhi','nisha','nitu',
  'pallavi','payal','pinky','pooja','poonam','prachi','pragya','prerna',
  'preeti','priya','priyanka','puja',
  'radha','rani','raveena','reena','rekha','ritu','rohini','ruhi','rupa',
  'sarita','savita','seema','shalu','shalini','sheela','shilpa','shweta',
  'simran','smita','sneha','sonia','sonali','swati','sunita','supriya',
  'tanvi','tara','taruna',
  'usha','urmila',
  'vandana','varsha','vatsala','vidya',
  'yashoda','yogita',
  'zoya','zareen',
  // ── Common Indian surnames ──
  'agarwal','agrawal','ahuja','ansari','arora',
  'bajaj','bansal','basu','bhatia','bhat','bhatt','bose',
  'chandra','chauhan','chaudhary','choudhary','chopra',
  'das','dave','desai','deshpande','dubey','dutta',
  'garg','ghosh','gill','goswami','goyal','grewal','gupta',
  'iyer',
  'jain','jha','joshi','jindal',
  'kapoor','kaur','khan','khanna','krishnan','kumar',
  'lal',
  'mahajan','malik','malhotra','mehta','menon','mishra',
  'nair','naidu','nanda',
  'pandey','patel','patil','pillai',
  'qureshi',
  'rao','rastogi','reddy','roy',
  'sahoo','saxena','sen','seth','shah','sharma','shukla','singh','sinha',
  'srivastava','soni',
  'thakur','tiwari','trivedi',
  'varma','verma','vyas',
  'yadav',
]);

// ── Indian locations — stripped from name captures (e.g. "kamal ghaziabad" → "Kamal") ──
// Voice transcription often runs a person's name and their city together since
// salespeople frequently say "kamal ghaziabad wala" or just "kamal ghaziabad".
const INDIAN_LOCATIONS = new Set([
  // UP / NCR
  'ghaziabad','noida','meerut','agra','lucknow','kanpur','varanasi','allahabad',
  'prayagraj','bareilly','aligarh','moradabad','mathura','vrindavan','saharanpur',
  'muzaffarnagar','hapur','bulandshahr','firozabad','etawah','mainpuri',
  'greater noida','faridabad','gurgaon','gurugram','sonipat','panipat','rohtak',
  'hisar','bhiwani','rewari','bahadurgarh','loni','dasna','muradnagar','pilkhuwa',
  // Delhi
  'delhi','newdelhi','dwarka','rohini','janakpuri','shahdara','laxminagar',
  'preetvihar','vikasnagar','uttamnagar','saket','vasantkunj','mayurvihar',
  // Punjab / Haryana / Rajasthan
  'chandigarh','amritsar','ludhiana','jalandhar','patiala','bathinda','mohali',
  'jaipur','jodhpur','udaipur','ajmer','bikaner','kota','alwar','sikar',
  // Madhya Pradesh
  'bhopal','indore','gwalior','jabalpur','ujjain','sagar','satna','rewa',
  // Maharashtra
  'mumbai','pune','nagpur','nashik','aurangabad','solapur','kolhapur','thane',
  'navi mumbai','kalyan','dombivli','vasai','virar','bhiwandi',
  // Gujarat
  'ahmedabad','surat','vadodara','rajkot','bhavnagar','jamnagar','gandhinagar',
  'anand','nadiad','mehsana',
  // Uttar Pradesh misc
  'gorakhpur','jhansi','banda','chitrakoot','fatehpur','unnao','sitapur',
  'hardoi','lakhimpur','shahjahanpur','pilibhit','budaun','rampur','sambhal',
  // Bihar / Jharkhand
  'patna','gaya','bhagalpur','muzaffarpur','purnia','ranchi','jamshedpur',
  'dhanbad','bokaro','hazaribagh','giridih',
  // Other major cities
  'kolkata','hyderabad','bangalore','bengaluru','chennai','bhubaneswar',
  'visakhapatnam','vijayawada','coimbatore','madurai','thiruvananthapuram',
  'kochi','kozhikode','mysore','mangalore','hubli','belgaum',
  'dehradun','haridwar','rishikesh','nainital','haldwani',
  'shimla','manali','dharamsala',
  'jammu','srinagar','leh',
  'guwahati','dibrugarh','silchar',
  'raipur','bilaspur','durg','korba',
  // Common area/locality words that appear after names
  'wala','wali','waale','waali','side','area','city','town','nagar',
  'vihar','enclave','colony','sector','block','phase','extension',
]);

// ── Built-in NLP functions — zero external dependencies ───────────────────────

/**
 * Detect if text is Hindi (Devanagari), Hinglish (Hindi words in Roman script),
 * or plain English.
 */
function detectLanguage(text) {
  // Devanagari Unicode range → definite Hindi
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';

  const hinglishMarkers = [
    'aaj','kal','baat','kiya','hua','hui','gaya','gaye','mila','mile','milna',
    'nahi','nahin','hai','hain','tha','thi','the','se','ko','ne','ka','ki','ke',
    'aur','lekin','pakki','raazi','khush','naraaz','matlab','thoda','bohot',
    'bahut','phir','sab','abhi','pehle','baad','unse','inse','unka','mujhe',
    'humne','aapne','unhone','wahan','yahan','kab','kaise','kyun','kya',
    'accha','theek','shukriya','bilkul','zaroor',
  ];
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const count = words.filter(w => hinglishMarkers.includes(w)).length;
  return (count >= 2 || (words.length > 5 && count / words.length > 0.08))
    ? 'hinglish'
    : 'english';
}

/**
 * Extract person/customer names from diary text.
 *
 * Works for BOTH typed text (proper casing) AND voice transcriptions (all lowercase),
 * because voice API (hi-IN) never capitalises names.
 *
 * Three passes — best to worst confidence:
 *   1. Context patterns (case-insensitive) — name near action word
 *   2. Indian names dictionary scan — word list covering 400+ common names/surnames
 *   3. Capitalised words fallback — typed text only
 */
function extractNamesFromText(text) {
  const found = new Map(); // normalizedKey → displayName (titleCase)

  /**
   * Strip trailing location words from a captured name candidate, then store.
   * "kamal ghaziabad" → strips "ghaziabad" → stores "Kamal"
   * "rahul sharma noida" → strips "noida" → stores "Rahul Sharma"
   * "vijay kumar" → no location → stores "Vijay Kumar"
   */
  const addName = (raw) => {
    let parts = raw.trim().replace(/\s+/g, ' ').toLowerCase().split(' ');
    // Strip trailing location words (may be multi-word like "greater noida")
    while (parts.length > 1 && (INDIAN_LOCATIONS.has(parts[parts.length - 1]) || STOP_WORDS.has(parts[parts.length - 1]))) {
      parts = parts.slice(0, -1);
    }
    // Also try stripping a two-word trailing location (e.g. "greater noida")
    if (parts.length > 2) {
      const lastTwo = parts.slice(-2).join(' ');
      if (INDIAN_LOCATIONS.has(lastTwo)) parts = parts.slice(0, -2);
    }
    const name = titleCase(parts.join(' '));
    const key  = normalizeName(name);
    if (!key || key.length < 3) return;
    if (parts.some(p => STOP_WORDS.has(p))) return;
    if (!found.has(key)) found.set(key, name);
  };

  // ── Pass 1: Context patterns (case-insensitive, catches voice text) ──────────
  // Each pattern captures a name that appears next to an action verb or postposition.
  // We accept the capture only if AT LEAST ONE word is either:
  //   (a) in INDIAN_NAMES dictionary, or
  //   (b) starts with a capital letter in the original text (typed, not voice).
  // This prevents false positives like "Back Regarding" from "called back regarding".
  const ctxPatterns = [
    // "called rahul sharma" / "met priya" / "spoke with kumar"
    /(?:called|met|meeting with|visited|contacted|spoke with|talked to|baat ki|milne|milaa|mile|milke)\s+([a-zA-Z][a-z]{2,}(?:\s+[a-zA-Z][a-z]{2,})?)/gi,
    // "rahul ne" / "sharma ko" / "priya se" — Hindi postpositional pattern
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)\s+(?:ne|ko|se)\b/gi,
    // "sharma ji" / "rahul bhai" / "kumar sahab"
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)\s+(?:ji|sahab|bhai)\b/gi,
    // "Mr Gupta" / "Mrs Sharma" / "Shri Verma"
    /(?:Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)/gi,
    // "customer rahul" / "client priya"
    /(?:customer|client|party|buyer|prospect)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)/gi,
    // "rahul ka order" / "priya ki payment" — possessive Hindi
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)\s+(?:ka|ki|ke)\s+(?:order|payment|bill|deal|number|phone|call|meeting|kaam)/gi,
  ];

  for (const pattern of ctxPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const candidate = m[1].trim();
      const parts = candidate.toLowerCase().split(/\s+/);
      // All words ≥ 3 chars and not in stop-words
      if (!parts.every(p => p.length >= 3 && !STOP_WORDS.has(p))) continue;
      // At least one word must be a known Indian name OR capitalized in original text
      const isValidName = parts.some(p =>
        INDIAN_NAMES.has(p) ||
        new RegExp('\\b' + p.charAt(0).toUpperCase() + p.slice(1) + '\\b').test(text)
      );
      if (isValidName) addName(candidate);
    }
  }

  // ── Pass 2: Dictionary scan — works on fully-lowercase voice transcriptions ──
  // Tokenise text and look for runs of 1–2 consecutive known Indian name tokens,
  // then skip any immediately following location token.
  const tokens = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t0 = tokens[i];
    if (!INDIAN_NAMES.has(t0)) continue;

    const t1 = tokens[i + 1];
    const t2 = tokens[i + 2];

    if (t1 && INDIAN_NAMES.has(t1) && !STOP_WORDS.has(t1)) {
      // "rahul sharma" — first name + surname
      const namePart = `${t0} ${t1}`;
      i++;
      // "rahul sharma ghaziabad" — skip trailing location
      if (t2 && (INDIAN_LOCATIONS.has(t2) || INDIAN_LOCATIONS.has(`${t1} ${t2}`))) i++;
      addName(namePart);
    } else if (t1 && INDIAN_LOCATIONS.has(t1)) {
      // "kamal ghaziabad" — name + location: take name, skip location
      addName(t0);
      i++; // consume location token so it isn't mistaken for something else
    } else {
      addName(t0);
    }
  }

  // ── Pass 3: Capitalised bigrams / single words (typed text fallback) ─────────
  (text.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) || []).forEach(n => addName(n));

  if (found.size === 0) {
    // Last resort: any single capitalised word
    (text.match(/\b[A-Z][a-z]{2,}\b/g) || []).forEach(w => addName(w));
  }

  // ── Deduplication: remove partial names already covered by a full name ────────
  // e.g. "Verma" is redundant if "Vijay Verma" is already in the set
  const all = [...found.values()];
  return all.filter(name =>
    !all.some(longer => longer !== name && longer.toLowerCase().includes(name.toLowerCase()))
  );
}

/**
 * Detect sentiment from sales-relevant keyword lists.
 */
function detectSentimentLocal(text) {
  const lower = text.toLowerCase();
  const positive = [
    'deal','confirmed','agreed','interested','happy','closed','success','sold',
    'bought','approved','order','payment','received','signed','contract',
    'pakki','raazi','khush','haan','accha','bilkul','zaroor','positive',
  ];
  const negative = [
    'rejected','angry','upset','cancelled','refused','complaint','problem',
    'issue','failed','loss','dispute','return','refund','delay','pending',
    'naraaz','mana','nahi','nahin','bad','difficult',
  ];
  let score = 0;
  positive.forEach(w => { if (lower.includes(w)) score++; });
  negative.forEach(w => { if (lower.includes(w)) score--; });
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

/**
 * Extract actionable follow-up items using keyword pattern matching.
 */
function extractActionItemsLocal(text) {
  const checks = [
    { r: /follow.?up|followup/i,                             a: 'Follow up with customer'  },
    { r: /(?:send|quote|proposal|estimate|quotation|bhej)/i, a: 'Send quote/proposal'      },
    { r: /(?:call back|callback|phone back|ring)/i,          a: 'Call back customer'        },
    { r: /(?:schedule|appointment|milenge|milna hai)/i,      a: 'Schedule meeting'          },
    { r: /(?:payment|invoice|bill|dues|baaki)/i,             a: 'Follow up on payment'      },
    { r: /(?:demo|demonstration|presentation|dikhana)/i,     a: 'Arrange product demo'      },
    { r: /(?:deliver|delivery|dispatch|courier|bhejna)/i,    a: 'Arrange delivery'          },
  ];
  return [...new Set(checks.filter(c => c.r.test(text)).map(c => c.a))].slice(0, 4);
}

/**
 * Build a structured English summary from the extracted NLP data.
 * This is shown as "English Summary" in the UI when no AI translation is available.
 */
function buildEnglishSummary(names, lang, sentiment, actions, staffName) {
  const langLabel = lang === 'hindi' ? 'Hindi' : lang === 'hinglish' ? 'Hindi/Hinglish' : 'English';
  const nameStr   = names.length > 0 ? names.join(', ') : 'no specific customers identified';
  const sentStr   = sentiment === 'positive'
    ? 'Overall positive outcome.'
    : sentiment === 'negative'
    ? 'Some challenges or objections noted.'
    : 'Standard interaction.';
  const actStr = actions.length > 0
    ? ` Next steps: ${actions.join('; ')}.`
    : '';
  return `Entry recorded in ${langLabel} by ${staffName}. Customers mentioned: ${nameStr}. ${sentStr}${actStr}`;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/diary
router.get('/', async (req, res) => {
  try {
    let entries = await readDB('diary');
    if (req.user.role === 'staff') {
      entries = entries.filter(e => e.staffId === req.user.id);
    }
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(entries);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/diary/:id
router.get('/:id', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(entry);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/diary/:id
router.delete('/:id', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own entries' });
    }
    await deleteOne('diary', req.params.id);
    broadcast('diary:deleted', { id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/diary — submit a diary entry (text or transcribed voice)
router.post('/', async (req, res) => {
  try {
    const { content, date } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const entry = {
      id: uuidv4(),
      staffId: req.user.id,
      staffName: req.user.name,
      content,
      date: date || new Date().toISOString().split('T')[0],
      status: 'processing',
      aiEntries: [],
      translatedContent: null,
      detectedLanguage: null,
      createdAt: new Date().toISOString(),
    };

    await insertOne('diary', entry);
    await updateStaffStreak(req.user.id);

    // Respond immediately — processing happens async in background
    res.status(202).json(entry);
    processDiaryEntry(entry.id, content, req.user.id, req.user.name).catch(console.error);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/diary/:id/reanalyze
router.post('/:id/reanalyze', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await updateOne('diary', req.params.id, {
      status: 'processing', aiEntries: [], translatedContent: null,
      detectedLanguage: null, error: null,
    });
    const updated = { ...entry, status: 'processing', aiEntries: [], translatedContent: null, detectedLanguage: null };
    broadcast('diary:updated', updated);
    res.json(updated);
    processDiaryEntry(req.params.id, entry.content, entry.staffId, entry.staffName).catch(console.error);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Core processing ────────────────────────────────────────────────────────────

/**
 * Main diary processing function.
 *
 * PHASE 1 (always runs, always completes):
 *   Built-in NLP → extract names, sentiment, actions → auto-create customers →
 *   save entry as 'done' with English summary.
 *
 * PHASE 2 (optional, best-effort):
 *   If ANTHROPIC_API_KEY is set AND credits are available, try AI for a richer
 *   translation and better notes. If AI fails for ANY reason, the Phase-1 result
 *   stands — the diary entry is never left in 'error' state.
 */
async function processDiaryEntry(entryId, content, staffId, staffName) {
  // ── PHASE 1: Built-in NLP ──────────────────────────────────────────────────
  let allCustomers = [];
  try { allCustomers = await readDB('customers'); } catch {}

  const lang        = detectLanguage(content);
  const names       = extractNamesFromText(content);
  const sentiment   = detectSentimentLocal(content);
  const actions     = extractActionItemsLocal(content);
  const summary     = buildEnglishSummary(names, lang, sentiment, actions, staffName);
  const now         = new Date().toISOString();

  const newCustomers = [];
  const localEntries = [];

  for (const name of names) {
    let resolved = fuzzyMatchCustomer(name, [...allCustomers, ...newCustomers], 0.78);

    if (resolved) {
      // Update lastContact timestamp on existing customer
      try { await updateOne('customers', resolved.id, { lastContact: now }); } catch {}
    } else {
      // Auto-create new customer
      try {
        const newCust = {
          id: uuidv4(), name: titleCase(name), phone: '', email: '',
          assignedTo: staffId, status: 'lead', lastContact: now,
          notes: `Auto-created from diary entry by ${staffName}`,
          notesList: [], tags: ['diary-import'], dealValue: null, createdAt: now,
        };
        await insertOne('customers', newCust);
        allCustomers.push(newCust);
        newCustomers.push(newCust);
        resolved = newCust;
        broadcast('customer:created', newCust);
        console.log(`[Diary NLP] ✅ Created customer: "${newCust.name}"`);
      } catch (e) {
        console.error('[Diary NLP] Customer create failed:', e.message);
        continue;
      }
    }

    const isNew = newCustomers.some(c => c.id === resolved.id);
    const noteText = sentiment === 'positive'
      ? 'Positive interaction logged.'
      : sentiment === 'negative'
      ? 'Interaction noted — follow up required.'
      : 'Interaction logged from diary entry.';

    localEntries.push({
      spokenName:          name,
      customerName:        resolved.name,
      customerId:          resolved.id,
      matchedCustomerName: resolved.name,
      matchedCustomerId:   resolved.id,
      isNewCustomer:       isNew,
      autoCreatedId:       isNew ? resolved.id : null,
      date:                null,
      notes:               actions.length > 0 ? `${noteText} Next: ${actions[0]}.` : noteText,
      originalNotes:       content.slice(0, 400),
      actionItems:         actions,
      sentiment,
      confidence:          0.65,
    });
  }

  // If no names found, still log the entry as a general note
  if (localEntries.length === 0) {
    localEntries.push({
      spokenName: 'General', customerName: 'General', customerId: null,
      matchedCustomerName: null, isNewCustomer: false, date: null,
      notes: actions.length > 0
        ? `General activity logged. Next: ${actions[0]}.`
        : 'No specific customer names detected in this entry.',
      originalNotes:  content.slice(0, 400),
      actionItems:    actions,
      sentiment,
      confidence:     0.3,
    });
  }

  // Save immediately — diary is DONE after Phase 1
  const savedEntry = await updateOne('diary', entryId, {
    status:           'done',
    aiEntries:        localEntries,
    translatedContent: summary,
    detectedLanguage:  lang,
    processedAt:       now,
  });
  broadcast('diary:updated', savedEntry);

  if (newCustomers.length > 0) {
    console.log(`[Diary NLP] Created ${newCustomers.length} new customer(s) for ${staffName}`);
  }

  // ── PHASE 2: Optional AI enhancement ──────────────────────────────────────
  // Skipped entirely if no API key. On ANY error, local result stands.
  const client = getClient();
  if (!client) return;

  try {
    const customerRef = allCustomers.length > 0
      ? allCustomers.map(c => `"${c.name}" [id:${c.id}]`).join('\n')
      : '(none yet)';

    const aiPrompt = `You are a bilingual sales CRM assistant fluent in Hindi, Hinglish, and English.

DIARY ENTRY:
"""
${content.slice(0, 4000)}
"""

KNOWN CUSTOMERS:
${customerRef}

Provide a complete, natural English translation of the ENTIRE diary entry (not a summary — full translation sentence by sentence), then extract customer interactions.

Respond ONLY with this JSON:
{
  "detectedLanguage": "hindi|english|hinglish",
  "translatedContent": "Complete natural English translation in first person",
  "entries": [
    {
      "spokenName": "name as written",
      "matchedCustomerName": "exact name from known list or null",
      "matchedCustomerId": "exact id from known list or null",
      "isNewCustomer": false,
      "date": null,
      "notes": "1-2 sentence professional English summary",
      "originalNotes": "original text about this person",
      "actionItems": ["follow-up action"],
      "sentiment": "positive|neutral|negative",
      "confidence": 0.9
    }
  ]
}`;

    let aiResult;
    try {
      const res = await client.messages.create({
        model: AI_MODEL, max_tokens: 3000,
        messages: [{ role: 'user', content: aiPrompt }],
      });
      aiResult = extractJSON(res.content[0].text);
    } catch (err) {
      // Try fallback model on model-not-found errors
      if ((err?.status === 404 || err?.status === 400) && AI_MODEL !== 'claude-3-5-haiku-20241022') {
        const res2 = await client.messages.create({
          model: 'claude-3-5-haiku-20241022', max_tokens: 3000,
          messages: [{ role: 'user', content: aiPrompt }],
        });
        aiResult = extractJSON(res2.content[0].text);
      } else {
        throw err;
      }
    }

    if (!aiResult || !Array.isArray(aiResult.entries) || aiResult.entries.length === 0) {
      return; // Bad response — local result stands
    }

    // Re-run customer resolution with AI-detected names
    const aiNewCustomers = [];
    const aiEntries = [];
    const nowAI = new Date().toISOString();

    for (const e of aiResult.entries) {
      const spokenName = (e.spokenName || '').trim();
      const nameLower  = spokenName.toLowerCase();
      if (!spokenName || STOP_WORDS.has(nameLower) || spokenName.length < 3) continue;

      let resolved = null;
      if (e.matchedCustomerId) {
        resolved = allCustomers.find(c => c.id === e.matchedCustomerId) || null;
      }
      if (!resolved) {
        resolved = fuzzyMatchCustomer(spokenName, [...allCustomers, ...aiNewCustomers]);
      }
      if (!resolved) {
        try {
          const newCust = {
            id: uuidv4(), name: titleCase(spokenName), phone: '', email: '',
            assignedTo: staffId, status: 'lead', lastContact: nowAI,
            notes: `Auto-created from diary entry by ${staffName}`,
            notesList: [], tags: ['diary-import'], dealValue: null, createdAt: nowAI,
          };
          await insertOne('customers', newCust);
          allCustomers.push(newCust);
          aiNewCustomers.push(newCust);
          resolved = newCust;
          broadcast('customer:created', newCust);
          console.log(`[Diary AI] ✅ Created customer: "${newCust.name}"`);
        } catch { continue; }
      } else if (!aiNewCustomers.find(c => c.id === resolved.id)) {
        try { await updateOne('customers', resolved.id, { lastContact: nowAI }); } catch {}
      }

      const isNew = aiNewCustomers.some(c => c.id === resolved.id);
      aiEntries.push({
        spokenName,
        customerName:        resolved.name,
        customerId:          resolved.id,
        matchedCustomerName: resolved.name,
        matchedCustomerId:   resolved.id,
        isNewCustomer:       isNew,
        autoCreatedId:       isNew ? resolved.id : null,
        date:                e.date   || null,
        notes:               e.notes  || '',
        originalNotes:       e.originalNotes || '',
        actionItems:         Array.isArray(e.actionItems) ? e.actionItems : [],
        sentiment:           ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
        confidence:          typeof e.confidence === 'number' ? e.confidence : 0.8,
      });
    }

    if (aiEntries.length > 0) {
      const enhanced = await updateOne('diary', entryId, {
        aiEntries:         aiEntries,
        translatedContent: aiResult.translatedContent || summary,
        detectedLanguage:  aiResult.detectedLanguage  || lang,
      });
      broadcast('diary:updated', enhanced);
      console.log(`[Diary AI] ✅ Enhanced entry ${entryId} with AI translation`);
    }

  } catch (err) {
    // AI failed — local Phase-1 result already saved and broadcast. Just log it.
    const msg = (err?.message || String(err)).slice(0, 120);
    console.warn(`[Diary AI] Enhancement skipped (${err?.status || 'err'}): ${msg}`);
  }
}

/**
 * Robustly extract a JSON object from an AI response string.
 */
function extractJSON(text) {
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

module.exports = router;
