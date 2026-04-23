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
  const normSpoken = normalizeName(spokenName);
  let best = null, bestScore = 0;

  for (const c of customers) {
    let score = nameSimilarity(spokenName, c.name);

    // Boost: if extracted name is a prefix of the customer's name
    // e.g. spoken "Bittoo" matches stored "Bittoo Fashion Chandigarh"
    const normCust = normalizeName(c.name);
    if (normSpoken.length >= 4 && normCust.startsWith(normSpoken)) {
      score = Math.max(score, 0.85);
    }
    // Boost: customer name starts with what was spoken (first word match)
    const custFirstWord = normCust.split(' ')[0];
    const spokenFirstWord = normSpoken.split(' ')[0];
    if (spokenFirstWord.length >= 4 && custFirstWord === spokenFirstWord) {
      score = Math.max(score, 0.80);
    }
    // Boost: spoken name contains customer's first word (e.g. "manish agra" contains "manish")
    if (custFirstWord.length >= 4 && normSpoken.includes(custFirstWord)) {
      score = Math.max(score, 0.80);
    }

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
  // Action verbs — appear before names but are NOT part of the name
  'called','met','spoke','visited','contacted','talked','phoned','texted',
  'emailed','messaged','reached','sent','gave','took','brought','bought',
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
  'varun','vikas','vijay','vijaypal','vimal','vinay','vineet','vinod',
  'vishal','vivek','vicky','virendra',
  'yash','yogesh','yuvraj','yunus','yusuf',
  'zaheer','zubair',
  // Nicknames & common informal names
  'ansh','anshu','bittu','bittoo','bunty','pinku','rinku','tinku',
  'sunny','rocky','ricky','raja','kundan','inder','devraj','monu',
  'tonu','pappu','chhotu','chotu','golu','gollu','prince','lucky',
  'babloo','pappu','chintu','pintu','sonu','ramu','shamu','lalu',
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

// ── Indian locations — kept AS PART of the customer name ─────────────────────
// Customers in this system are identified as "name place" (e.g. "Manish Agra",
// "Mohit Lajpat Nagar", "Ansh Chauhan Kolkata", "Bittoo Fashion Chandigarh").
// When voice recognition produces "manish agra" we store it as "Manish Agra",
// NOT just "Manish". The place is the disambiguator the sales team uses.
const INDIAN_LOCATIONS = new Set([
  // UP / NCR districts & cities
  'ghaziabad','noida','meerut','agra','lucknow','kanpur','varanasi','allahabad',
  'prayagraj','bareilly','aligarh','moradabad','mathura','vrindavan','saharanpur',
  'muzaffarnagar','hapur','bulandshahr','firozabad','etawah','mainpuri',
  'faridabad','gurgaon','gurugram','sonipat','panipat','rohtak',
  'hisar','bhiwani','rewari','bahadurgarh','loni','dasna','muradnagar','pilkhuwa',
  // Delhi localities & areas
  'delhi','dwarka','rohini','janakpuri','shahdara','laxminagar','laxmi nagar',
  'preetvihar','vikasnagar','uttamnagar','saket','vasantkunj','mayurvihar',
  'lajpat','lajpatnagar','karolbagh','karol bagh','chandnichowk','chandni chowk',
  'connaught','paharganj','nehrunagar','nehru nagar','jangpura','lodhi','lodhi road',
  'gtb nagar','gtbnagar','vishwas nagar','vishwasnagar','dilshad','dilshad garden',
  'yamuna vihar','yamuna','seelampur','gandhi nagar','gandhingar','krishna nagar',
  'lake city','model town','pitampura','shalimar bagh','punjabi bagh','rajouri',
  'rajouri garden','tilak nagar','uttam nagar','subhash nagar','ramesh nagar',
  'kirti nagar','moti nagar','rajender nagar','patel nagar','inderpuri',
  'naraina','madipur','paschim vihar','nilothi','nangloi','mangolpuri',
  'sultanpur','ghitorni','chattarpur','mehrauli','hauz khas','green park',
  'malviya nagar','safdarjung','lodi colony','jor bagh','ina','andrews ganj',
  'okhla','jasola','kalindi kunj','badarpur','molar band','sangam vihar',
  'govindpuri','kalkaji','nehru place','alaknanda','chittaranjan park',
  'east of kailash','greater kailash','panchsheel','srinivaspuri',
  'new friends colony','sukhdev vihar','madangir','ambedkar nagar',
  'sarita vihar','masoodpur','moti bagh','rk puram','safdarjung enclave',
  'vasant vihar','munirka','ber sarai','mahipalpur','aerocity',
  'dwarka sector','noida sector',
  // Punjab / Haryana / Rajasthan
  'chandigarh','amritsar','ludhiana','jalandhar','patiala','bathinda','mohali',
  'zirakpur','kharar','derabassi','ropar','fatehgarh','muktsar','moga','barnala',
  'jaipur','jodhpur','udaipur','ajmer','bikaner','kota','alwar','sikar',
  'bhilwara','tonk','sawai madhopur','dholpur','karauli','bundi','chittorgarh',
  // Madhya Pradesh
  'bhopal','indore','gwalior','jabalpur','ujjain','sagar','satna','rewa',
  'dewas','shivpuri','morena','bhind','datia','vidisha','raisen','sehore',
  // Maharashtra
  'mumbai','pune','nagpur','nashik','aurangabad','solapur','kolhapur','thane',
  'navi mumbai','kalyan','dombivli','vasai','virar','bhiwandi','ulhasnagar',
  'ambernath','badlapur','panvel','khopoli','lonavala','pune city','pimpri',
  'chinchwad','pimpri chinchwad','akola','amravati','nanded','latur','osmanabad',
  // Gujarat
  'ahmedabad','surat','vadodara','rajkot','bhavnagar','jamnagar','gandhinagar',
  'anand','nadiad','mehsana','junagadh','porbandar','surendranagar','patan',
  'palanpur','himmatnagar','godhra','ankleshwar','bharuch','valsad','navsari',
  // UP misc
  'gorakhpur','jhansi','banda','chitrakoot','fatehpur','unnao','sitapur',
  'hardoi','lakhimpur','shahjahanpur','pilibhit','budaun','rampur','sambhal',
  'bijnor','amroha','hapur','greater noida','noida extension',
  // Bihar / Jharkhand
  'patna','gaya','bhagalpur','muzaffarpur','purnia','ranchi','jamshedpur',
  'dhanbad','bokaro','hazaribagh','giridih','darbhanga','motihari','samastipur',
  // Other major metros & cities
  'kolkata','hyderabad','bangalore','bengaluru','chennai','bhubaneswar',
  'visakhapatnam','vijayawada','coimbatore','madurai','thiruvananthapuram',
  'kochi','kozhikode','mysore','mangalore','hubli','belgaum','davangere',
  'dehradun','haridwar','rishikesh','nainital','haldwani','roorkee',
  'shimla','manali','dharamsala','solan','mandi','kullu',
  'jammu','srinagar','leh','udhampur','kathua',
  'guwahati','dibrugarh','silchar','tezpur','jorhat',
  'raipur','bilaspur','durg','korba','rajnandgaon',
  'bhopal','jabalpur',
  // Generic locality suffixes — kept in location set so dictionary scan includes them
  'nagar','vihar','enclave','colony','sector','block','phase','extension',
  'market','chowk','crossing','road','marg','place','garden','park','puri',
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
 * Customer name format used by this team: "person [surname] [place]"
 * e.g. "Manish Agra", "Mohit Lajpat Nagar", "Ansh Chauhan Kolkata",
 *      "Bittoo Fashion Chandigarh" — name combinations can be anything.
 *
 * Works for BOTH typed text (proper casing) AND voice transcriptions (all lowercase).
 *
 * Four passes — best to worst confidence:
 *   1. Location-anchored — finds ANY words before a known city (no dict needed)
 *   2. INDIAN_NAMES dict scan — for names without a city suffix
 *   3. Context patterns — name near action word / Hindi postposition
 *   4. Capitalised words fallback — typed text only
 */
function extractNamesFromText(text) {
  const found = new Map(); // normalizedKey → displayName (titleCase)

  // Grammatical fillers that appear after a name but aren't part of it
  const FILLER = new Set(['wala','wali','waale','waali','wale','vale','vali']);

  const addName = (raw) => {
    let parts = raw.trim().replace(/\s+/g, ' ').toLowerCase().split(' ');
    // Strip trailing filler (wala/wali etc.) but NOT locations
    while (parts.length > 1 && FILLER.has(parts[parts.length - 1])) {
      parts = parts.slice(0, -1);
    }
    if (parts.length === 0) return;
    // Reject if any word is a stop word
    if (parts.some(p => STOP_WORDS.has(p))) return;
    const name = titleCase(parts.join(' '));
    const key  = normalizeName(name);
    if (!key || key.length < 3) return;
    if (!found.has(key)) found.set(key, name);
  };

  const tokens = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);

  // ── Pass 1: Location-anchored extraction ──────────────────────────────────
  //
  // Scans for known cities/localities and captures 1-3 words BEFORE them as the
  // customer name. This handles arbitrary name combinations the user says because
  // the city is the reliable anchor, not the person's name.
  //
  //   "manish agra"              → "Manish Agra"
  //   "bittoo fashion chandigarh"→ "Bittoo Fashion Chandigarh"
  //   "ansh chauhan kolkata"     → "Ansh Chauhan Kolkata"
  //   "mohit lajpat nagar"       → "Mohit Lajpat Nagar"
  //   "vijay sharma ghaziabad"   → "Vijay Sharma Ghaziabad"
  //
  for (let i = 0; i < tokens.length; i++) {
    let locWords = 0;       // how many tokens form the location
    let locLabel = '';      // the location string

    // Try two-word location first ("lajpat nagar", "greater noida")
    const maybe2 = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : '';
    if (maybe2 && INDIAN_LOCATIONS.has(maybe2)) {
      locWords = 2; locLabel = maybe2;
    } else if (INDIAN_LOCATIONS.has(tokens[i])) {
      locWords = 1; locLabel = tokens[i];
    }

    if (locWords === 0) continue; // not a location token

    // Look back up to 3 words for the name (stop at stop words or short words)
    const nameTokens = [];
    for (let k = i - 1; k >= 0 && i - k <= 3; k--) {
      const w = tokens[k];
      if (STOP_WORDS.has(w) || w.length < 3 || FILLER.has(w)) break;
      nameTokens.unshift(w);
    }

    if (nameTokens.length > 0) {
      // Full customer name = person name + location
      const locParts = locLabel.split(' ');
      addName([...nameTokens, ...locParts].join(' '));
    }

    i += locWords - 1; // skip location tokens on next iterations
  }

  // ── Pass 2: INDIAN_NAMES dict scan — for names with no city context ────────
  //
  // "rahul sharma", "priya ne call kiya", etc.
  // Only starts a name group from a KNOWN first name/surname to prevent
  // "Kumar Sunita" false positives when "vijay" precedes "kumar".
  //
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!INDIAN_NAMES.has(t)) continue;

    const parts = [t];
    let j = i + 1;

    // Consume optional surname (next token also in INDIAN_NAMES)
    if (j < tokens.length && INDIAN_NAMES.has(tokens[j]) && !STOP_WORDS.has(tokens[j])) {
      parts.push(tokens[j]);
      j++;
    }

    // Consume optional location (1-2 words) — appended to name per team convention
    if (j < tokens.length) {
      const loc1 = tokens[j];
      const loc2 = tokens[j + 1];
      const two  = loc2 ? `${loc1} ${loc2}` : '';

      if (two && INDIAN_LOCATIONS.has(two)) {
        parts.push(loc1, loc2); j += 2;
      } else if (INDIAN_LOCATIONS.has(loc1)) {
        parts.push(loc1); j++;
        if (j < tokens.length && INDIAN_LOCATIONS.has(tokens[j])) {
          parts.push(tokens[j]); j++;
        }
      }
    }

    addName(parts.join(' '));
    i = j - 1;
  }

  // ── Pass 3: Context patterns (case-insensitive) ────────────────────────────
  // Captures up to 3 words so "called manish agra" gives "Manish Agra".
  // At least one captured word must be a known name or location (prevents generic captures).
  const ctxPatterns = [
    /(?:called|met|meeting with|visited|contacted|spoke with|talked to|baat ki|milne|milaa|mile|milke)\s+([a-zA-Z][a-z]{2,}(?:\s+[a-zA-Z][a-z]{2,}){0,2})/gi,
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})\s+(?:ne|ko|se)\b/gi,
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,1})\s+(?:ji|sahab|bhai)\b/gi,
    /(?:Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)/gi,
    /(?:customer|client|party|buyer|prospect)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})/gi,
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})\s+(?:ka|ki|ke)\s+(?:order|payment|bill|deal|number|phone|call|meeting|kaam)/gi,
  ];

  for (const pattern of ctxPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const candidate = m[1].trim();
      const parts = candidate.toLowerCase().split(/\s+/);
      if (!parts.every(p => p.length >= 3 && !STOP_WORDS.has(p))) continue;
      // Require at least one word to be a KNOWN PERSON NAME or capitalized in original
      // (INDIAN_LOCATIONS alone is not enough — "delhi wale ne" shouldn't produce "Delhi")
      const isValid = parts.some(p =>
        INDIAN_NAMES.has(p) ||
        new RegExp('\\b' + p.charAt(0).toUpperCase() + p.slice(1) + '\\b').test(text)
      );
      if (isValid) addName(candidate);
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

// ── Task / interaction helpers ─────────────────────────────────────────────────

/**
 * Parse a due date from diary text.
 * Handles: kal/tomorrow, parso/day after tomorrow, aaj/today, next week, agle hafte.
 * Falls back to tomorrow if a future-intent phrase is found but no date is specified.
 */
function parseDueDateFromText(text) {
  const lower = text.toLowerCase();
  const d = new Date();
  const fmt = (dt) => dt.toISOString().split('T')[0];

  if (/\bparso\b|\bday after tomorrow\b/.test(lower)) { d.setDate(d.getDate() + 2); return fmt(d); }
  if (/\bkal\b|\btomorrow\b/.test(lower))              { d.setDate(d.getDate() + 1); return fmt(d); }
  if (/\baaj\b|\btoday\b/.test(lower))                 { return fmt(d); }
  if (/\bnext week\b|\bagle hafte\b|\bis hafte\b/.test(lower)) { d.setDate(d.getDate() + 7); return fmt(d); }
  if (/\bnext month\b|\bagle mahine\b/.test(lower))    { d.setDate(d.getDate() + 30); return fmt(d); }
  // Generic future intent → default to tomorrow
  d.setDate(d.getDate() + 1);
  return fmt(d);
}

/**
 * Detect if text has a future-intent phrase that should create a task.
 * Returns [{title, dueDate}] — one entry per detected action.
 * Keeps it tight: max 3 tasks per diary entry.
 */
function detectTasks(text, customerName) {
  const lower = text.toLowerCase();
  const dueDate = parseDueDateFromText(text);
  const cName = customerName || 'Customer';

  const patterns = [
    // Video call / call
    { r: /video\s*call/i,                                      t: `Video call with ${cName}`    },
    { r: /(?:call back|call karega|call karein|phone karega|ring karega|call karna)/i,
                                                               t: `Call ${cName}`               },
    // Meeting
    { r: /(?:milenge|milna hai|meeting|appointment)/i,         t: `Meeting with ${cName}`       },
    // Quote / proposal
    { r: /(?:quote|proposal|estimate|quotation|bhejega|bhejna)/i, t: `Send quote to ${cName}`  },
    // Payment follow-up
    { r: /(?:payment|invoice|bill|baaki|dues)/i,               t: `Follow up on payment — ${cName}` },
    // Delivery
    { r: /(?:deliver|dispatch|courier|bhejna|mal bhejega)/i,   t: `Arrange delivery for ${cName}` },
    // Follow up (generic)
    { r: /follow.?up/i,                                        t: `Follow up with ${cName}`    },
    // Demo
    { r: /(?:demo|demonstration|dikhana|dikhayenge)/i,         t: `Product demo for ${cName}`  },
  ];

  const tasks = [];
  for (const { r, t } of patterns) {
    if (r.test(lower)) {
      tasks.push({ title: t, dueDate });
      if (tasks.length >= 3) break;
    }
  }
  return tasks;
}

/**
 * Extract a rupee amount from text.
 * Handles: "50000 ka", "₹50000", "50k", "5 lakh", "Rs 50,000"
 */
function extractAmount(text) {
  const lower = text.toLowerCase();
  let m;

  // "5 lakh", "5.5 lakh"
  m = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac)/);
  if (m) return Math.round(parseFloat(m[1]) * 100000);

  // "50k"
  m = lower.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);

  // "₹50000" / "rs 50000" / "50000 ka" / "50,000"
  m = lower.match(/(?:₹|rs\.?\s*)?(\d[\d,]{2,})(?:\s*(?:ka|ke|ki|rupees?|ruppees?))?/);
  if (m) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 100) return val; // ignore tiny numbers like "50 ka chai"
  }
  return null;
}

/**
 * Build a human-readable note for the interaction log entry on the customer profile.
 * Combines sentiment, amount, and next actions into a compact string.
 */
function buildInteractionNote(content, sentiment, amount, actions) {
  const parts = [];

  // Sentiment opening line
  if (sentiment === 'positive') {
    parts.push('Positive interaction logged from diary entry.');
  } else if (sentiment === 'negative') {
    parts.push('Interaction noted — follow up required.');
  } else {
    parts.push('Interaction logged from diary entry.');
  }

  // Deal amount if detected
  if (amount) {
    const formatted = amount >= 100000
      ? `₹${(amount / 100000).toFixed(1).replace(/\.0$/, '')} lakh`
      : `₹${amount.toLocaleString('en-IN')}`;
    parts.push(`Deal amount: ${formatted}.`);
  }

  // Next action (first one)
  if (actions && actions.length > 0) {
    parts.push(`Next: ${actions[0]}.`);
  }

  // Snippet of original text (first 150 chars)
  const snippet = content.trim().slice(0, 150);
  if (snippet) {
    parts.push(`Entry: "${snippet}${content.length > 150 ? '…' : ''}"`);
  }

  return parts.join(' ');
}

// ── Core processing ────────────────────────────────────────────────────────────

/**
 * Main diary processing.
 *
 * PHASE 1 — always runs, always completes fast (pure local NLP):
 *   Extract names → resolve/create customers → log interactions →
 *   create tasks → save diary as 'done' → broadcast.
 *   All customer + task + interaction writes happen in parallel after
 *   the diary broadcast so the UI updates instantly.
 *
 * PHASE 2 — optional AI enhancement (skipped when no API key / no credits).
 */
async function processDiaryEntry(entryId, content, staffId, staffName) {
  // ── PHASE 1: Local NLP — parallel reads ────────────────────────────────────
  let allCustomers = [];
  try { allCustomers = await readDB('customers'); } catch {}

  const lang      = detectLanguage(content);
  const names     = extractNamesFromText(content);
  const sentiment = detectSentimentLocal(content);
  const actions   = extractActionItemsLocal(content);
  const summary   = buildEnglishSummary(names, lang, sentiment, actions, staffName);
  const amount    = extractAmount(content);
  const now       = new Date().toISOString();

  const newCustomers  = [];
  const localEntries  = [];
  const resolvedList  = []; // [{customer, isNew}] — used for post-broadcast side effects

  for (const name of names) {
    let resolved = fuzzyMatchCustomer(name, [...allCustomers, ...newCustomers], 0.78);
    let isNew = false;

    if (resolved) {
      allCustomers = allCustomers.map(c => c.id === resolved.id ? { ...c, lastContact: now } : c);
    } else {
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
        isNew = true;
        broadcast('customer:created', newCust);
        console.log(`[Diary NLP] ✅ Created customer: "${newCust.name}"`);
      } catch (e) {
        console.error('[Diary NLP] Customer create failed:', e.message);
        continue;
      }
    }

    resolvedList.push({ customer: resolved, isNew });

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

  if (localEntries.length === 0) {
    localEntries.push({
      spokenName: 'General', customerName: 'General', customerId: null,
      matchedCustomerName: null, isNewCustomer: false, date: null,
      notes: actions.length > 0
        ? `General activity logged. Next: ${actions[0]}.`
        : 'No specific customer names detected in this entry.',
      originalNotes: content.slice(0, 400),
      actionItems:   actions,
      sentiment,
      confidence:    0.3,
    });
  }

  // ── Save diary + broadcast IMMEDIATELY so UI updates right away ────────────
  const savedEntry = await updateOne('diary', entryId, {
    status:            'done',
    aiEntries:         localEntries,
    translatedContent: summary,
    detectedLanguage:  lang,
    processedAt:       now,
  });
  broadcast('diary:updated', savedEntry);

  // ── Side effects run in parallel (non-blocking after UI update) ────────────
  const sideEffects = [];

  for (const { customer, isNew } of resolvedList) {
    // 1. Update lastContact + dealValue on existing customers
    if (!isNew) {
      const patch = { lastContact: now };
      if (amount && (!customer.dealValue || amount > customer.dealValue)) {
        patch.dealValue = amount;
      }
      sideEffects.push(updateOne('customers', customer.id, patch).catch(() => {}));
    } else if (amount) {
      sideEffects.push(updateOne('customers', customer.id, { dealValue: amount }).catch(() => {}));
    }

    // 2. Log interaction on customer profile
    const interactionNote = buildInteractionNote(content, sentiment, amount, actions);
    const interaction = {
      id: uuidv4(),
      customerId:  customer.id,
      staffId,
      staffName,
      type:        'diary',
      responded:   true,
      notes:       interactionNote,
      followUpDate: null,
      diaryEntryId: entryId,
      createdAt:   now,
    };
    sideEffects.push(
      insertOne('interactions', interaction)
        .then(() => broadcast('interaction:created', interaction))
        .catch(() => {})
    );

    // 3. Create tasks for detected future-intent phrases
    const detectedTasks = detectTasks(content, customer.name);
    for (const { title, dueDate } of detectedTasks) {
      const task = {
        id: uuidv4(),
        staffId,
        customerId:   customer.id,
        customerName: customer.name,
        title,
        notes:        `Auto-created from diary entry: "${content.slice(0, 120)}${content.length > 120 ? '…' : ''}"`,
        dueDate,
        completed:    false,
        completedAt:  null,
        createdAt:    now,
      };
      sideEffects.push(
        insertOne('tasks', task)
          .then(() => {
            broadcast('task:created', task);
            console.log(`[Diary NLP] 📋 Task created: "${title}" due ${dueDate}`);
          })
          .catch(() => {})
      );
    }
  }

  await Promise.allSettled(sideEffects);

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
