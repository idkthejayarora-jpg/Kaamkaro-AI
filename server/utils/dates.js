// IST-safe date helpers. The server may run in UTC (Railway), but the business
// day is Asia/Kolkata — using toISOString() shifts records to the previous day
// between midnight and 05:30 IST.
const TZ = 'Asia/Kolkata';

// YYYY-MM-DD for "today" in IST ('sv-SE' locale formats as ISO date)
const istToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

// YYYY-MM-DD in IST for an arbitrary Date
const istDateStr = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ });

module.exports = { istToday, istDateStr, TZ };
