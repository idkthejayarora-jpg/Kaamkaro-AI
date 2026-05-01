const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { updateStaffStreak } = require('../utils/streak');
const { broadcast } = require('../utils/sse');
const { awardMerit } = require('../utils/merits');

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

// Generic honorific/connector tokens (post-normalization) that must never drive name matching.
// e.g. "bhaiya" → "baiya"; "wale" → "wale" — sharing these alone ≠ same person.
const GENERIC_HONORIFIC_NORM = new Set([
  'baiya','baiyya','baia',            // bhaiya variants
  'bai',                              // bhai
  'didi','behan','bababi',            // sister/bhabhi
  'saab','saib',                      // sahab
  'uncle','aunty',
  'wale','wali','waale','waali',      // locative connectors: "X wale bhaiya"
  'vale','vali',
]);

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  const ta = na.split(' ');
  const tb = nb.split(' ');

  // Meaningful tokens: length > 2, not a generic honorific/connector
  const mta = ta.filter(t => t.length > 2 && !GENERIC_HONORIFIC_NORM.has(t));
  const mtb = tb.filter(t => t.length > 2 && !GENERIC_HONORIFIC_NORM.has(t));
  const sharedCount = mta.filter(t => mtb.includes(t)).length;
  const minMeaningful = Math.min(mta.length, mtb.length);

  // KEY RULE: a shared first name alone is NOT enough to call two people the same.
  // "aman jadau" vs "aman canada" → sharedCount=1, minMeaningful=2 → no boost (correct).
  // "aman jadau" vs "aman jadau wala" → sharedCount=2, minMeaningful=2 → boost (correct).
  // "aman" vs "aman jadau" → minMeaningful=1, sharedCount=1 → small boost (correct).
  if (minMeaningful >= 2 && sharedCount >= 2) return 0.9;
  if (minMeaningful === 1 && sharedCount === 1) return 0.82; // single-token name match

  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// ── Task content matcher — semantic word-overlap between diary text and task title ─
// Filters noise (grammar words, verb inflections, connectors) and checks overlap.
// Used to pick the right task when multiple are pending for the same customer.
const TASK_NOISE = new Set([
  // Hindi grammar / connectors
  'ko','ne','se','ka','ki','ke','hai','tha','thi','the','hoga','hogi',
  'kar','karo','karna','karni','karega','karegi','karunga','karungi',
  'kiya','di','diya','de','liya','gaya','gayi','gaye','ho','hona','hone',
  'aaj','kal','parso','wala','wali','abhi','phir','bhi','aur','toh',
  'mein','mai','mujhe','unhe','unko','unka','unki','uska','uski',
  // Completion/future markers (don't drive content matching)
  'karni','hai','thi','tha','karna','karni','karunga','dunga','dungi',
  'milna','milenge','aayenge','karengi','karega',
  // English noise
  'for','and','the','to','a','an','of','in','on','at','by','with','is',
  'was','will','should','would','have','has','been','be',
  // Action verbs (generic — don't distinguish tasks)
  'call','called','calling','done','complete','completed',
]);

function taskContentMatch(diaryText, taskTitle) {
  const words = str => str.toLowerCase()
    .replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !TASK_NOISE.has(w));
  const dWords = new Set(words(diaryText));
  const tWords = words(taskTitle);
  if (tWords.length === 0) return false;
  const overlap = tWords.filter(w => dWords.has(w)).length;
  // Match if ≥2 significant words overlap, or all meaningful words match (short titles)
  return overlap >= 2 || (tWords.length <= 2 && overlap >= 1);
}

function fuzzyMatchCustomer(spokenName, customers, threshold = 0.72) {
  if (!spokenName || !spokenName.trim()) return null;
  const normSpoken = normalizeName(spokenName);
  const spokenTokens = normSpoken.split(' ').filter(t => t.length > 0);
  let best = null, bestScore = 0;

  // ── Party/account number exact match (highest priority) ──────────────────────
  // "Party 1031" spoken → must match stored "Party 1031" exactly on the number
  const spokenPartyNum = spokenName.match(/\b(?:party|account)\s*(\d{3,6})\b/i);
  if (spokenPartyNum) {
    const num = spokenPartyNum[1];
    const exact = customers.find(c => {
      const m = c.name.match(/\b(?:party|account)\s*(\d{3,6})\b/i);
      return m && m[1] === num;
    });
    if (exact) return exact;
    // No exact match → return null (don't fuzzy-match party 1031 to party 1032)
    return null;
  }

  for (const c of customers) {
    let score = nameSimilarity(spokenName, c.name);

    // Boost: extracted name is a prefix of the customer's name
    // e.g. spoken "Bittoo" → stored "Bittoo Fashion Chandigarh"
    const normCust = normalizeName(c.name);
    const custTokens = normCust.split(' ').filter(t => t.length > 0);
    if (normSpoken.length >= 4 && normCust.startsWith(normSpoken)) {
      score = Math.max(score, 0.85);
    }

    const custFirstWord   = custTokens[0]   || '';
    const spokenFirstWord = spokenTokens[0] || '';

    // Boost: first-word match — ONLY when spoken is a single token.
    // Guards against "aman canada" boosting against "aman jadau" on the shared "aman".
    if (spokenTokens.length === 1 && spokenFirstWord.length >= 4 && custFirstWord === spokenFirstWord) {
      score = Math.max(score, 0.80);
    }

    // Boost: spoken name contains customer's first word — ONLY when customer is single-token.
    // e.g. "manish agra wala" spoken, customer stored as just "manish".
    if (custTokens.length === 1 && custFirstWord.length >= 4 && normSpoken.includes(custFirstWord)) {
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
  // Business/action words that appear after names (ne X / ko X) — must NOT be captured as names
  'maal','order','payment','invoice','bill','deal','quote','sample','deliver',
  'confirm','cancel','reject','call','visit','follow','followup','kaam','kaam',
  // Hindi connector/filler words that slip through
  'iska','uska','unka','inhe','unhe','mujhe','hume','tumhe','aapko','apko',
  'isliye','kyunki','lekin','isliye','tabhi','jaise','waise','fir','phir',
  // Common non-name words that look like names
  'total','amount','price','rate','stock','item','unit','piece','box','kilo',
  'today','tomorrow','tonight','weekly','monthly','daily','yearly',
  'ache','theek','thik','sahi','galat','jaldi','late','jald',
  // Short location words (prevent "nagar ne" → "Nagar" as a person)
  'road','marg','lane','gali','bazar','market','chowk','nagar','vihar',
  // Honorifics/relationship words that appear AFTER a name — must NOT be extracted as the name itself
  // "sanjana meerut wale bhaiya ko" → bhaiya is NOT a name anchor; sanjana is
  'bhaiya','bhaia','bhaiyya','bhiya',           // "brother" — very common in North Indian business talk
  'didi','behan','bhabhi',                       // "sister" / "sister-in-law"
  'sahab','saab','sahib',                        // "sir/boss"
  'chacha','mama','nana','taya','fufa',          // family relations used as address
  'uncle','aunty','aunti',
  // Filler/locative connectors — "X wale bhaiya" → "wale" links X to a location, not a name part
  'wale','wali','waale','waali','vale','vali',
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
  // Additional common names
  'harsh','harshvardhan','hemraj','hiralal','hiranand','hariom','harichand',
  'jagannath','jagdamba','jitendra','jitesh','jairam','jaiprakash',
  'keshav','kewal','kishore','kishor','kirpal','krishan',
  'laxman','lalchand','laxmikant','laxminarayan',
  'mahipal','makhan','mangal','manohar','motilal','mukund','murlidhar',
  'narayan','nathuram','navneet','neeraj','nilkamal',
  'parmanand','prabhu','pramod','pravin','puneetram',
  'ramkishan','ramnath','ramprasad','ramnarayan','rampal','ramphal',
  'ramveer','ramvir','randip','ranvir','ratan','ratanlal',
  'sanjiv','satpal','savitri','shamsher','shivnarayan','shivprasad',
  'subodh','sukhdev','sukhvir','surendra','surinder','swaran',
  'trilok','tikaram','tilak',
  'umrao','upender','uttam','udaivir',
  'vinayak','virpal','vishwanath',
  'wasim','wazir',
  // Nicknames & common informal names
  'ansh','anshu','bittu','bittoo','bunty','pinku','rinku','tinku',
  'sunny','rocky','ricky','raja','kundan','inder','devraj','monu',
  'tonu','pappu','chhotu','chotu','golu','gollu','prince','lucky',
  'babloo','chintu','pintu','sonu','ramu','shamu','lalu',
  'guddu','munni','ladli','chanda','sweetu','honey','ruby','pinky',
  'rinki','tinki','kalu','bhura','ganga','jamna','kallu','keshi',
  // ── Female first names ──
  'aarti','aditi','akansha','akanksha','alka','amrita','ananya','anita',
  'anjali','ankita','anushka','aparna','archana','arpita','asha','ashwini',
  'babita','bharati','bindiya','bindu',
  'chanda','chitra','champa','chanchal','chameli','chandrakala',
  'deepa','deepika','disha','divya','dolly','durga','dropadi',
  'ekta',
  'farida','fatima','fulwati',
  'gauri','gayatri','geeta','gita','gulnaar',
  'hema','heena','hina',
  'indira','isha','ishita',
  'jaya','jyoti','jamuna',
  'kajal','kavita','kiran','komal','koshika','krishna','kumari','khushi',
  'kalawati','kamlesh','kamla','kanta','kaushalya',
  'lakshmi','lata','leela','lekha','lucky','lalita',
  'madhuri','mamta','manisha','manju','mansi','maya','meena','meera',
  'minal','monika','muskan',
  'namita','nancy','neelam','neetu','neha','nidhi','nisha','nitu',
  'pallavi','payal','pinky','pooja','poonam','prachi','pragya','prerna',
  'preeti','priya','priyanka','puja',
  'radha','rani','raveena','reena','rekha','ritu','rohini','ruhi','rupa',
  'sarita','savita','seema','shalu','shalini','sheela','shilpa','shweta',
  'simran','smita','sneha','sonia','sonali','swati','sunita','supriya',
  'santoshi','saroj','shanta','shobha','shobhna','sudha','sulochana',
  'tanvi','tara','taruna',
  'usha','urmila',
  'vandana','varsha','vatsala','vidya',
  'yashoda','yogita',
  'zoya','zareen',
  // ── Common Indian surnames ──
  'agarwal','agrawal','ahuja','ansari','arora','agnihotri','ahluwalia','awasthi',
  'bajaj','bansal','basu','bhatia','bhat','bhatt','bose','bajpai','bhargava',
  'bahl','bhola','bisht','bohra','budhiraja',
  'chandra','chauhan','chaudhary','choudhary','chopra','chandel','chawla',
  'das','dave','desai','deshpande','dubey','dutta','dixit','dua',
  'garg','ghosh','gill','goswami','goyal','grewal','gupta','goel','gulati',
  'iyer',
  'jain','jha','joshi','jindal',
  'kapoor','kaur','khan','khanna','krishnan','kumar','khullar',
  'lal',
  'mahajan','malik','malhotra','mehta','menon','mishra','mathur',
  'maheshwari','mangal',
  'nair','naidu','nanda','narang','negi',
  'pandey','patel','patil','pillai','puri',
  'qureshi',
  'rao','rastogi','reddy','roy',
  'sahoo','saxena','sen','seth','shah','sharma','shukla','singh','sinha',
  'srivastava','soni','sachdev','saluja','samra','sawhney','sood',
  'thakur','tiwari','trivedi','thakral','trehan',
  'uppal',
  'varma','verma','vyas',
  'yadav',
]);

// ── Foreign / international names (common among non-Indian customers) ─────────
// Needed because voice is all-lowercase and these won't appear in INDIAN_NAMES.
const FOREIGN_NAMES = new Set([
  // Western male
  'alex','alexander','adam','andrew','anthony','austin',
  'brian','brandon','ben','benjamin','bob','brad','brett','bruce',
  'charles','chris','christian','christopher','craig','colin',
  'daniel','david','dennis','derek','donald','douglas','dylan',
  'edward','eric','ethan','evan',
  'frank','fred','frederick',
  'gary','george','greg','gregory',
  'henry','howard',
  'ian','ivan',
  'jack','jacob','james','jason','jeff','jeffrey','jeremy','john','jonathan',
  'joseph','josh','joshua','justin',
  'kevin','keith','kenneth','kyle',
  'larry','lawrence','lee','leonard','lewis','liam','louis','luke',
  'mark','martin','matthew','michael','mike','mitchell',
  'nathan','nicholas','nick','noah',
  'oliver','oscar',
  'patrick','paul','peter','philip',
  'richard','robert','roger','ron','ronald','ross','ryan',
  'sam','samuel','scott','sean','simon','stephen','steve','steven',
  'thomas','tim','timothy','tom','tony','tyler',
  'victor','vincent',
  'walter','warren','wayne','william',
  'zachary',
  // Western female
  'alice','amanda','amy','angela','anna','ashley',
  'barbara','betty','brittany',
  'carol','carolyn','catherine','charlotte','cheryl','christina','christine',
  'deborah','debra','diana','donna','dorothy',
  'elizabeth','emily','emma',
  'frances','grace',
  'hannah','helen','heather','holly','isabella',
  'jane','janet','jennifer','jessica','joyce','julia','julie',
  'karen','katherine','kathryn','kelly','kim','kimberly',
  'laura','lauren','linda','lisa','lori','lucy',
  'margaret','maria','marie','marilyn','mary','melissa','michelle','morgan',
  'nancy','natalie','nicole','olivia',
  'pamela','patricia','paula',
  'rachel','rebecca','rose','ruth',
  'sarah','sandra','sara','sharon','stephanie','susan',
  'teresa','theresa','victoria',
  // Middle Eastern
  'amir','hassan','hussain','ibrahim','ismail','kareem','khalid',
  'mohammed','muhammad','mustafa','omar','tariq','youssef',
  'layla','noor','zainab',
  // East / Southeast Asian
  'wei','lei','ming','ying','jian','xiao','lin',
  'nguyen','tran','pham','le','vo',
  'chen','wong','tang','lim',
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
  // ── International / foreign locations (customers abroad or from abroad) ────
  'canada','toronto','vancouver','montreal','calgary','ottawa','edmonton',
  'usa','america','newyork','new york','losangeles','los angeles','chicago',
  'houston','dallas','seattle','boston','miami','sanfrancisco','san francisco',
  'uk','london','manchester','birmingham','leeds','glasgow',
  'australia','sydney','melbourne','brisbane','perth','adelaide',
  'dubai','abudhabi','abu dhabi','sharjah','ajman','uae',
  'singapore','malaysia','kualalumpur','kuala lumpur',
  'canada','newzealand','new zealand','ireland','netherlands',
  'germany','berlin','munich','frankfurt',
  'france','paris',
  'italy','rome','milan',
  'spain','madrid','barcelona',
  'nepal','kathmandu','pokhara',
  'bangladesh','dhaka','chittagong',
  'srilanka','colombo',
  'pakistan','karachi','lahore','islamabad',
  'africa','kenya','nairobi','nigeria','lagos',
  'gulf','bahrain','kuwait','oman','qatar','riyadh','jeddah',
  'muscat','doha','manama',
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
/**
 * Transliterate Devanagari Unicode characters → approximate Latin/Roman equivalents.
 * Chrome's hi-IN voice recognition returns pure Devanagari script. Without this step,
 * `replace(/[^\w\s]/g, ' ')` silently strips every Devanagari character, leaving
 * no tokens to match against the name dictionaries.
 *
 * This is a best-effort transliteration — enough to produce recognisable Roman
 * approximations of Indian names (अमित → amit, सोनिया → soniya, etc.).
 */
/**
 * Transliterate Devanagari → Roman with correct inherent-vowel handling.
 *
 * Root cause of "Mneeesh Jypur": the old code mapped consonants directly to bare
 * Roman forms (म→m, न→n) without adding the inherent 'a' vowel every Devanagari
 * consonant carries. Correct rule: each consonant has an implicit 'a' UNLESS the
 * next character is a matra (dependent vowel sign), a virama (् suppresses vowel),
 * or a word boundary (final consonant in Hindi names is typically silent).
 *
 *  मनीष → m(a)n+ī+ṣ → maneesh  (fuzzy-normalises to "manis" = "manish" ✓)
 *  जयपुर → j(a)y(a)p+u+r  → jayapur  (close enough to "jaipur" for fuzzy match ✓)
 *  राहुल → r+ā+h+u+l      → raahul   (normalises aa→a → "rahul" ✓)
 */
function devanagariToRoman(text) {
  if (!/[\u0900-\u097F]/.test(text)) return text; // fast-path: no Devanagari present

  // Conjuncts — must be checked BEFORE individual consonants (longest-match)
  const CONJUNCTS = [['क्ष','ksh'],['त्र','tr'],['ज्ञ','gya']];

  // Single consonants → bare Roman (inherent 'a' is added algorithmically)
  const CONSONANTS = new Map([
    ['क','k'],['ख','kh'],['ग','g'],['घ','gh'],['ङ','ng'],
    ['च','ch'],['छ','chh'],['ज','j'],['झ','jh'],['ञ','ny'],
    ['ट','t'],['ठ','th'],['ड','d'],['ढ','dh'],['ण','n'],
    ['त','t'],['थ','th'],['द','d'],['ध','dh'],['न','n'],
    ['प','p'],['फ','ph'],['ब','b'],['भ','bh'],['म','m'],
    ['य','y'],['र','r'],['ल','l'],['ळ','l'],['व','v'],
    ['श','sh'],['ष','sh'],['स','s'],['ह','h'],
    // Nukta variants (may appear as 2-char sequence: base + ़ U+093C)
    ['ड़','r'],['ढ़','rh'],['फ़','f'],['ज़','z'],['क़','q'],['ख़','kh'],['ग़','gh'],
  ]);

  // Dependent vowel signs (matras) — cancel the consonant's inherent 'a' and
  // supply their own vowel
  const MATRAS = new Map([
    ['ा','a'],['ि','i'],['ी','ee'],['ु','u'],['ू','oo'],
    ['ृ','ri'],['े','e'],['ै','ai'],['ो','o'],['ौ','au'],
    ['ं','n'],['ः','h'],['ँ','n'],
    // ── English-loanword matras (Chrome hi-IN uses these for transliterated words)
    ['\u0949','o'],  // ॉ short-O — कॉल (call), डॉक्टर (doctor), ऑर्डर (order)
    ['\u0945','e'],  // ॅ short-E — rare but present in some loanwords
  ]);

  // Independent vowels (check 2-char entries first)
  const IND_VOWELS_2 = [['अं','an'],['अः','ah']];
  const IND_VOWELS_1 = new Map([
    ['अ','a'],['आ','aa'],['इ','i'],['ई','ee'],['उ','u'],['ऊ','oo'],
    ['ऋ','ri'],['ए','e'],['ऐ','ai'],['ओ','o'],['औ','au'],
    // ── English-loanword independent vowels ──
    ['ऑ','o'],   // U+0911 short-O — ऑर्डर (order), ऑफिस (office)
    ['ऎ','e'],   // U+090E short-E (rare)
    ['ऒ','o'],   // U+0912 short-O alternate (rare)
  ]);

  const VIRAMA = '्'; // U+094D — halant, suppresses inherent 'a'

  let result = '';
  let i = 0;
  let pendingA = false; // true when last consonant has an unprovided inherent 'a'

  const flushA = () => { if (pendingA) { result += 'a'; pendingA = false; } };

  while (i < text.length) {
    // ── Virama: suppress the pending inherent 'a' ─────────────────────────────
    if (text[i] === VIRAMA) { pendingA = false; i++; continue; }

    // ── Conjuncts (multi-char, checked before single consonants) ──────────────
    let found = false;
    for (const [src, tgt] of CONJUNCTS) {
      if (text.startsWith(src, i)) {
        flushA(); result += tgt; pendingA = true; i += src.length; found = true; break;
      }
    }
    if (found) continue;

    // ── 2-char nukta consonants ──────────────────────────────────────────────
    for (const [src, tgt] of CONSONANTS) {
      if (src.length === 2 && text.startsWith(src, i)) {
        flushA(); result += tgt; pendingA = true; i += src.length; found = true; break;
      }
    }
    if (found) continue;

    // ── Single consonant ──────────────────────────────────────────────────────
    if (CONSONANTS.has(text[i])) {
      flushA(); result += CONSONANTS.get(text[i]); pendingA = true; i++; continue;
    }

    // ── Matra: replaces inherent 'a', no flushA needed ───────────────────────
    if (MATRAS.has(text[i])) {
      pendingA = false; result += MATRAS.get(text[i]); i++; continue;
    }

    // ── Independent vowels (2-char first) ────────────────────────────────────
    found = false;
    for (const [src, tgt] of IND_VOWELS_2) {
      if (text.startsWith(src, i)) {
        flushA(); result += tgt; pendingA = false; i += src.length; found = true; break;
      }
    }
    if (found) continue;
    if (IND_VOWELS_1.has(text[i])) {
      flushA(); result += IND_VOWELS_1.get(text[i]); pendingA = false; i++; continue;
    }

    // ── Danda / special Devanagari punctuation ────────────────────────────────
    if (text[i] === '।' || text[i] === '॥') {
      pendingA = false; result += ' '; i++; continue; // word boundary: suppress final 'a'
    }

    // ── Non-Devanagari character (space, digit, Roman letter, punctuation) ────
    // At a word boundary (space / punctuation) suppress the trailing inherent 'a'
    // because final consonants in spoken Hindi names are typically silent.
    if (/[\s.,!?;:\-"'()[\]{}]/.test(text[i])) {
      pendingA = false; // suppress at word boundary
    } else {
      flushA(); // mid-word non-Devanagari: emit pending 'a' before it
    }
    result += text[i]; i++;
  }
  // End of string: suppress trailing inherent 'a' (silent final consonant)
  // pendingA is intentionally NOT flushed here

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extract person/customer names from diary text.
 *
 * Customer name format used by this team: "person [surname] [place]"
 * e.g. "Manish Agra", "Mohit Lajpat Nagar", "Ansh Chauhan Kolkata",
 *      "Bittoo Fashion Chandigarh" — name combinations can be anything.
 *
 * Works for BOTH typed text (proper casing) AND voice transcriptions (all lowercase).
 * Also handles Devanagari script from Chrome hi-IN voice recognition via devanagariToRoman().
 *
 * Four passes — best to worst confidence:
 *   1. Location-anchored — finds ANY words before a known city (no dict needed)
 *   2. INDIAN_NAMES dict scan — for names without a city suffix
 *   3. Context patterns — name near action word / Hindi postposition
 *   4. Capitalised words fallback — typed text only
 */
function extractNamesFromText(text) {
  // Pre-process: transliterate Devanagari → Roman so voice (hi-IN) input is parseable
  text = devanagariToRoman(text);
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
    // Reject if any alphabetic word is a stop word (skip this check for numeric tokens like "1001")
    if (parts.some(p => /^[a-z]+$/.test(p) && STOP_WORDS.has(p))) return;
    const name = titleCase(parts.join(' '));
    // Key: use raw lowercase parts (not normalizeName) so "1001 Canada" and "1002 Canada"
    // don't collapse to the same key (normalizeName strips digits → both become "canada")
    const key = parts.join(' ');
    if (!key || key.length < 2) return;
    // Extra guard: reject keys that are purely numeric (bare numbers aren't customer names)
    if (/^\d+$/.test(key)) return;
    if (!found.has(key)) found.set(key, name);
  };

  // ── Pass 0: Party / account numbers ─────────────────────────────────────────
  // Handles customers stored as "Party 1031", "Party 3072", etc.
  // Voice: "party 1031 ne payment diya", "party number 3072 ka maal"
  // Written: "party1031", "P-3072", "account 1031"
  {
    const partyRe = /\b(?:party|account|parchi|khata|dealer|firm|no\.?|number|#)\s*[-–]?\s*(\d{3,6})\b/gi;
    let pm;
    while ((pm = partyRe.exec(text)) !== null) {
      addName(`Party ${pm[1]}`);
    }
    // Also catch bare "1031" when preceded/followed by party-signal words in same sentence
    const bareRe = /\bparty\s+(\d{3,6})\b|\b(\d{3,6})\s+(?:wala|ka|ki|ke|ne|ko)\b/gi;
    while ((pm = bareRe.exec(text)) !== null) {
      const num = pm[1] || pm[2];
      if (num) addName(`Party ${num}`);
    }
  }

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

    // Look back up to 4 words for the name (stop at stop words or short words)
    // 4 allows "Bittoo Fashion House Chandigarh" (3 name tokens before city)
    // Numeric tokens (e.g. "1001") are allowed — they form part of the customer ID
    const nameTokens = [];
    for (let k = i - 1; k >= 0 && i - k <= 4; k--) {
      const w = tokens[k];
      const isNumeric = /^\d+$/.test(w);
      if (FILLER.has(w)) break;
      if (!isNumeric && (STOP_WORDS.has(w) || w.length < 3)) break;
      nameTokens.unshift(w);
    }

    if (nameTokens.length > 0) {
      // Full customer name = person name + location
      const locParts = locLabel.split(' ');
      addName([...nameTokens, ...locParts].join(' '));
    }

    i += locWords - 1; // skip location tokens on next iterations
  }

  // ── Pass 2: INDIAN_NAMES + FOREIGN_NAMES dict scan ───────────────────────────
  //
  // Handles Indian names (rahul, priya, sharma) AND foreign names (alex, john, david)
  // for voice text where all letters are lowercase.
  //
  const ALL_NAMES = (t) => INDIAN_NAMES.has(t) || FOREIGN_NAMES.has(t);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!ALL_NAMES(t)) continue;

    const parts = [t];
    let j = i + 1;

    // Consume optional surname (next token also in known names)
    if (j < tokens.length && ALL_NAMES(tokens[j]) && !STOP_WORDS.has(tokens[j])) {
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
  //
  // ROOT CAUSE FIX: removed the `isValid` gate that required names to be in
  // INDIAN_NAMES or capitalized in original text. Voice transcriptions are ALL
  // LOWERCASE so the capitalized check always failed, and names absent from the
  // ~300-word dictionary were silently dropped — causing ~5% accuracy.
  //
  // Now we trust the GRAMMATICAL CONTEXT (postpositions, action verbs, honorifics)
  // as the signal, and rely on STOP_WORDS to filter false positives.
  // The only remaining guard: reject purely-location captures ("delhi ne" ≠ a person).
  //
  const ctxPatterns = [
    // Hindi postpositions — strongest signal in Hinglish: "rahul ne", "deepak ko", "priya se"
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,3})\s+(?:ne|ko|se)\b/gi,
    // "mila X" / "mile X" — "aaj mila deepak se" captures "deepak"
    /(?:mila|mile|milaa|milne|milke)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,3})/gi,
    // Action verbs before name: "called rahul", "met priya agra", "baat ki manish se"
    /(?:called|met|meeting\s+with|visited|contacted|spoke(?:\s+with)?|talked(?:\s+to)?|baat\s+(?:ki|kiya|hui)|phoned|texted|messaged|milne?\s+gaya|milne?\s+aaya)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,3})/gi,
    // "X ke saath" / "X ke paas" — "deepak ke saath meeting" → deepak
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,3})\s+ke\s+(?:saath|paas|yahan|wahan|office|dukaan|ghar)\b/gi,
    // Honorifics after name: "rahul ji", "sharma sahab", "mohit bhai"
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})\s+(?:ji|sahab|saab|bhai|didi|madam|sir)\b/gi,
    // Possessive + business noun: "rahul ka order", "priya ki payment", "deepak ke kaam"
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,3})\s+(?:ka|ki|ke)\s+(?:order|payment|bill|deal|number|phone|call|meeting|kaam|maal|sample|visit|followup|follow|invoice|quotation|parcel|delivery|advance|balance)/gi,
    // Title prefix
    /(?:Mr|Mrs|Ms|Dr|Shri|Smt|Sri)\.?\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})/gi,
    // "customer/party/dealer X": "customer ramesh", "dealer sunil agra"
    /(?:customer|client|party|buyer|prospect|dealer|party)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,3})/gi,
    // Extended verb phrases: "X ne maal liya", "X ko call kiya", "X ka invoice"
    /\b([a-zA-Z]{4,}(?:\s+[a-zA-Z]{3,}){0,2})\s+(?:ne\s+(?:bataya|kaha|manga|diya|liya|bola|confirm|cancel|reject|call|maal|order|mana|agree|refuse)|ko\s+(?:diya|bheja|call|quote|maal|deliver|bataya|samjhaya)|ka\s+(?:maal|order|payment|bill|deal|invoice|parcel|advance))/gi,
  ];

  for (const pattern of ctxPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const candidate = m[1].trim();
      const parts = candidate.toLowerCase().split(/\s+/);
      // Reject if any part is a stop word or too short
      if (!parts.every(p => p.length >= 3 && !STOP_WORDS.has(p))) continue;
      // Reject purely-location captures ("delhi ne" → "Delhi" is not a person name)
      if (parts.every(p => INDIAN_LOCATIONS.has(p))) continue;
      addName(candidate);
    }
  }

  // ── Pass 4: Capitalised bigrams / single words (typed text fallback) ─────────
  (text.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) || []).forEach(n => addName(n));

  if (found.size === 0) {
    // Last resort: any single capitalised word (typed text only)
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
 * Covers English, Hindi, and Hinglish future-intent phrases.
 */
function extractActionItemsLocal(text) {
  const checks = [
    // Video call
    { r: /video\s*call/i,                                    a: 'Video call with customer'  },
    // Follow-up (English + Hindi)
    { r: /follow.?up|followup|follow\s+karna|follow\s+karunga|follow\s+karenge/i, a: 'Follow up with customer' },
    // Quote / proposal / send
    { r: /(?:send|quote|proposal|estimate|quotation|bhej|bhejunga|bhejenge|bhejna\s+hai)/i, a: 'Send quote/proposal' },
    // Call back (English + Hindi future)
    { r: /(?:call\s+back|callback|phone\s+back|ring|call\s+karna\s+hai|call\s+karunga|call\s+karenge|wapas\s+call)/i, a: 'Call back customer' },
    // Meeting / visit
    { r: /(?:schedule|appointment|milenge|milna\s+hai|meeting\s+karni|meeting\s+hai|milne\s+aana|milne\s+aaunga)/i, a: 'Schedule meeting' },
    // Payment follow-up
    { r: /(?:payment|invoice|bill|dues|baaki|paise\s+lene|paisa\s+lena|paisa\s+milega|payment\s+aana)/i, a: 'Follow up on payment' },
    { r: /(?:demo|demonstration|presentation|dikhana|dikhaunga|dikha\s+dunga)/i, a: 'Arrange product demo' },
    { r: /(?:deliver|delivery|dispatch|courier|bhejna|maal\s+bhejunga|parcel\s+bhejunga)/i, a: 'Arrange delivery' },
    // Sample
    { r: /(?:sample|sampal)\s+(?:bhejna|bhejunga|dena|dunga|bhejenge)/i, a: 'Send sample' },
    // Collect advance
    { r: /(?:advance|advanss)\s+(?:lena|lenge|milega|chahiye)/i,          a: 'Collect advance payment' },
    // Parcel dispatch
    { r: /(?:parcel|parsal)\s+(?:nikalana|nikalna|bhejna|bhejunga)/i,     a: 'Dispatch parcel' },
  ];
  return [...new Set(checks.filter(c => c.r.test(text)).map(c => c.a))].slice(0, 5);
}

/**
 * Build a structured English summary from the extracted NLP data.
 * This is shown as "English Summary" in the UI when no AI translation is available.
 */
function buildEnglishSummary(names, lang, sentiment, actions, staffName) {
  // Return clean context — no meta-text like "recorded in Hindi by..."
  const parts = [];

  if (names.length > 0) {
    parts.push(`Interacted with: ${names.join(', ')}.`);
  }

  if (sentiment === 'positive') {
    parts.push('Positive outcome.');
  } else if (sentiment === 'negative') {
    parts.push('Challenges or objections noted.');
  }

  if (actions.length > 0) {
    parts.push(`Next steps: ${actions.join('; ')}.`);
  }

  return parts.length > 0 ? parts.join(' ') : 'Interaction logged.';
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

// PATCH /api/diary/:id — edit content and/or customer links
router.patch('/:id', async (req, res) => {
  try {
    const entries = await readDB('diary');
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && entry.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { content, aiEntries, reanalyze } = req.body;
    const patch = {};
    if (typeof content === 'string' && content.trim()) patch.content = content.trim();
    if (Array.isArray(aiEntries)) patch.aiEntries = aiEntries;

    await updateOne('diary', req.params.id, patch);
    broadcast('diary:updated', { ...entry, ...patch });
    res.json({ ...entry, ...patch });

    // Optional re-analysis on updated content
    if (reanalyze) {
      await updateOne('diary', req.params.id, { status: 'processing', aiEntries: [], translatedContent: null, detectedLanguage: null, error: null });
      broadcast('diary:updated', { ...entry, ...patch, status: 'processing', aiEntries: [] });
      processDiaryEntry(req.params.id, patch.content || entry.content, entry.staffId, entry.staffName).catch(console.error);
    }
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

/** If a computed due-date lands on Sunday (day 0), push it to Monday. */
function skipSunday(dt) {
  if (dt.getDay() === 0) dt.setDate(dt.getDate() + 1); // Sunday → Monday
  return dt;
}

/**
 * Parse a due date from diary text.
 * Handles: kal/tomorrow, parso/day after tomorrow, aaj/today, next week, agle hafte.
 * Falls back to tomorrow if a future-intent phrase is found but no date is specified.
 * Sundays are automatically bumped to Monday (non-working day).
 */
function parseDueDateFromText(text) {
  const lower = text.toLowerCase();
  const d = new Date();
  const fmt = (dt) => skipSunday(dt).toISOString().split('T')[0];

  // ── N-unit patterns (highest priority — most specific) ──────────────────────
  // "2 din baad/mein", "do din baad", "3 dino mein"
  let m = lower.match(/(\d+)\s*din\s*(?:mein|baad|ke\s*andar|me\b)/);
  if (!m) m = lower.match(/\b(ek)\s*din\s*(?:mein|baad)/); // ek din = 1 day
  if (m) {
    const n = m[1] === 'ek' ? 1 : parseInt(m[1], 10);
    if (n > 0 && n <= 365) { d.setDate(d.getDate() + n); return fmt(d); }
  }
  // "2 hafte baad/mein", "ek hafte mein", "do hafte mein"
  m = lower.match(/(\d+)\s*hafte?\s*(?:mein|baad|ke\s*andar|me\b)/);
  if (!m) m = lower.match(/\b(ek|do|teen)\s*hafte?\s*(?:mein|baad)/);
  if (m) {
    const wordMap = { ek: 1, do: 2, teen: 3 };
    const n = wordMap[m[1]] !== undefined ? wordMap[m[1]] : parseInt(m[1], 10);
    if (n > 0 && n <= 52) { d.setDate(d.getDate() + n * 7); return fmt(d); }
  }
  // "2 mahine baad/mein", "agle 2 mahine mein", "ek mahine mein"
  m = lower.match(/(\d+)\s*mahine?\s*(?:mein|baad|ke\s*andar|me\b)/);
  if (!m) m = lower.match(/agle\s+(\d+)\s*mahine?\b/);
  if (!m) m = lower.match(/\b(ek|do|teen|char)\s*mahine?\s*(?:mein|baad)/);
  if (m) {
    const wordMap = { ek: 1, do: 2, teen: 3, char: 4 };
    const n = wordMap[m[1]] !== undefined ? wordMap[m[1]] : parseInt(m[1], 10);
    if (n > 0 && n <= 12) { d.setDate(d.getDate() + n * 30); return fmt(d); }
  }
  // "2 weeks baad", "3 weeks mein", "in 2 days", "in 3 weeks"
  m = lower.match(/(?:in\s+)?(\d+)\s*weeks?\s*(?:baad|mein|later)?/);
  if (m && !lower.match(/last\s+\d+\s*week/)) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 52) { d.setDate(d.getDate() + n * 7); return fmt(d); }
  }
  m = lower.match(/(?:in\s+)?(\d+)\s*days?\s*(?:baad|mein|later)?/);
  if (m && !lower.match(/last\s+\d+\s*day/)) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 365) { d.setDate(d.getDate() + n); return fmt(d); }
  }

  // ── Named near-future markers ──────────────────────────────────────────────
  if (/\bparso\b|\bparson\b|\bday after tomorrow\b/.test(lower)) { d.setDate(d.getDate() + 2); return fmt(d); }
  if (/\bkal\b|\btomorrow\b/.test(lower))                        { d.setDate(d.getDate() + 1); return fmt(d); }
  // "aaj" or shorthand "aj"; "shaam ko" / "shamko" / "sham ko" = this evening = today
  if (/\baaj\b|\baj\b|\btoday\b|\bshaam\s*ko\b|\bshamko\b|\bsham\s*ko\b|\bevening\b|\babhi\b|\bsubah\b/.test(lower)) { return fmt(d); }

  // ── End of this week ────────────────────────────────────────────────────────
  if (/(?:is\s*hafte|this\s*week)\s*(?:ke\s*)?(?:end|akhir|ant)\b/.test(lower) ||
      /\bweekend\b/.test(lower)) {
    // Move to nearest Saturday (day 6)
    const daysToSat = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysToSat);
    return fmt(d);
  }

  // ── End of this month ────────────────────────────────────────────────────────
  if (/(?:is\s*mahine|this\s*month)\s*(?:ke\s*)?(?:end|akhir|ant)\b/.test(lower) ||
      /\bend\s*of\s*(?:this\s*)?month\b/.test(lower) ||
      /\bmonth\s*end\b/.test(lower) ||
      /\bmahine\s*(?:ke\s*)?(?:end|akhir)\b/.test(lower)) {
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return fmt(lastDay);
  }

  // ── This week / next week ────────────────────────────────────────────────────
  if (/\bis\s*hafte\b/.test(lower)) { d.setDate(d.getDate() + 5); return fmt(d); }
  if (/\bnext\s*week\b|\bagle\s*hafte\b/.test(lower)) { d.setDate(d.getDate() + 7); return fmt(d); }

  // ── Next month (various forms) ────────────────────────────────────────────────
  if (/\bnext\s*month\b|\bagle\s*mahine\b|\bagle\s*month\b/.test(lower) ||
      /\baayenge\b.{0,30}\bmahine\b/.test(lower) ||
      /\bmahine\b.{0,30}\baayenge\b/.test(lower)) {
    d.setDate(d.getDate() + 30);
    return fmt(d);
  }

  // ── Next quarter ─────────────────────────────────────────────────────────────
  if (/\bnext\s*quarter\b|\bagle\s*quarter\b/.test(lower)) {
    d.setDate(d.getDate() + 90);
    return fmt(d);
  }

  // ── Generic future intent → default to tomorrow ───────────────────────────────
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
  const cName = customerName || 'Customer';

  // ── Pattern groups — each group fires at most once ──────────────────────────
  // Patterns within a group are OR'd. First match wins.
  // Each group covers: standard spelling, common typos, Hinglish variants,
  // masculine AND feminine verb forms (karna/karni, lena/leni, dena/deni).
  const groups = [
    // ── Photo / image ──────────────────────────────────────────────────────────
    // "photo karni hai", "photo bhejni hai", "foto dalna", "pic bhejo", "tasveer leni"
    {
      r: /\b(?:photo|photu|phot|foto|fotu|image|img|pic|pics|tasveer|tasvir|tassveer|snap|snapshot|screenshot|screen\s*shot|screenshoot|screenshut)\b/i,
      t: `Send photo to ${cName}`,
    },

    // ── Video call ─────────────────────────────────────────────────────────────
    // "video call karni hai", "vc karna", "zoom call", "video kol", "video kon"
    {
      r: /\b(?:video\s*call|video\s*kol|video\s*kon|video\s*kal|vc\b|zoom\s*call|zoom\s*meeting|google\s*meet|gmeet|whatsapp\s*video|video\s*chat|video\s*karni|video\s*karna)\b/i,
      t: `Video call with ${cName}`,
    },

    // ── Call / phone ───────────────────────────────────────────────────────────
    // "call karna hai", "phone karunga", "ring karega", "baat karni hai", "fon karna"
    {
      r: /\b(?:call\s*back|call\s*karega|call\s*karein|call\s*karna|call\s*karunga|call\s*karenge|call\s*kar\s*dunga|call\s*kar\s*denge|call\s*kar\s*lunga|call\s*kar\s*lenge|call\s*karo|call\s*karna\s*hai|call\s*karna\s*padega|call\s*karna\s*padegi|will\s*call|call\s*karte\s*hain|call\s*lagana|call\s*lagaunga|call\s*lagayenge|call\s*lagani\s*hai|call\s*dena|call\s*marna|phone\s*karega|phone\s*karna|phone\s*karunga|phone\s*karenge|phone\s*kar\s*dunga|phone\s*karo|phone\s*karna\s*hai|phone\s*lagana|phone\s*lagaunga|phone\s*lagani\s*hai|fon\s*karna|fon\s*karunga|fon\s*karenge|fon\s*lagana|fon\s*lagaunga|fon\s*lagani\s*hai|ring\s*karega|ring\s*karna|ring\s*karunga|ring\s*lagana|ring\s*lagaunga|contact\s*karna|contact\s*karunga|contact\s*karenge|baat\s*karni\s*hai|baat\s*karna\s*hai|baat\s*karenge|baat\s*karunga|baat\s*kar\s*dunga|baat\s*karo|phon\s*karna|phon\s*karunga|call\s*aayegi|call\s*aayega)\b/i,
      t: `Call ${cName}`,
    },

    // ── Meeting / visit / "will come" ──────────────────────────────────────────
    // "milenge", "milna hai", "meeting hai", "visit karunga", "aaunga", "bulaunga"
    {
      r: /\b(?:milenge|milna\s*hai|milne\s*ka\s*plan|milne\s*ka\s*socha|meeting|meating|meetin|miting|appointment|milne\s*aaunga|milne\s*ayenge|milne\s*aayenge|milne\s*jaaunga|milne\s*aate\s*hain|milne\s*wala|milne\s*wali|milne\s*ka\s*irada|milna\s*chahta|milna\s*chahti|milna\s*chahte|aana\s*chahta|aana\s*chahti|aana\s*chahte|aaunga|aayenge|aa\s*jayenge|aa\s*jaunga|aa\s*jaoonga|aane\s*wale\s*hain|aane\s*wala\s*hai|aane\s*wali\s*hai|will\s*meet|will\s*come|visit\s*karunga|visit\s*karenge|visit\s*karna|visit\s*karna\s*hai|will\s*visit|bulaunga|bulayenge|bulana\s*hai|invite\s*karna|invite\s*karunga|office\s*aana|ghar\s*aana|dukaan\s*aana|aa\s*jana|aa\s*jao|aaoge|aaogi|pahunga|pahunche\s*hain|pahunchna\s*hai)\b/i,
      t: `Meeting with ${cName}`,
    },

    // ── Quote / proposal / send ────────────────────────────────────────────────
    // "quote bhejunga", "rate list dena", "catalogue send karna", "bhej dunga"
    {
      r: /\b(?:quote|quotation|kwotation|proposal|proposel|proposel|estimate|estimat|rate\s*list|rate\s*bhejunga|rate\s*bhejenge|rate\s*dena|rate\s*bataunga|rate\s*batayenge|catalogue|catalog|catlog|brochure|broshure|bhejunga|bhejenge|bhej\s*dunga|bhej\s*denge|bhej\s*lunga|bhej\s*lenge|bhejega|bhejna\s*hai|bhejna\s*padega|bhejni\s*hai|bhejni\s*padegi|will\s*send|send\s*karunga|send\s*karenge|send\s*kar\s*dunga|send\s*kar\s*denge|send\s*karna\s*hai|message\s*karunga|message\s*karenge|message\s*karna\s*hai|whatsapp\s*karunga|whatsapp\s*karenge|whatsapp\s*karna\s*hai|share\s*kar\s*dunga|share\s*kar\s*denge|share\s*karunga|share\s*karenge|forward\s*karunga|forward\s*karenge|details\s*bhejunga|info\s*bhejunga|link\s*bhejunga)\b/i,
      t: `Send quote to ${cName}`,
    },

    // ── Payment / dues / invoice follow-up ────────────────────────────────────
    // "payment lena", "paisa pending", "baaki hai", "udhar lena", "invoice bhejna"
    {
      r: /\b(?:payment|payement|peyment|paymant|invoice|invoce|invois|bill|baaki|baki|baqi|dues|due\s*hai|paisa\s*lena|paise\s*lena|paisa\s*lene|paise\s*lene|payment\s*lena|payment\s*leni|payment\s*ka|payment\s*pending|payment\s*aana|paisa\s*pending|paisa\s*aana|paisa\s*milega|baaki\s*hai|baki\s*hai|baqi\s*hai|udhar|udhaar|udhar\s*lena|udhar\s*wapas|paise\s*wapas|paisa\s*wapas|amount\s*lena|amount\s*pending|payment\s*follow|paise\s*nikalne|paisa\s*nikalna|recovery|rikwari|ricovery|paise\s*le\s*lena|paisa\s*le\s*lena)\b/i,
      t: `Follow up on payment — ${cName}`,
    },

    // ── Delivery / dispatch ────────────────────────────────────────────────────
    // "maal bhejna hai", "deliver karunga", "parcel nikalna", "dispatch karna"
    {
      r: /\b(?:deliver|deliveri|diliver|dispatch|dispach|disptach|courier|couriear|maal\s*bhejunga|maal\s*bhejenge|maal\s*bhejna\s*hai|maal\s*bhejni\s*hai|maal\s*nikalna|maal\s*nikalne|maal\s*ready|mal\s*bhejega|mal\s*bhejna|will\s*deliver|deliver\s*karunga|deliver\s*karenge|deliver\s*karna\s*hai|delivery\s*karni\s*hai|bhijwana|bhijwaunga|bhijwayenge|nikalna\s*hai|nikalne\s*wala|nikalne\s*wali|parcel\s*nikalna|parcel\s*bhejna|parcel\s*bhejunga|parcel\s*bhejenge|parcel\s*karna|shipment|shipmant|goods\s*ready|order\s*nikalna|maal\s*bhejna\s*padega|maal\s*bhejna\s*padegi)\b/i,
      t: `Arrange delivery for ${cName}`,
    },

    // ── Sample / demo / product show ──────────────────────────────────────────
    // "sample bhejunga", "demo dikhaunga", "collection dikhana", "new design batana"
    {
      r: /\b(?:sample|sampal|sampel|semple|demo|demonstrashun|demonstration|dikhaunga|dikhayenge|dikhana\s*hai|dikhani\s*hai|dikhana\s*padega|dikhani\s*padegi|will\s*show|show\s*karunga|show\s*karenge|show\s*karna\s*hai|dikha\s*dunga|dikha\s*denge|dikha\s*lunga|dikha\s*lenge|product\s*dikhana|new\s*design|collection\s*dikhana|design\s*dikhana|sample\s*dena|sample\s*dunga|sample\s*bhejunga|sample\s*bhejenge|trial|trayal|test\s*karana)\b/i,
      t: `Product demo for ${cName}`,
    },

    // ── Confirm / finalize / book ─────────────────────────────────────────────
    // "confirm karna hai", "order pakka karna", "deal final karna", "booking karni"
    {
      r: /\b(?:confirm\s*karna\s*hai|confirm\s*karni\s*hai|confirm\s*karunga|confirm\s*karenge|confirm\s*kar\s*dunga|confirm\s*karwana|order\s*confirm|deal\s*confirm|finalize|finalise|final\s*karna|pakka\s*karna|pakka\s*karna\s*hai|pakka\s*karni\s*hai|pakka\s*karunga|pakka\s*karenge|pakka\s*ho\s*jayega|deal\s*pakka|deal\s*final|deal\s*pakki|order\s*pakka|book\s*karna|book\s*karunga|book\s*karenge|booking\s*karni|booking\s*karna|agree\s*karna|fix\s*karna|lock\s*karna|deal\s*lock|deal\s*done|seal\s*karna)\b/i,
      t: `Confirm order with ${cName}`,
    },

    // ── Reminder / explicit follow-up ─────────────────────────────────────────
    // "follow up karna", "reminder set karna", "yaad rakhna", "track karna"
    {
      r: /\b(?:follow.?up|followup|f\.?u\b|reminder|riminder|yaad\s*rakhna|yaad\s*dilana|yaad\s*dilani|remind\s*karna|remind\s*karunga|dhyan\s*rakhna|track\s*karna|track\s*karunga|peeche\s*padna|peecha\s*karna|pursue\s*karna|followup\s*karna|follow\s*karna|follow\s*karunga)\b/i,
      t: `Follow up with ${cName}`,
    },

    // ── Update / inform / tell ────────────────────────────────────────────────
    // "update dalna", "bata dena", "inform karna", "bol dena", "reply karna"
    {
      r: /\b(?:bolunga|bolenge|bol\s*dunga|bol\s*denge|bol\s*dena|bol\s*dena\s*hai|bol\s*do|bol\s*deta\s*hoon|bataunga|batayenge|bata\s*dunga|bata\s*denge|bata\s*dena|bata\s*dena\s*hai|bata\s*do|batao|batana\s*hai|batani\s*hai|btao|inform\s*karna|inform\s*karunga|inform\s*karenge|inform\s*kar\s*dunga|will\s*tell|will\s*inform|update\s*karna|update\s*karunga|update\s*karenge|update\s*kar\s*dunga|update\s*dalna|update\s*dalni|update\s*dena|update\s*dena\s*hai|update\s*deni\s*hai|update\s*dalo|reply\s*karna|reply\s*karunga|reply\s*karenge|reply\s*kar\s*dunga|jawab\s*dena|jawab\s*dunga|ans\s*karna|answer\s*karna|message\s*karna|message\s*karunga|message\s*karenge|whatsapp\s*karna|whatsapp\s*karunga|whatsapp\s*karenge|dalna\s*hai|dalni\s*hai|dal\s*dena\s*hai|dal\s*deni\s*hai|daalni\s*hai)\b/i,
      t: `Update ${cName}`,
    },

    // ── Share details / documents / info ─────────────────────────────────────
    // "details dena", "document share karna", "number dena", "info bhejunga"
    {
      r: /\b(?:deta\s*hoon|de\s*dunga|de\s*denge|de\s*lunga|de\s*lenge|dunga|dungi|share\s*karunga|share\s*karenge|share\s*kar\s*dunga|will\s*give|will\s*share|document\s*dena|documents\s*dena|details\s*dena|details\s*bhejunga|info\s*dena|info\s*bhejunga|number\s*dena|number\s*dunga|address\s*dena|address\s*bhejunga|location\s*dena|location\s*bhejunga|catalogue\s*dena|brochure\s*dena|list\s*dena|list\s*bhejunga|price\s*list\s*dena|rate\s*card\s*dena)\b/i,
      t: `Share details with ${cName}`,
    },

    // ── Check / verify / find out ─────────────────────────────────────────────
    // "check karunga", "pata karunga", "dekhta hoon", "poochna hai", "verify karna"
    {
      r: /\b(?:check\s*karunga|check\s*karenge|check\s*kar\s*dunga|check\s*kar\s*denge|check\s*kar\s*lunga|check\s*karna\s*hai|check\s*karni\s*hai|will\s*check|dekhta\s*hoon|dekhunga|dekhenge|dekh\s*lunga|dekh\s*lenge|dekhna\s*hai|dekhni\s*hai|pata\s*karunga|pata\s*karenge|pata\s*kar\s*dunga|pata\s*karna\s*hai|pata\s*lagana\s*hai|pata\s*lagaunga|puchna\s*hai|poochna\s*hai|pooch\s*lunga|pooch\s*lenge|poochunga|puochunga|verify\s*karna|verify\s*karunga|verify\s*karenge|confirm\s*karna\s*hai|jaanch\s*karna|investigate\s*karna|enquiry\s*karna|enquiry\s*karunga|enquire\s*karna|pata\s*chal\s*jayega)\b/i,
      t: `Check and update ${cName}`,
    },

    // ── Collect advance / down payment ────────────────────────────────────────
    // "advance lena", "token lena", "advance milega", "booking amount lena"
    {
      r: /\b(?:advance\s*lena|advance\s*leni|advance\s*milega|advance\s*milegi|advance\s*chahiye|advance\s*le\s*lena|advance\s*le\s*leni|advanss\s*lena|advans\s*lena|token\s*lena|token\s*milega|token\s*amount|booking\s*amount|down\s*payment|security\s*lena|deposit\s*lena)\b/i,
      t: `Collect advance from ${cName}`,
    },

    // ── General strong future intent (Hindi) — catch-all ─────────────────────
    // Covers masculine (karna/karunga) AND feminine (karni/karungi) agreement forms,
    // plus abbreviated/colloquial forms (kr dunga, de dunga, le lunga, ho jayega)
    {
      r: /\b(?:karunga|karungi|karenge|karengi|kar\s*dunga|kar\s*dungi|kar\s*denge|kar\s*dengi|kar\s*lunga|kar\s*lungi|kar\s*lenge|kar\s*lengi|karne\s*wala|karne\s*wali|karne\s*waala|karne\s*waali|karna\s*padega|karna\s*padegi|karna\s*hai|karna\s*hoga|karna\s*hogi|karni\s*hai|karni\s*hogi|karni\s*padegi|karni\s*padega|kr\s*dunga|kr\s*dungi|kr\s*denge|kr\s*dengi|kr\s*lunga|kr\s*lenge|lena\s*hai|lena\s*padega|lena\s*padegi|lena\s*hoga|leni\s*hai|leni\s*padegi|leni\s*padega|leni\s*hogi|le\s*lunga|le\s*lungi|le\s*lenge|le\s*lengi|le\s*dunga|le\s*dungi|dena\s*hai|dena\s*padega|dena\s*padegi|dena\s*hoga|deni\s*hai|deni\s*padegi|deni\s*padega|deni\s*hogi|de\s*dunga|de\s*dungi|de\s*denge|de\s*dengi|karna\s*padhega|karna\s*padhegi|karni\s*padhegi|karni\s*padhega|ho\s*jayega|ho\s*jayegi|ho\s*jaayega|ho\s*jaayegi|kar\s*deta\s*hoon|kar\s*deti\s*hoon|kar\s*deta|kar\s*deti|karta\s*hoon|karti\s*hoon|hogi\s*taiyari|tayar\s*karunga|tayar\s*karenge)\b/i,
      t: `Follow up with ${cName}`,
    },
  ];

  // Each group fires at most once; compute dueDate per group from its context window
  const tasks = [];
  for (const { r, t } of groups) {
    if (tasks.length >= 3) break;
    if (!r.test(lower)) continue;

    // Find the position of the match and extract a ±80-char window for date parsing
    const match = lower.match(r);
    const pos   = match ? lower.indexOf(match[0]) : 0;
    const window = text.slice(Math.max(0, pos - 80), Math.min(text.length, pos + 80));
    const dueDate = parseDueDateFromText(window) !== parseDueDateFromText('')
      ? parseDueDateFromText(window)
      : parseDueDateFromText(text); // fall back to full-text date

    tasks.push({ title: t, dueDate });
  }
  return tasks;
}

/**
 * Extract a rupee amount from text.
 * Handles: "50000 ka", "₹50000", "50k", "5 lakh", "Rs 50,000"
 *
 * Guards against grabbing numbers that are part of customer/party names:
 *   "2001 australia" — the 2001 is a party identifier, not a price.
 * Rule: bare numbers (no ₹/Rs prefix, no lakh/k suffix) are only treated as
 * amounts when they have an explicit currency suffix (ka/ke/ki/rupees) OR an
 * explicit currency prefix (₹/Rs). A bare number followed by a word that looks
 * like a location or name is intentionally ignored.
 */
function extractAmount(text) {
  const lower = text.toLowerCase();
  let m;

  // "5 lakh", "5.5 lakh" — always currency
  m = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac)/);
  if (m) return Math.round(parseFloat(m[1]) * 100000);

  // "50k" — always currency
  m = lower.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);

  // "₹50000" or "Rs 50000" — explicit currency symbol, always currency
  m = lower.match(/(?:₹|rs\.?\s*)(\d[\d,]+)/);
  if (m) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 100) return val;
  }

  // "50000 ka/ke/ki/rupees" — explicit currency suffix, always currency
  m = lower.match(/(\d[\d,]{2,})\s*(?:ka|ke|ki|rupees?|ruppees?)\b/);
  if (m) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 100) return val;
  }

  // Bare numbers (no prefix, no suffix) — ONLY if they are not followed immediately
  // by an alphabetic word (which would indicate a name/location like "2001 Australia")
  m = lower.match(/(\d[\d,]{3,})(?!\s*[a-z])/); // require 4+ digits and NOT followed by a letter
  if (m) {
    const val = parseInt(m[1].replace(/,/g, ''), 10);
    if (val >= 1000) return val; // raise floor to avoid "500 designs" etc.
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
/**
 * Match a spoken/written name against the vendor list.
 * Checks vendor.name and vendor.company since staff may refer to either.
 */
function fuzzyMatchVendor(spokenName, vendors, threshold = 0.72) {
  if (!spokenName || !spokenName.trim() || !vendors.length) return null;
  const normSpoken    = normalizeName(spokenName);
  const spokenTokens  = normSpoken.split(' ').filter(t => t.length > 0);
  let best = null, bestScore = 0;

  for (const v of vendors) {
    // Check against contact name AND company name
    const candidates = [v.name, v.company].filter(Boolean);
    for (const candidate of candidates) {
      let score = nameSimilarity(spokenName, candidate);
      const normCand   = normalizeName(candidate);
      const candTokens = normCand.split(' ').filter(t => t.length > 0);
      if (normSpoken.length >= 4 && normCand.startsWith(normSpoken)) score = Math.max(score, 0.85);

      const candFirst   = candTokens[0]   || '';
      const spokenFirst = spokenTokens[0] || '';
      // First-word-to-first-word boost — only when spoken is a single token (same guard as customers)
      if (spokenTokens.length === 1 && spokenFirst.length >= 4 && candFirst === spokenFirst) {
        score = Math.max(score, 0.80);
      }
      // Candidate first-word-in-spoken boost — only when candidate is single-token
      if (candTokens.length === 1 && candFirst.length >= 4 && normSpoken.includes(candFirst)) {
        score = Math.max(score, 0.80);
      }
      if (score > bestScore) { best = v; bestScore = score; }
    }
  }
  return bestScore >= threshold ? best : null;
}

// ── Speech-to-text correction ─────────────────────────────────────────────────
// Safety-net pass AFTER the client already ran fixTranscript + devanagariToRoman.
// Catches anything that slipped through the regex layer. Uses Haiku for speed.
// Falls back to original on any error.
async function correctSpeechText(raw) {
  const client = getClient();
  if (!client) return raw;
  try {
    const msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a Hinglish (Hindi+English) speech-to-text post-processor. The client has already attempted regex-based fixes. Your job is to catch anything that slipped through.

Chrome's hi-IN engine produces these systematic error categories — fix them, leave everything else untouched:

A. PRONOUN EXPANSION — Chrome inserts extra 'a':
   usaka→uska  usakee/usaki→uski  unaka→unka  unakee/unaki→unki
   isaka→iska  isakee/isaki→iski  apaka→apka  apakee/apaki→apki
   mujhaka→mujhko  humaka→humko  tumhaka→tumhara

B. FEMININE PAST -ee SUFFIX:
   huee→hui  gayee→gayi  aayee→aayi  bolee→boli
   karee→kari  milee→mili  bhejee→bheji  payee→payi

C. INFINITIVE -ana EXPANSION (Chrome adds extra vowel):
   nikalana→nikalna  bhejana→bhejna  dekhana→dekhna  bolana→bolna
   pahunchana→pahunchna  likhana→likhna  pakadana→pakadna
   jodana→jodna  kharidana→kharidna  bechana→bechna

D. ENGLISH WORDS IN HINDI PHONETICS:
   parsal/parsel/parcal→parcel  paymant/paimant→payment
   delivari/delivary→delivery  karanee/karnee→karni
   veediyo/vidiyo kol→video call  veediyo/vidiyo→video
   sampal/sampel→sample  advanse/advanss→advance
   confarm/conferm→confirm  dispach/disipach→dispatch
   risipt/receet→receipt  meating→meeting  koteshan→quotation
   balanss/balanse→balance  ordar→order  feeadback→feedback
   tansport→transport  komission→commission  kourier→courier

E. DATE WORDS:
   parason/parsoon/parasson→parson (day after tomorrow)

F. CITY NAMES:
   noeda/noyda→Noida  gurgoan/gurgan→Gurgaon  fardabad→Faridabad
   gaziabad/ghaziyabad→Ghaziabad  hydrabad→Hyderabad  ahmadabad→Ahmedabad
   laknow/lucnow→Lucknow  baranasi→Varanasi  bangalor→Bangalore
   amritasar→Amritsar  indor→Indore  kanpoor→Kanpur  dehlee→Delhi

G. GOODS/STOCK:
   "ka man liya"→"ka maal liya"  "man bheja"→"maal bheja"  "man aaya"→"maal aaya"
   "man nahi"→"maal nahi"  "man ready"→"maal ready"

RULES (non-negotiable):
1. Fix ONLY speech recognition errors — do NOT rephrase, reorder, or add words
2. Preserve ALL person names, company names, and numbers EXACTLY as given
3. Words that already look correct must not be changed
4. Return ONLY the corrected text — no quotes, no explanation, no preamble

Examples:
Input:  usaka parsal nikalana hai aur parason usakee veediyo kol karanee hai
Output: uska parcel nikalna hai aur parson uski video call karni hai

Input:  raghav chaddha noeda se bat huee kal unaka 50000 ka man liya
Output: raghav chaddha Noida se baat hui kal unka 50000 ka maal liya

Input:  deepak ne bola aayega aur paymant ka balanss bhi dega
Output: deepak ne bola aayega aur payment ka balance bhi dega

Text: ${raw}`,
      }],
    });
    const fixed = msg.content[0]?.text?.trim();
    if (fixed && fixed.length > 0) {
      if (fixed !== raw) console.log(`[Diary STT] Corrected: "${raw}" → "${fixed}"`);
      return fixed;
    }
  } catch (err) {
    console.warn('[Diary STT] correction failed, using raw:', err.message);
  }
  return raw;
}

async function processDiaryEntry(entryId, rawContent, staffId, staffName) {
  // ── PHASE 0: Correct speech-to-text errors before anything hits the DB ──────
  const content = await correctSpeechText(rawContent);
  if (content !== rawContent) {
    try {
      await updateOne('diary', entryId, { content });
      broadcast('diary:updated', { id: entryId, content });
    } catch { /* non-fatal — NLP still runs on corrected content below */ }
  }

  // ── PHASE 1: Local NLP — parallel reads ────────────────────────────────────
  let allCustomers = [];
  let allVendors   = [];
  let pooledTeamId = null; // non-null if this staff is in a team with pooledTasks=true
  try { allCustomers = await readDB('customers'); } catch {}
  try { allVendors   = await readDB('vendors');   } catch {}
  try {
    const teams = await readDB('teams');
    const myTeam = teams.find(t => Array.isArray(t.members) && t.members.includes(staffId));
    if (myTeam?.pooledTasks === true) pooledTeamId = myTeam.id;
  } catch {}

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
  const resolvedVendors = []; // [{vendor}]

  const noteText = sentiment === 'positive'
    ? 'Positive interaction logged.'
    : sentiment === 'negative'
    ? 'Interaction noted — follow up required.'
    : 'Interaction logged from diary entry.';

  for (const name of names) {
    // ── Vendor check first — if staff added this name as a vendor, log there instead ──
    const vendorMatch = fuzzyMatchVendor(name, allVendors, 0.72);
    if (vendorMatch) {
      resolvedVendors.push({ vendor: vendorMatch });
      localEntries.push({
        spokenName:   name,
        customerName: vendorMatch.name,  // reuse field for display label
        customerId:   null,
        isNewCustomer: false,
        isVendor:     true,
        vendorId:     vendorMatch.id,
        vendorName:   vendorMatch.name,
        date:         null,
        notes:        actions.length > 0 ? `${noteText} Next: ${actions[0]}.` : noteText,
        originalNotes: content.slice(0, 400),
        actionItems:  actions,
        sentiment,
        confidence:   0.75,
      });
      console.log(`[Diary NLP] 🏪 Vendor match: "${name}" → "${vendorMatch.name}"`);
      continue;
    }

    // ── Customer resolution (existing logic) ──────────────────────────────────
    let resolved = fuzzyMatchCustomer(name, [...allCustomers, ...newCustomers], 0.78);
    let isNew = false;

    if (resolved) {
      // ── Multi-staff: if this staff isn't already linked, add them ─────────────
      const existingStaff = Array.isArray(resolved.assignedStaff)
        ? resolved.assignedStaff
        : [resolved.assignedTo].filter(Boolean);
      if (!existingStaff.includes(staffId)) {
        const updatedStaff = [...existingStaff, staffId];
        const staffUpdated = await updateOne('customers', resolved.id, {
          assignedStaff: updatedStaff,
          lastContact: now,
        }).catch(() => null);
        if (staffUpdated) {
          broadcast('customer:updated', staffUpdated);
          console.log(`[Diary NLP] 🔗 Shared customer "${resolved.name}" now also with ${staffName}`);
        }
      }
      allCustomers = allCustomers.map(c => c.id === resolved.id ? { ...c, lastContact: now } : c);
    } else {
      try {
        const newCust = {
          id: uuidv4(), name: titleCase(name), phone: '', email: '',
          assignedTo: staffId,
          assignedStaff: [staffId],          // multi-staff from the start
          status: 'lead', lastContact: now,
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

    localEntries.push({
      spokenName:          name,
      customerName:        resolved.name,
      customerId:          resolved.id,
      matchedCustomerName: resolved.name,
      matchedCustomerId:   resolved.id,
      isNewCustomer:       isNew,
      autoCreatedId:       isNew ? resolved.id : null,
      isVendor:            false,
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
        customerId:    customer.id,
        customerName:  customer.name,
        title,
        notes:         `Auto-created from diary entry: "${content.slice(0, 120)}${content.length > 120 ? '…' : ''}"`,
        dueDate,
        completed:     false,
        completedAt:   null,
        createdAt:     now,
        source:        'diary',
        diaryEntryId:  entryId,
        teamId:        pooledTeamId,   // null unless team has pooledTasks=true
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

    // 4. Auto-update / auto-complete existing tasks from diary signals ───────────
    // Completion: "payment aa gaya / ho gaya / kar liya / done / bhej diya"
    // Reschedule (no merit penalty): "parso karunga / kal milna" — factual diary log
    sideEffects.push((async () => {
      try {
        const allTasks = await readDB('tasks');
        const customerTasks = allTasks.filter(t =>
          !t.completed && t.staffId === staffId && t.customerId === customer.id
        );
        if (customerTasks.length === 0) return;

        const lc = content.toLowerCase();

        // ── Completion signals ──────────────────────────────────────────────────
        const completionMatch = lc.match(
          /(?:payment|paise|paisa|advance|token|baaki)\s*(?:aa\s*gaya|aa\s*gayi|aa\s*gaye|de\s*diya|diye|mila|mili|mile|cleared?|received?|kar\s*diya)|(?:ho\s*gaya|ho\s*gayi|kar\s*liya|karlia|kar\s*li|kar\s*di(?:ya|ye)?|khatam|done|complet(?:ed|ion)|nikal\s*gaya|bhej\s*diya|bheji|deliver(?:ed|y\s*ho\s*gayi)|dispatch(?:ed)?|pahunch\s*gaya|pahunch\s*gayi|maal\s*aa\s*gaya)/
        );

        if (completionMatch) {
          // Match keyword to find which task to complete
          const keyword = completionMatch[0];
          const isPayment = /payment|paise|paisa|advance|token|baaki/.test(keyword);
          const isDelivery = /deliver|dispatch|maal\s*aa|bhej\s*diya|pahunch/.test(keyword);

          // Priority 1: find task by semantic word-overlap with diary content
          let targetTask = customerTasks.find(t => taskContentMatch(lc, t.title));

          // Priority 2: fall back to keyword-type matching
          if (!targetTask) {
            targetTask = customerTasks.find(task => {
              const taskLc = task.title.toLowerCase();
              return (isPayment  && /payment|paise|advance|token|baaki/.test(taskLc)) ||
                     (isDelivery && /deliver|dispatch|send|bhej|courier|maal/.test(taskLc)) ||
                     (!isPayment && !isDelivery);
            });
          }

          if (!targetTask) return; // no matching task found

          const task = targetTask;
          const updated = await updateOne('tasks', task.id, {
            completed:   true,
            completedAt: now,
            notes: (task.notes ? task.notes + '\n' : '') +
              `[Auto-completed via diary] "${content.slice(0, 100)}"`,
          }).catch(() => null);

          if (updated) {
            broadcast('task:updated', updated);
            // Award merit — this is a real completion
            const staffList = await readDB('staff').catch(() => []);
            const staffMember = staffList.find(s => s.id === staffId);
            const resolvedName = staffMember?.name || staffName;
            const today2 = new Date().toISOString().split('T')[0];
            const isLate = task.dueDate && task.dueDate < today2;
            if (isLate) await awardMerit(staffId, resolvedName, -1, `Late: ${task.title}`, 'overdue', task.id).catch(() => {});
            await awardMerit(staffId, resolvedName, 1, `Task completed: ${task.title}`, 'task', task.id).catch(() => {});
            console.log(`[Diary NLP] ✅ Auto-completed task: "${task.title}" for ${customer.name}`);
          }
          return; // skip reschedule if we just completed
        }

        // ── Reschedule signals (no merit penalty — it's a factual diary log) ────
        const newDate = parseDueDateFromText(content);
        const rescheduleSignal = /(?:parso|kal|agle\s*hafte|next\s*week|\d+\s*din\s*baad|follow[\s-]*up|dobara\s*call|phir\s*call|milna|milenge|meeting\s*hai|ayenge|aayenge)/.test(lc);

        if (newDate && rescheduleSignal) {
          const task = customerTasks[0]; // reschedule the soonest-due task
          if (task && newDate !== task.dueDate) {
            const updated = await updateOne('tasks', task.id, {
              dueDate: newDate,
              notes: (task.notes ? task.notes + '\n' : '') +
                `[Diary rescheduled — no penalty] "${content.slice(0, 100)}"`,
              // ⚠️ intentionally NOT calling awardMerit(-0.5) — diary is factual
            }).catch(() => null);
            if (updated) {
              broadcast('task:updated', updated);
              console.log(`[Diary NLP] 📅 Task rescheduled (no penalty): "${task.title}" → ${newDate}`);
            }
          }
        }
      } catch (e) {
        console.warn('[Diary NLP] Task auto-update failed (non-fatal):', e.message);
      }
    })());
  }

  // ── General tasks: future-intent with NO specific customer resolved ──────────
  // If the diary entry has no resolved customers but mentions a future action,
  // create a staff-level task without a customer ID.
  if (resolvedList.length === 0) {
    const generalDetected = detectTasks(content, null);
    for (const { title, dueDate } of generalDetected) {
      // Replace placeholder "Customer" in title with nothing meaningful
      const cleanTitle = title
        .replace(/ with Customer$/, '')
        .replace(/ — Customer$/, '')
        .replace(/ for Customer$/, '')
        .replace(/ Customer$/, '')
        .trim();
      const task = {
        id: uuidv4(),
        staffId,
        customerId:    null,
        customerName:  null,
        title:         cleanTitle || title,
        notes:         `Auto-created from diary entry: "${content.slice(0, 120)}${content.length > 120 ? '…' : ''}"`,
        dueDate,
        completed:     false,
        completedAt:   null,
        createdAt:     now,
        source:        'diary',
        diaryEntryId:  entryId,
        teamId:        pooledTeamId,   // null unless team has pooledTasks=true
      };
      sideEffects.push(
        insertOne('tasks', task)
          .then(() => {
            broadcast('task:created', task);
            console.log(`[Diary NLP] 📋 General task: "${task.title}" due ${dueDate}`);
          })
          .catch(() => {})
      );
    }
  }

  // ── Vendor task auto-complete/update from diary signals ─────────────────
  for (const { vendor } of resolvedVendors) {
    sideEffects.push((async () => {
      try {
        const allTasks = await readDB('tasks');
        const vendorTasks = allTasks.filter(t =>
          !t.completed && t.staffId === staffId &&
          (t.vendorId === vendor.id || (t.customerName && nameSimilarity(t.customerName, vendor.name) >= 0.78))
        );
        if (vendorTasks.length === 0) return;
        const lc = content.toLowerCase();
        const completionMatch = /(?:aa\s*gaya|de\s*diya|mila|cleared?|done|deliver(?:ed)?|dispatch(?:ed)?|pahunch\s*gaya|ho\s*gaya|bheji|bhej\s*diya|maal\s*aa)/.test(lc);
        if (completionMatch) {
          const task = vendorTasks[0];
          const staffList = await readDB('staff').catch(() => []);
          const staffMember = staffList.find(s => s.id === staffId);
          const resolvedName = staffMember?.name || staffName;
          const updated = await updateOne('tasks', task.id, {
            completed: true, completedAt: now,
            notes: (task.notes ? task.notes + '\n' : '') + `[Auto-completed via diary] "${content.slice(0, 100)}"`,
          }).catch(() => null);
          if (updated) {
            broadcast('task:updated', updated);
            await awardMerit(staffId, resolvedName, 1, `Task completed: ${task.title}`, 'task', task.id).catch(() => {});
            console.log(`[Diary NLP] ✅ Vendor task auto-completed: "${task.title}" for ${vendor.name}`);
          }
        }
      } catch (e) { console.warn('[Diary NLP] Vendor task update failed:', e.message); }
    })());
  }

  // ── Vendor interaction logging ────────────────────────────────────────────
  for (const { vendor } of resolvedVendors) {
    const vi = {
      id:           uuidv4(),
      vendorId:     vendor.id,
      vendorName:   vendor.name,
      staffId,
      staffName,
      notes:        buildInteractionNote(content, sentiment, amount, actions),
      diaryEntryId: entryId,
      sentiment,
      createdAt:    now,
    };
    sideEffects.push(
      insertOne('vendorInteractions', vi)
        .then(() => console.log(`[Diary NLP] 🏪 Vendor interaction logged: "${vendor.name}"`))
        .catch(() => {})
    );
  }

  // ── CRM lead sync: update noPickupCount / nextFollowUp from diary ─────────
  // "Ramesh ne video call nahi uthayi, parso karengi" → update his lead record
  // No merit deduction — diary is a factual log, not a task reschedule.
  try {
    const lc = content.toLowerCase();
    const noPickupSignal =
      /nahi\s*utha(?:ya|ta|ti|tha)?|no\s*pickup|phone\s*nahi\s*utha|call\s*nahi\s*liya|nahi\s*utha\s*raha|nahi\s*utha\s*rahi/.test(lc);
    const notRespondingSignal =
      /respond\s*nahi|reply\s*nahi|jawab\s*nahi|contact\s*nahi|nahi\s*bol\s*raha|nahi\s*mil\s*raha/.test(lc);

    if ((noPickupSignal || notRespondingSignal) && resolvedList.length > 0) {
      const allLeads = await readDB('leads').catch(() => []);
      const followUpDate = parseDueDateFromText(content);
      const tomorrow = (() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
      })();

      for (const { customer } of resolvedList) {
        const lead = allLeads.find(l =>
          (l.linkedCustomerId && l.linkedCustomerId === customer.id) ||
          nameSimilarity(l.name, customer.name) >= 0.78
        );
        if (!lead || lead.stage === 'won' || lead.stage === 'lost') continue;

        const patch = {
          updatedAt: now,
          nextFollowUp: followUpDate || (noPickupSignal ? tomorrow : lead.nextFollowUp),
        };
        if (noPickupSignal) patch.noPickupCount = (lead.noPickupCount || 0) + 1;

        await updateOne('leads', lead.id, patch).catch(() => {});
        broadcast('lead:updated', { ...lead, ...patch });
        console.log(`[Diary NLP] 📞 Lead "${lead.name}" updated — no-pickup: ${noPickupSignal}, followUp: ${patch.nextFollowUp}`);
      }
    }
  } catch (e) {
    console.warn('[Diary NLP] CRM sync failed (non-fatal):', e.message);
  }

  await Promise.allSettled(sideEffects);

  if (newCustomers.length > 0) {
    console.log(`[Diary NLP] Created ${newCustomers.length} new customer(s) for ${staffName}`);
  }
  if (resolvedVendors.length > 0) {
    console.log(`[Diary NLP] Logged ${resolvedVendors.length} vendor interaction(s) for ${staffName}`);
  }

  // ── PHASE 2: Optional AI enhancement ──────────────────────────────────────
  // Skipped entirely if no API key. On ANY error, local result stands.
  const client = getClient();
  if (!client) return;

  try {
    const customerRef = allCustomers.length > 0
      ? allCustomers.map(c => `"${c.name}" [id:${c.id}]`).join('\n')
      : '(none yet)';
    const vendorRef = allVendors.length > 0
      ? allVendors.map(v => `"${v.name}"${v.company ? ` / "${v.company}"` : ''} [vid:${v.id}]`).join('\n')
      : '(none)';

    const aiPrompt = `You are a bilingual sales CRM assistant fluent in Hindi, Hinglish, and English.

DIARY ENTRY:
"""
${content.slice(0, 4000)}
"""

KNOWN CUSTOMERS (search these FIRST before creating new ones):
${customerRef}

KNOWN VENDORS (suppliers/manufacturers — NOT customers):
${vendorRef}

Provide a complete natural English translation (sentence by sentence, not a summary), then extract all customer interactions.

━━━ NAMING RULES (read carefully) ━━━
1. CITY = PART OF NAME. Customer names always include their city/location.
   "manish agra ne call kiya" → spokenName = "Manish Agra"
   "bittoo fashion chandigarh ka order" → spokenName = "Bittoo Fashion Chandigarh"
   "deepak ko maal bheja delhi" → spokenName = "Deepak Delhi"
   NEVER strip the city and return just the first name.

2. BUSINESS WORDS IN NAMES: Include trader/shop words.
   "vijay traders noida", "ravi brothers delhi", "sunita store lajpat nagar" — ALL are valid customer names.

3. DIFFERENT PEOPLE WITH SAME FIRST NAME = DIFFERENT CUSTOMERS.
   "aman jadau" and "aman canada" are TWO different customers even though both start with "aman".
   Match by full name + city, not just first name.

4. HINGLISH CONTEXT CLUES — all of these mean the person is a customer:
   "X ne order diya / maal liya / call kiya / confirm kiya"
   "X ko maal bheja / call kiya / quote diya"
   "X se mila / baat hui / payment li"
   "X ka payment / order / maal / parcel / invoice"
   "X ke saath meeting / baat / deal"
   "X ji / X sahab / X bhai / X didi" (honorific = person name)

5. DB-FIRST MATCHING — before setting isNewCustomer=true, search KNOWN CUSTOMERS with phonetic equivalence:
   ph≈f, bh≈b, kh≈k, sh≈s, aa≈a, ee≈i, oo≈u, v≈w, th≈t, dh≈d
   If any customer matches the spoken name AND the city/location, use their exact id/name.
   Only mark isNewCustomer=true if genuinely no match exists.

6. VENDORS: If name matches KNOWN VENDOR, set isVendor=true. Do NOT create new vendors.

7. EXTRACT ALL customers mentioned — one entry per customer.

━━━ ACTION ITEMS RULES ━━━
- List ONLY future actions the staff member still needs to do (not things already done)
- "usne payment de diya" = done (past) → no payment action item
- "kal call karna hai" = future → add "Call customer tomorrow"
- "parcel nikalna hai" = future → add "Dispatch parcel"
- Be specific: "Send sample to Manish Agra" not just "Send sample"
- Maximum 3 action items per entry

Respond ONLY with this JSON (no markdown, no text outside the JSON):
{
  "detectedLanguage": "hindi|english|hinglish",
  "translatedContent": "Complete natural English translation in first person",
  "entries": [
    {
      "spokenName": "Full name including city e.g. Manish Agra",
      "isVendor": false,
      "matchedCustomerName": "exact name from KNOWN CUSTOMERS list or null",
      "matchedCustomerId": "exact id from KNOWN CUSTOMERS list or null",
      "matchedVendorName": null,
      "matchedVendorId": null,
      "isNewCustomer": false,
      "date": null,
      "notes": "1-2 sentence professional English summary of this specific interaction",
      "originalNotes": "verbatim original text about this person",
      "actionItems": ["Specific future action with customer name"],
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

    const aiSideEffects = [];

    for (const e of aiResult.entries) {
      const spokenName = (e.spokenName || '').trim();
      const nameLower  = spokenName.toLowerCase();
      if (!spokenName || STOP_WORDS.has(nameLower) || spokenName.length < 3) continue;

      // ── Vendor path — AI flagged this as a vendor match ───────────────────
      const isVendorEntry = e.isVendor === true || !!e.matchedVendorId;
      if (isVendorEntry) {
        let vendor = null;
        if (e.matchedVendorId) {
          vendor = allVendors.find(v => v.id === e.matchedVendorId) || null;
        }
        if (!vendor) {
          vendor = fuzzyMatchVendor(spokenName, allVendors, 0.72);
        }
        if (!vendor) continue; // do NOT auto-create vendors

        aiEntries.push({
          spokenName,
          customerName: vendor.name,
          customerId:   null,
          isVendor:     true,
          vendorId:     vendor.id,
          vendorName:   vendor.name,
          isNewCustomer: false,
          date:         e.date || null,
          notes:        e.notes || '',
          originalNotes: e.originalNotes || '',
          actionItems:  Array.isArray(e.actionItems) ? e.actionItems : [],
          sentiment:    ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
          confidence:   typeof e.confidence === 'number' ? e.confidence : 0.8,
        });

        // Log vendor interaction
        const vi = {
          id: uuidv4(), vendorId: vendor.id, vendorName: vendor.name,
          staffId, staffName,
          notes: e.notes || buildInteractionNote(content, e.sentiment || sentiment, amount, Array.isArray(e.actionItems) ? e.actionItems : actions),
          diaryEntryId: entryId,
          sentiment: ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
          createdAt: nowAI,
        };
        aiSideEffects.push(insertOne('vendorInteractions', vi).catch(() => {}));
        console.log(`[Diary AI] 🏪 Vendor interaction logged: "${vendor.name}"`);
        continue;
      }

      // ── Customer path ─────────────────────────────────────────────────────
      let resolved = null;
      if (e.matchedCustomerId) {
        resolved = allCustomers.find(c => c.id === e.matchedCustomerId) || null;
      }
      if (!resolved) {
        resolved = fuzzyMatchCustomer(spokenName, [...allCustomers, ...aiNewCustomers], 0.65);
      }
      if (!resolved) {
        // Last guard: check if this name is actually a vendor before creating a customer
        const vendorGuard = fuzzyMatchVendor(spokenName, allVendors, 0.72);
        if (vendorGuard) {
          // AI missed the vendor flag — treat it as vendor silently
          aiEntries.push({
            spokenName,
            customerName: vendorGuard.name, customerId: null,
            isVendor: true, vendorId: vendorGuard.id, vendorName: vendorGuard.name,
            isNewCustomer: false, date: e.date || null,
            notes: e.notes || '', originalNotes: e.originalNotes || '',
            actionItems: Array.isArray(e.actionItems) ? e.actionItems : [],
            sentiment: ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
            confidence: 0.75,
          });
          const vi = {
            id: uuidv4(), vendorId: vendorGuard.id, vendorName: vendorGuard.name,
            staffId, staffName, notes: e.notes || '',
            diaryEntryId: entryId, sentiment: 'neutral', createdAt: nowAI,
          };
          aiSideEffects.push(insertOne('vendorInteractions', vi).catch(() => {}));
          continue;
        }

        try {
          const newCust = {
            id: uuidv4(), name: titleCase(spokenName), phone: '', email: '',
            assignedTo: staffId,
            assignedStaff: [staffId],
            status: 'lead', lastContact: nowAI,
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
        // Existing customer matched by AI — also link this staff if not already linked
        const existingStaff = Array.isArray(resolved.assignedStaff)
          ? resolved.assignedStaff
          : [resolved.assignedTo].filter(Boolean);
        const patch = { lastContact: nowAI };
        if (!existingStaff.includes(staffId)) {
          patch.assignedStaff = [...existingStaff, staffId];
          console.log(`[Diary AI] 🔗 Shared customer "${resolved.name}" now also with ${staffName}`);
        }
        try {
          const updated = await updateOne('customers', resolved.id, patch);
          if (patch.assignedStaff) broadcast('customer:updated', updated);
        } catch {}
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
        isVendor:            false,
        date:                e.date   || null,
        notes:               e.notes  || '',
        originalNotes:       e.originalNotes || '',
        actionItems:         Array.isArray(e.actionItems) ? e.actionItems : [],
        sentiment:           ['positive','neutral','negative'].includes(e.sentiment) ? e.sentiment : 'neutral',
        confidence:          typeof e.confidence === 'number' ? e.confidence : 0.8,
      });
    }

    await Promise.allSettled(aiSideEffects);

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

// ── POST /api/diary/task-voice — voice input → tasks (no customer creation, no merit penalty) ──
// Recognises existing customers, detects genuine excuses (no pickup / not responding /
// payment pending) and updates tasks with a note — NO merit deduction.
// Also creates new tasks from future-intent phrases detected in the voice input.
router.post('/task-voice', async (req, res) => {
  try {
    const { content: rawContent } = req.body;
    if (!rawContent?.trim()) return res.status(400).json({ error: 'Content required' });

    const content = await correctSpeechText(rawContent);
    const staffId   = req.user.id;
    const staffName = req.user.name;
    const now       = new Date().toISOString();

    // ── Load existing data ────────────────────────────────────────────────────
    const [allCustomers, allTasks] = await Promise.all([
      readDB('customers').catch(() => []),
      readDB('tasks').catch(() => []),
    ]);

    // Staff can only see their own pending tasks
    const myPendingTasks = allTasks.filter(t =>
      !t.completed && (t.staffId === staffId || (t.teamId && !t.completed))
    );

    // ── Extract names & match EXISTING customers only (no creation) ───────────
    const names = extractNamesFromText(content);
    const matched = []; // { customer, tasks[] }

    for (const name of names) {
      const vendor = fuzzyMatchVendor(name, await readDB('vendors').catch(() => []), 0.72);
      if (vendor) continue; // skip vendors

      const customer = fuzzyMatchCustomer(name, allCustomers, 0.75);
      if (!customer) continue; // no match → skip (no creation)

      const relatedTasks = myPendingTasks.filter(t => t.customerId === customer.id);
      matched.push({ customer, relatedTasks });
    }

    // ── Genuine excuse detection ──────────────────────────────────────────────
    const lc = content.toLowerCase();

    const excuseType = (() => {
      if (/nahi\s*utha(?:ya|ta|ti|tha)?|no\s*pickup|phone\s*nahi\s*utha|call\s*nahi\s*liya|nahi\s*utha\s*raha/.test(lc))
        return 'no_pickup';
      if (/payment\s*nahi|paise\s*nahi\s*(?:aaye|mile|diye|mila|aayi)|payment\s*pending|baaki\s*hai/.test(lc))
        return 'payment_pending';
      if (/respond\s*nahi|reply\s*nahi|jawab\s*nahi|contact\s*nahi|nahi\s*bol\s*raha|nahi\s*mil\s*raha|nahi\s*aa\s*raha/.test(lc))
        return 'not_responding';
      if (/busy\s*hai|baad\s*mein|time\s*nahi|switch\s*off|band\s*hai|net\s*nahi|signal\s*nahi/.test(lc))
        return 'unavailable';
      return null;
    })();

    const excuseNote = {
      no_pickup:      'Customer did not pick up the call.',
      payment_pending:'Payment not received from customer.',
      not_responding: 'Customer is not responding.',
      unavailable:    'Customer was unavailable.',
    }[excuseType] || null;

    // ── New due date from content (for rescheduling) ──────────────────────────
    const newDueDate = parseDueDateFromText(content);
    const tomorrow   = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();

    const updatedTasks  = [];
    const createdTasks  = [];

    // ── Update existing tasks for matched customers (genuine excuse path) ─────
    if (excuseType) {
      for (const { customer, relatedTasks } of matched) {
        for (const task of relatedTasks) {
          const appendNote = `[Voice update] ${excuseNote}${newDueDate ? ` Following up on ${newDueDate}.` : ''}`;
          const existingNotes = task.notes ? task.notes + '\n' + appendNote : appendNote;

          const patch = { notes: existingNotes, updatedAt: now };
          // Only push due date if a specific date was spoken AND task isn't already past that date
          if (newDueDate && newDueDate > task.dueDate) patch.dueDate = newDueDate;
          else if (excuseType === 'no_pickup') patch.dueDate = newDueDate || tomorrow;

          // ⚠️ Deliberately NOT calling awardMerit — genuine excuse, no penalty
          const updated = await updateOne('tasks', task.id, patch).catch(() => null);
          if (updated) {
            broadcast('task:updated', updated);
            updatedTasks.push(updated);
            console.log(`[TaskVoice] 📋 Updated task "${task.title}" for ${customer.name} — excuse: ${excuseType}`);
          }
        }
      }
    }

    // ── Create new tasks from detected future-intent phrases ──────────────────
    for (const { customer } of matched) {
      const detectedTasks = detectTasks(content, customer.name);
      for (const { title, dueDate } of detectedTasks) {
        // Skip if title very similar to an already-created one in this call
        const isDupe = createdTasks.some(t => t.title === title && t.customerId === customer.id);
        if (isDupe) continue;

        const task = {
          id:           uuidv4(),
          staffId,
          customerId:   customer.id,
          customerName: customer.name,
          title,
          notes:        `Voice entry: "${content.slice(0, 100)}${content.length > 100 ? '…' : ''}"`,
          dueDate,
          completed:    false,
          completedAt:  null,
          createdAt:    now,
          source:       'voice_task',
        };
        await insertOne('tasks', task).catch(() => {});
        broadcast('task:created', task);
        createdTasks.push(task);
        console.log(`[TaskVoice] ✅ Task created: "${title}" for ${customer.name}`);
      }
    }

    // ── If no customers matched but we have task intents, create generic tasks ─
    if (matched.length === 0) {
      const detectedTasks = detectTasks(content, null);
      for (const { title, dueDate } of detectedTasks) {
        const cleanTitle = title.replace(/ (?:with|for|—|of) Customer$/, '').trim() || title;
        const task = {
          id:           uuidv4(),
          staffId,
          customerId:   null,
          customerName: null,
          title:        cleanTitle,
          notes:        `Voice entry: "${content.slice(0, 100)}${content.length > 100 ? '…' : ''}"`,
          dueDate,
          completed:    false,
          completedAt:  null,
          createdAt:    now,
          source:       'voice_task',
        };
        await insertOne('tasks', task).catch(() => {});
        broadcast('task:created', task);
        createdTasks.push(task);
        console.log(`[TaskVoice] ✅ General task: "${cleanTitle}"`);
      }
    }

    res.json({
      content,
      excuseType,
      customersMatched: matched.map(m => m.customer.name),
      tasksCreated:  createdTasks,
      tasksUpdated:  updatedTasks,
      summary: excuseType
        ? `${excuseNote} Updated ${updatedTasks.length} task(s) — no points deducted.`
        : createdTasks.length
        ? `Created ${createdTasks.length} task(s).`
        : 'No tasks detected. Try mentioning a customer name and action.',
    });
  } catch (err) {
    console.error('[TaskVoice]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
