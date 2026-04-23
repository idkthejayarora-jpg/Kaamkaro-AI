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
function devanagariToRoman(text) {
  if (!/[\u0900-\u097F]/.test(text)) return text; // fast-path: no Devanagari present

  // Consonants (full akshara)
  const CONSONANTS = [
    ['क्ष','ksh'],['त्र','tr'],['ज्ञ','gya'],
    ['क','k'],['ख','kh'],['ग','g'],['घ','gh'],['ङ','ng'],
    ['च','ch'],['छ','chh'],['ज','j'],['झ','jh'],['ञ','ny'],
    ['ट','t'],['ठ','th'],['ड','d'],['ढ','dh'],['ण','n'],
    ['त','t'],['थ','th'],['द','d'],['ध','dh'],['न','n'],
    ['प','p'],['फ','ph'],['ब','b'],['भ','bh'],['म','m'],
    ['य','y'],['र','r'],['ल','l'],['व','v'],
    ['श','sh'],['ष','sh'],['स','s'],['ह','h'],
    ['ळ','l'],['क़','q'],['ख़','kh'],['ग़','gh'],['ज़','z'],['ड़','r'],['ढ़','rh'],['फ़','f'],
  ];

  // Independent vowels
  const IND_VOWELS = [
    ['अ','a'],['आ','aa'],['इ','i'],['ई','ee'],['उ','u'],['ऊ','oo'],
    ['ऋ','ri'],['ए','e'],['ऐ','ai'],['ओ','o'],['औ','au'],
    ['अं','an'],['अः','ah'],
  ];

  // Dependent vowel signs (matras)
  const MATRAS = [
    ['ा','a'],['ि','i'],['ी','ee'],['ु','u'],['ू','oo'],
    ['ृ','ri'],['े','e'],['ै','ai'],['ो','o'],['ौ','au'],
    ['ं','n'],['ः','h'],['ँ','n'],
  ];

  // Specials
  const SPECIALS = [
    ['।',' '],['॥',' '],['्',''],  // halant (virama) — remove vowel
    ['\u200b',''],                   // zero-width space
  ];

  // Build a single replacement pass using a map (longest-match style)
  const ALL = [...SPECIALS, ...IND_VOWELS, ...MATRAS, ...CONSONANTS];

  let result = '';
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const [src, tgt] of ALL) {
      if (text.startsWith(src, i)) {
        result += tgt;
        i += src.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Pass through non-Devanagari characters unchanged
      result += text[i];
      i++;
    }
  }
  return result;
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
    // Numeric tokens (e.g. "1001") are allowed — they form part of the customer ID
    const nameTokens = [];
    for (let k = i - 1; k >= 0 && i - k <= 3; k--) {
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
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})\s+(?:ne|ko|se)\b/gi,
    // Action verbs before name: "called rahul", "met priya agra", "baat ki manish se"
    /(?:called|met|meeting\s+with|visited|contacted|spoke(?:\s+with)?|talked(?:\s+to)?|baat\s+(?:ki|kiya|hui)|milne?|milaa?|mile?|milke|phoned|texted|messaged)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})/gi,
    // Honorifics after name: "rahul ji", "sharma sahab", "mohit bhai"
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,1})\s+(?:ji|sahab|saab|bhai|didi|madam)\b/gi,
    // Possessive + business noun: "rahul ka order", "priya ki payment", "deepak ke kaam"
    /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})\s+(?:ka|ki|ke)\s+(?:order|payment|bill|deal|number|phone|call|meeting|kaam|maal|sample|visit|followup|follow)/gi,
    // Title prefix
    /(?:Mr|Mrs|Ms|Dr|Shri|Smt|Sri)\.?\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,})?)/gi,
    // "customer/party/dealer X": "customer ramesh", "dealer sunil agra"
    /(?:customer|client|party|buyer|prospect|dealer)\s+([a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){0,2})/gi,
    // Extended verb phrases: "X ne maal liya", "X ko call kiya", "X ka invoice"
    /\b([a-zA-Z]{4,}(?:\s+[a-zA-Z]{3,}){0,1})\s+(?:ne\s+(?:bataya|kaha|manga|diya|liya|bola|confirm|cancel|reject|call|maal|order)|ko\s+(?:diya|bheja|call|quote|maal|deliver)|ka\s+(?:maal|order|payment|bill|deal|invoice))/gi,
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
/**
 * Match a spoken/written name against the vendor list.
 * Checks vendor.name and vendor.company since staff may refer to either.
 */
function fuzzyMatchVendor(spokenName, vendors, threshold = 0.72) {
  if (!spokenName || !spokenName.trim() || !vendors.length) return null;
  const normSpoken = normalizeName(spokenName);
  let best = null, bestScore = 0;

  for (const v of vendors) {
    // Check against contact name AND company name
    const candidates = [v.name, v.company].filter(Boolean);
    for (const candidate of candidates) {
      let score = nameSimilarity(spokenName, candidate);
      const normCand = normalizeName(candidate);
      if (normSpoken.length >= 4 && normCand.startsWith(normSpoken)) score = Math.max(score, 0.85);
      const candFirst  = normCand.split(' ')[0];
      const spokenFirst = normSpoken.split(' ')[0];
      if (spokenFirst.length >= 4 && candFirst === spokenFirst) score = Math.max(score, 0.80);
      if (candFirst.length  >= 4 && normSpoken.includes(candFirst)) score = Math.max(score, 0.80);
      if (score > bestScore) { best = v; bestScore = score; }
    }
  }
  return bestScore >= threshold ? best : null;
}

async function processDiaryEntry(entryId, content, staffId, staffName) {
  // ── PHASE 1: Local NLP — parallel reads ────────────────────────────────────
  let allCustomers = [];
  let allVendors   = [];
  try { allCustomers = await readDB('customers'); } catch {}
  try { allVendors   = await readDB('vendors');   } catch {}

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

KNOWN CUSTOMERS:
${customerRef}

KNOWN VENDORS (suppliers/manufacturers the team deals with — NOT customers):
${vendorRef}

Provide a complete, natural English translation of the ENTIRE diary entry (not a summary — full translation sentence by sentence), then extract all interactions.

IMPORTANT: If a name matches a KNOWN VENDOR, set isVendor=true and fill matchedVendorId/matchedVendorName. Do NOT create new vendors — staff add vendors manually. Only create new customers for names that match neither list.

Respond ONLY with this JSON:
{
  "detectedLanguage": "hindi|english|hinglish",
  "translatedContent": "Complete natural English translation in first person",
  "entries": [
    {
      "spokenName": "name as written",
      "isVendor": false,
      "matchedCustomerName": "exact name from customer list or null",
      "matchedCustomerId": "exact id from customer list or null",
      "matchedVendorName": "exact name from vendor list or null",
      "matchedVendorId": "exact vid from vendor list or null",
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
        resolved = fuzzyMatchCustomer(spokenName, [...allCustomers, ...aiNewCustomers]);
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

module.exports = router;
